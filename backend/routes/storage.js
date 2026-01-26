/**
 * HomePiNAS - Storage Routes
 * v1.5.6 - Modular Architecture
 *
 * SnapRAID + MergerFS storage pool management
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const { execSync, spawn } = require('child_process');

const { requireAuth } = require('../middleware/auth');
const { logSecurityEvent } = require('../utils/security');
const { getData, saveData } = require('../utils/data');
const { validateSession } = require('../utils/session');

const STORAGE_MOUNT_BASE = '/mnt/disks';
const POOL_MOUNT = '/mnt/storage';
const SNAPRAID_CONF = '/etc/snapraid.conf';

// SnapRAID sync progress tracking
let snapraidSyncStatus = {
    running: false,
    progress: 0,
    status: '',
    startTime: null,
    error: null
};

// Get storage pool status
router.get('/pool/status', async (req, res) => {
    try {
        let snapraidConfigured = false;
        let mergerfsRunning = false;
        let poolSize = '0';
        let poolUsed = '0';
        let poolFree = '0';

        try {
            const snapraidConf = execSync(`cat ${SNAPRAID_CONF} 2>/dev/null || echo ""`, { encoding: 'utf8' });
            snapraidConfigured = snapraidConf.includes('content') && snapraidConf.includes('disk');
        } catch (e) {}

        try {
            const mounts = execSync('mount | grep mergerfs || echo ""', { encoding: 'utf8' });
            mergerfsRunning = mounts.includes('mergerfs');

            if (mergerfsRunning) {
                const df = execSync(`df -BG ${POOL_MOUNT} 2>/dev/null | tail -1`, { encoding: 'utf8' });
                const parts = df.trim().split(/\s+/);
                if (parts.length >= 4) {
                    poolSize = parts[1].replace('G', '');
                    poolUsed = parts[2].replace('G', '');
                    poolFree = parts[3].replace('G', '');
                }
            }
        } catch (e) {}

        let lastSync = null;
        try {
            const logContent = execSync('tail -20 /var/log/snapraid-sync.log 2>/dev/null || echo ""', { encoding: 'utf8' });
            const syncMatch = logContent.match(/SnapRAID Sync Finished: (.+?)=/);
            if (syncMatch) {
                lastSync = syncMatch[1].trim();
            }
        } catch (e) {}

        res.json({
            configured: snapraidConfigured,
            running: mergerfsRunning,
            poolMount: POOL_MOUNT,
            poolSize: poolSize + ' GB',
            poolUsed: poolUsed + ' GB',
            poolFree: poolFree + ' GB',
            lastSync
        });
    } catch (e) {
        console.error('Pool status error:', e);
        res.status(500).json({ error: 'Failed to get pool status' });
    }
});

// Apply storage configuration
router.post('/pool/configure', requireAuth, async (req, res) => {
    const { disks } = req.body;

    if (!disks || !Array.isArray(disks) || disks.length === 0) {
        return res.status(400).json({ error: 'No disks provided' });
    }

    const dataDisks = disks.filter(d => d.role === 'data');
    const parityDisks = disks.filter(d => d.role === 'parity');
    const cacheDisks = disks.filter(d => d.role === 'cache');

    if (dataDisks.length === 0) {
        return res.status(400).json({ error: 'At least one data disk is required' });
    }

    if (parityDisks.length === 0) {
        return res.status(400).json({ error: 'At least one parity disk is required for SnapRAID' });
    }

    try {
        const results = [];

        // 1. Format disks that need formatting
        for (const disk of disks) {
            if (disk.format) {
                results.push(`Formatting /dev/${disk.id}...`);
                try {
                    execSync(`sudo parted -s /dev/${disk.id} mklabel gpt`, { encoding: 'utf8' });
                    execSync(`sudo parted -s /dev/${disk.id} mkpart primary ext4 0% 100%`, { encoding: 'utf8' });
                    execSync(`sudo partprobe /dev/${disk.id}`, { encoding: 'utf8' });
                    execSync('sleep 2');

                    const partition = disk.id.includes('nvme') ? `${disk.id}p1` : `${disk.id}1`;
                    execSync(`sudo mkfs.ext4 -F -L ${disk.role}_${disk.id} /dev/${partition}`, { encoding: 'utf8' });
                    results.push(`Formatted /dev/${partition} as ext4`);
                } catch (e) {
                    results.push(`Warning: Format failed for ${disk.id}: ${e.message}`);
                }
            }
        }

        // 2. Create mount points and mount disks
        let diskNum = 1;
        const dataMounts = [];
        const parityMounts = [];
        const cacheMounts = [];

        for (const disk of dataDisks) {
            const partition = disk.id.includes('nvme') ? `${disk.id}p1` : `${disk.id}1`;
            const mountPoint = `${STORAGE_MOUNT_BASE}/disk${diskNum}`;

            execSync(`sudo mkdir -p ${mountPoint}`, { encoding: 'utf8' });
            execSync(`sudo mount /dev/${partition} ${mountPoint} 2>/dev/null || true`, { encoding: 'utf8' });
            execSync(`sudo mkdir -p ${mountPoint}/.snapraid`, { encoding: 'utf8' });

            dataMounts.push({ disk: disk.id, partition, mountPoint, num: diskNum });
            results.push(`Mounted /dev/${partition} at ${mountPoint}`);
            diskNum++;
        }

        let parityNum = 1;
        for (const disk of parityDisks) {
            const partition = disk.id.includes('nvme') ? `${disk.id}p1` : `${disk.id}1`;
            const mountPoint = `/mnt/parity${parityNum}`;

            execSync(`sudo mkdir -p ${mountPoint}`, { encoding: 'utf8' });
            execSync(`sudo mount /dev/${partition} ${mountPoint} 2>/dev/null || true`, { encoding: 'utf8' });

            parityMounts.push({ disk: disk.id, partition, mountPoint, num: parityNum });
            results.push(`Mounted /dev/${partition} at ${mountPoint} (parity)`);
            parityNum++;
        }

        let cacheNum = 1;
        for (const disk of cacheDisks) {
            const partition = disk.id.includes('nvme') ? `${disk.id}p1` : `${disk.id}1`;
            const mountPoint = `${STORAGE_MOUNT_BASE}/cache${cacheNum}`;

            execSync(`sudo mkdir -p ${mountPoint}`, { encoding: 'utf8' });
            execSync(`sudo mount /dev/${partition} ${mountPoint} 2>/dev/null || true`, { encoding: 'utf8' });

            cacheMounts.push({ disk: disk.id, partition, mountPoint, num: cacheNum });
            results.push(`Mounted /dev/${partition} at ${mountPoint} (cache)`);
            cacheNum++;
        }

        // 3. Generate SnapRAID config
        let snapraidConf = `# HomePiNAS SnapRAID Configuration
# Generated: ${new Date().toISOString()}

# Parity files
`;
        parityMounts.forEach((p, i) => {
            if (i === 0) {
                snapraidConf += `parity ${p.mountPoint}/snapraid.parity\n`;
            } else {
                snapraidConf += `${i + 1}-parity ${p.mountPoint}/snapraid.parity\n`;
            }
        });

        snapraidConf += `\n# Content files (stored on data disks)\n`;
        dataMounts.forEach(d => {
            snapraidConf += `content ${d.mountPoint}/.snapraid/snapraid.content\n`;
        });

        snapraidConf += `\n# Data disks\n`;
        dataMounts.forEach(d => {
            snapraidConf += `disk d${d.num} ${d.mountPoint}\n`;
        });

        snapraidConf += `\n# Exclude files
exclude *.unrecoverable
exclude /tmp/
exclude /lost+found/
exclude .Thumbs.db
exclude .DS_Store
exclude *.!sync
exclude .AppleDouble
exclude ._AppleDouble
exclude .Spotlight-V100
exclude .TemporaryItems
exclude .Trashes
exclude .fseventsd
`;

        execSync(`echo '${snapraidConf}' | sudo tee ${SNAPRAID_CONF}`, { shell: '/bin/bash' });
        results.push('SnapRAID configuration created');

        // 4. Configure MergerFS
        const mergerfsSource = dataMounts.map(d => d.mountPoint).join(':');
        execSync(`sudo mkdir -p ${POOL_MOUNT}`, { encoding: 'utf8' });
        execSync(`sudo umount ${POOL_MOUNT} 2>/dev/null || true`, { encoding: 'utf8' });

        const mergerfsOpts = 'defaults,allow_other,use_ino,cache.files=partial,dropcacheonclose=true,category.create=mfs';
        execSync(`sudo mergerfs -o ${mergerfsOpts} ${mergerfsSource} ${POOL_MOUNT}`, { encoding: 'utf8' });
        results.push(`MergerFS pool mounted at ${POOL_MOUNT}`);

        // Set permissions
        try {
            execSync(`sudo chown -R :sambashare ${POOL_MOUNT}`, { encoding: 'utf8' });
            execSync(`sudo chmod -R 2775 ${POOL_MOUNT}`, { encoding: 'utf8' });
            results.push('Samba permissions configured');
        } catch (e) {
            results.push('Warning: Could not set Samba permissions');
        }

        // 5. Update /etc/fstab
        let fstabEntries = '\n# HomePiNAS Storage Configuration\n';

        dataMounts.forEach(d => {
            fstabEntries += `UUID=$(sudo blkid -s UUID -o value /dev/${d.partition}) ${d.mountPoint} ext4 defaults,nofail 0 2\n`;
        });

        parityMounts.forEach(p => {
            fstabEntries += `UUID=$(sudo blkid -s UUID -o value /dev/${p.partition}) ${p.mountPoint} ext4 defaults,nofail 0 2\n`;
        });

        cacheMounts.forEach(c => {
            fstabEntries += `UUID=$(sudo blkid -s UUID -o value /dev/${c.partition}) ${c.mountPoint} ext4 defaults,nofail 0 2\n`;
        });

        fstabEntries += `${mergerfsSource} ${POOL_MOUNT} fuse.mergerfs ${mergerfsOpts},nofail 0 0\n`;

        execSync(`sudo sed -i '/# HomePiNAS Storage/,/^$/d' /etc/fstab`, { encoding: 'utf8' });
        execSync(`echo '${fstabEntries}' | sudo tee -a /etc/fstab`, { shell: '/bin/bash' });
        results.push('Updated /etc/fstab for persistence');

        results.push('Starting initial SnapRAID sync (this may take a while)...');

        // Save storage config
        const data = getData();
        data.storageConfig = disks.map(d => ({ id: d.id, role: d.role }));
        data.poolConfigured = true;
        saveData(data);

        logSecurityEvent('STORAGE_CONFIGURED', { disks: disks.map(d => d.id), dataCount: dataDisks.length, parityCount: parityDisks.length }, req.ip);

        res.json({
            success: true,
            message: 'Storage pool configured successfully',
            results,
            poolMount: POOL_MOUNT
        });

    } catch (e) {
        console.error('Storage configuration error:', e);
        res.status(500).json({ error: `Failed to configure storage: ${e.message}` });
    }
});

// Run SnapRAID sync
router.post('/snapraid/sync', requireAuth, async (req, res) => {
    if (snapraidSyncStatus.running) {
        return res.status(409).json({ error: 'Sync already in progress', progress: snapraidSyncStatus.progress });
    }

    snapraidSyncStatus = {
        running: true,
        progress: 0,
        status: 'Starting sync...',
        startTime: Date.now(),
        error: null
    };

    const syncProcess = spawn('sudo', ['snapraid', 'sync', '-v'], {
        shell: '/bin/bash',
        stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';

    const parseOutput = (data) => {
        const text = data.toString();
        output += text;

        const lines = text.split('\n');
        for (const line of lines) {
            const progressMatch = line.match(/(\d+)%/);
            if (progressMatch) {
                snapraidSyncStatus.progress = parseInt(progressMatch[1]);
            }

            if (line.includes('completed') || line.includes('Nothing to do')) {
                snapraidSyncStatus.progress = 100;
                snapraidSyncStatus.status = 'Sync completed';
            }

            const fileMatch = line.match(/(\d+)\s+(files?|blocks?)/i);
            if (fileMatch) {
                snapraidSyncStatus.status = `Processing ${fileMatch[1]} ${fileMatch[2]}...`;
            }

            if (line.includes('Syncing')) {
                snapraidSyncStatus.status = line.trim().substring(0, 50);
            }

            if (line.includes('Self test') || line.includes('Verifying')) {
                snapraidSyncStatus.status = line.trim().substring(0, 50);
            }
        }
    };

    syncProcess.stdout.on('data', parseOutput);
    syncProcess.stderr.on('data', parseOutput);

    const progressSimulator = setInterval(() => {
        const elapsed = Date.now() - snapraidSyncStatus.startTime;

        if (snapraidSyncStatus.running && snapraidSyncStatus.progress === 0 && elapsed > 2000) {
            const simulatedProgress = Math.min(90, Math.floor((elapsed - 2000) / 100));
            if (simulatedProgress > snapraidSyncStatus.progress) {
                snapraidSyncStatus.progress = simulatedProgress;
                snapraidSyncStatus.status = 'Initializing parity data...';
            }
        }
    }, 500);

    syncProcess.on('close', (code) => {
        clearInterval(progressSimulator);

        if (code === 0) {
            snapraidSyncStatus.progress = 100;
            snapraidSyncStatus.status = 'Sync completed successfully';
            snapraidSyncStatus.error = null;
        } else {
            if (output.includes('Nothing to do')) {
                snapraidSyncStatus.progress = 100;
                snapraidSyncStatus.status = 'Already in sync (nothing to do)';
                snapraidSyncStatus.error = null;
            } else {
                snapraidSyncStatus.error = `Sync exited with code ${code}`;
                snapraidSyncStatus.status = 'Sync failed';
            }
        }
        snapraidSyncStatus.running = false;
        logSecurityEvent('SNAPRAID_SYNC_COMPLETE', { code, duration: Date.now() - snapraidSyncStatus.startTime }, '');
    });

    syncProcess.on('error', (err) => {
        clearInterval(progressSimulator);
        snapraidSyncStatus.error = err.message;
        snapraidSyncStatus.status = 'Sync failed to start';
        snapraidSyncStatus.running = false;
    });

    res.json({ success: true, message: 'SnapRAID sync started in background' });
});

// Get SnapRAID sync progress
router.get('/snapraid/sync/progress', (req, res) => {
    res.json(snapraidSyncStatus);
});

// Run SnapRAID scrub
router.post('/snapraid/scrub', requireAuth, async (req, res) => {
    try {
        execSync('sudo snapraid scrub -p 10', { encoding: 'utf8', timeout: 7200000 });
        logSecurityEvent('SNAPRAID_SCRUB', {}, req.ip);
        res.json({ success: true, message: 'SnapRAID scrub completed' });
    } catch (e) {
        console.error('SnapRAID scrub error:', e);
        res.status(500).json({ error: `SnapRAID scrub failed: ${e.message}` });
    }
});

// Get SnapRAID status
router.get('/snapraid/status', async (req, res) => {
    try {
        const status = execSync('sudo snapraid status 2>&1 || echo "Not configured"', { encoding: 'utf8' });
        res.json({ status });
    } catch (e) {
        res.json({ status: 'Not configured or error' });
    }
});

// Storage config
router.post('/config', (req, res) => {
    try {
        const { config } = req.body;
        const data = getData();

        if (data.storageConfig && data.storageConfig.length > 0) {
            const sessionId = req.headers['x-session-id'];
            const session = validateSession(sessionId);
            if (!session) {
                logSecurityEvent('UNAUTHORIZED_STORAGE_CHANGE', {}, req.ip);
                return res.status(401).json({ error: 'Authentication required' });
            }
        }

        if (!Array.isArray(config)) {
            return res.status(400).json({ error: 'Invalid configuration format' });
        }

        const validRoles = ['data', 'parity', 'cache', 'none'];
        for (const item of config) {
            if (!item.id || typeof item.id !== 'string') {
                return res.status(400).json({ error: 'Invalid disk ID in configuration' });
            }
            if (!item.role || !validRoles.includes(item.role)) {
                return res.status(400).json({ error: 'Invalid role in configuration' });
            }
        }

        data.storageConfig = config;
        saveData(data);

        logSecurityEvent('STORAGE_CONFIG', { disks: config.length }, req.ip);
        res.json({ success: true, message: 'Storage configuration saved' });
    } catch (e) {
        console.error('Storage config error:', e);
        res.status(500).json({ error: 'Failed to save storage configuration' });
    }
});

module.exports = router;
