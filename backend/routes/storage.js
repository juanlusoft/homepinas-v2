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
const { sanitizeDiskId, validateDiskConfig, escapeShellArg } = require('../utils/sanitize');

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

// Format size: GB → TB when appropriate
function formatSize(gb) {
    const num = parseFloat(gb) || 0;
    if (num >= 1024) {
        return (num / 1024).toFixed(1) + ' TB';
    }
    return Math.round(num) + ' GB';
}

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
            poolSize: formatSize(poolSize),
            poolUsed: formatSize(poolUsed),
            poolFree: formatSize(poolFree),
            lastSync
        });
    } catch (e) {
        console.error('Pool status error:', e);
        res.status(500).json({ error: 'Failed to get pool status' });
    }
});

/**
 * Middleware: allow during initial setup (no storage configured yet) OR with valid auth.
 * Like Synology DSM: the setup wizard doesn't require login since you just created the account.
 */
function requireAuthOrSetup(req, res, next) {
    const data = getData();
    // If no storage is configured yet, allow without auth (initial setup wizard)
    if (!data.storageConfig || data.storageConfig.length === 0) {
        return next();
    }
    // Otherwise require normal auth
    return requireAuth(req, res, next);
}

// Apply storage configuration
router.post('/pool/configure', requireAuthOrSetup, async (req, res) => {
    const { disks } = req.body;

    if (!disks || !Array.isArray(disks) || disks.length === 0) {
        return res.status(400).json({ error: 'No disks provided' });
    }

    // SECURITY: Validate all disk configurations using sanitize module
    const validatedDisks = validateDiskConfig(disks);
    if (!validatedDisks) {
        return res.status(400).json({ error: 'Invalid disk configuration. Check disk IDs and roles.' });
    }

    const dataDisks = validatedDisks.filter(d => d.role === 'data');
    const parityDisks = validatedDisks.filter(d => d.role === 'parity');
    const cacheDisks = validatedDisks.filter(d => d.role === 'cache');

    if (dataDisks.length === 0) {
        return res.status(400).json({ error: 'At least one data disk is required' });
    }

    // Parity is now optional - SnapRAID will only be configured if parity disks are present
    const { execFileSync } = require('child_process');

    try {
        const results = [];

        // 1. Format disks that need formatting
        for (const disk of validatedDisks) {
            if (disk.format) {
                // SECURITY: disk.id is now validated by sanitizeDiskId
                const safeDiskId = disk.id;
                results.push(`Formatting /dev/${safeDiskId}...`);
                try {
                    // SECURITY: Use execFileSync with explicit arguments instead of shell interpolation
                    execFileSync('sudo', ['parted', '-s', `/dev/${safeDiskId}`, 'mklabel', 'gpt'], { encoding: 'utf8', timeout: 30000 });
                    execFileSync('sudo', ['parted', '-s', `/dev/${safeDiskId}`, 'mkpart', 'primary', 'ext4', '0%', '100%'], { encoding: 'utf8', timeout: 30000 });
                    execFileSync('sudo', ['partprobe', `/dev/${safeDiskId}`], { encoding: 'utf8', timeout: 10000 });
                    execSync('sleep 2', { timeout: 5000 });

                    const partition = safeDiskId.includes('nvme') ? `${safeDiskId}p1` : `${safeDiskId}1`;
                    // SECURITY: Validate partition name too (derived from validated disk ID)
                    const safePartition = sanitizeDiskId(partition);
                    if (!safePartition) {
                        throw new Error('Invalid partition derived from disk ID');
                    }
                    const label = `${disk.role}_${safeDiskId}`.substring(0, 16); // ext4 label max 16 chars
                    execFileSync('sudo', ['mkfs.ext4', '-F', '-L', label, `/dev/${safePartition}`], { encoding: 'utf8', timeout: 300000 });
                    results.push(`Formatted /dev/${safePartition} as ext4`);
                } catch (e) {
                    results.push(`Warning: Format failed for ${safeDiskId}: ${e.message}`);
                }
            }
        }

        // 2. Create mount points and mount disks
        let diskNum = 1;
        const dataMounts = [];
        const parityMounts = [];
        const cacheMounts = [];

        for (const disk of dataDisks) {
            // SECURITY: disk.id already validated
            const safeDiskId = disk.id;
            const partition = safeDiskId.includes('nvme') ? `${safeDiskId}p1` : `${safeDiskId}1`;
            const safePartition = sanitizeDiskId(partition);
            if (!safePartition) continue;

            const mountPoint = `${STORAGE_MOUNT_BASE}/disk${diskNum}`;

            // SECURITY: Use execFileSync with explicit arguments
            execFileSync('sudo', ['mkdir', '-p', mountPoint], { encoding: 'utf8', timeout: 10000 });
            try {
                execFileSync('sudo', ['mount', `/dev/${safePartition}`, mountPoint], { encoding: 'utf8', timeout: 30000 });
            } catch (e) {
                // Mount may fail if already mounted, continue
            }
            execFileSync('sudo', ['mkdir', '-p', `${mountPoint}/.snapraid`], { encoding: 'utf8', timeout: 10000 });

            dataMounts.push({ disk: safeDiskId, partition: safePartition, mountPoint, num: diskNum });
            results.push(`Mounted /dev/${safePartition} at ${mountPoint}`);
            diskNum++;
        }

        let parityNum = 1;
        for (const disk of parityDisks) {
            const safeDiskId = disk.id;
            const partition = safeDiskId.includes('nvme') ? `${safeDiskId}p1` : `${safeDiskId}1`;
            const safePartition = sanitizeDiskId(partition);
            if (!safePartition) continue;

            const mountPoint = `/mnt/parity${parityNum}`;

            execFileSync('sudo', ['mkdir', '-p', mountPoint], { encoding: 'utf8', timeout: 10000 });
            try {
                execFileSync('sudo', ['mount', `/dev/${safePartition}`, mountPoint], { encoding: 'utf8', timeout: 30000 });
            } catch (e) {
                // Mount may fail if already mounted
            }

            parityMounts.push({ disk: safeDiskId, partition: safePartition, mountPoint, num: parityNum });
            results.push(`Mounted /dev/${safePartition} at ${mountPoint} (parity)`);
            parityNum++;
        }

        let cacheNum = 1;
        for (const disk of cacheDisks) {
            const safeDiskId = disk.id;
            const partition = safeDiskId.includes('nvme') ? `${safeDiskId}p1` : `${safeDiskId}1`;
            const safePartition = sanitizeDiskId(partition);
            if (!safePartition) continue;

            const mountPoint = `${STORAGE_MOUNT_BASE}/cache${cacheNum}`;

            execFileSync('sudo', ['mkdir', '-p', mountPoint], { encoding: 'utf8', timeout: 10000 });
            try {
                execFileSync('sudo', ['mount', `/dev/${safePartition}`, mountPoint], { encoding: 'utf8', timeout: 30000 });
            } catch (e) {
                // Mount may fail if already mounted
            }

            cacheMounts.push({ disk: safeDiskId, partition: safePartition, mountPoint, num: cacheNum });
            results.push(`Mounted /dev/${safePartition} at ${mountPoint} (cache)`);
            cacheNum++;
        }

        // 3. Generate SnapRAID config (only if parity disks are present)
        if (parityMounts.length > 0) {
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

            // SECURITY: Write config to temp file first, then use sudo to copy
            const tempConfFile = '/tmp/homepinas-snapraid-temp.conf';
            fs.writeFileSync(tempConfFile, snapraidConf, 'utf8');
            execFileSync('sudo', ['cp', tempConfFile, SNAPRAID_CONF], { encoding: 'utf8', timeout: 10000 });
            fs.unlinkSync(tempConfFile);
            results.push('SnapRAID configuration created');
        } else {
            results.push('SnapRAID skipped (no parity disks configured)');
        }

        // 4. Configure MergerFS
        const mergerfsSource = dataMounts.map(d => d.mountPoint).join(':');
        execFileSync('sudo', ['mkdir', '-p', POOL_MOUNT], { encoding: 'utf8', timeout: 10000 });
        try {
            execFileSync('sudo', ['umount', POOL_MOUNT], { encoding: 'utf8', timeout: 30000 });
        } catch (e) {
            // May not be mounted
        }

        const mergerfsOpts = 'defaults,allow_other,nonempty,use_ino,cache.files=partial,dropcacheonclose=true,category.create=mfs';
        execFileSync('sudo', ['mergerfs', '-o', mergerfsOpts, mergerfsSource, POOL_MOUNT], { encoding: 'utf8', timeout: 60000 });
        results.push(`MergerFS pool mounted at ${POOL_MOUNT}`);

        // Set permissions
        try {
            execFileSync('sudo', ['chown', '-R', ':sambashare', POOL_MOUNT], { encoding: 'utf8', timeout: 60000 });
            execFileSync('sudo', ['chmod', '-R', '2775', POOL_MOUNT], { encoding: 'utf8', timeout: 60000 });
            results.push('Samba permissions configured');
        } catch (e) {
            results.push('Warning: Could not set Samba permissions');
        }

        // 5. Update /etc/fstab
        // SECURITY: Build fstab entries with proper UUIDs fetched separately
        let fstabEntries = '\n# HomePiNAS Storage Configuration\n';

        for (const d of dataMounts) {
            try {
                const uuid = execFileSync('sudo', ['blkid', '-s', 'UUID', '-o', 'value', `/dev/${d.partition}`], 
                    { encoding: 'utf8', timeout: 10000 }).trim();
                if (uuid) {
                    fstabEntries += `UUID=${uuid} ${d.mountPoint} ext4 defaults,nofail 0 2\n`;
                }
            } catch (e) {
                // Skip if UUID can't be retrieved
            }
        }

        for (const p of parityMounts) {
            try {
                const uuid = execFileSync('sudo', ['blkid', '-s', 'UUID', '-o', 'value', `/dev/${p.partition}`],
                    { encoding: 'utf8', timeout: 10000 }).trim();
                if (uuid) {
                    fstabEntries += `UUID=${uuid} ${p.mountPoint} ext4 defaults,nofail 0 2\n`;
                }
            } catch (e) {
                // Skip if UUID can't be retrieved
            }
        }

        for (const c of cacheMounts) {
            try {
                const uuid = execFileSync('sudo', ['blkid', '-s', 'UUID', '-o', 'value', `/dev/${c.partition}`],
                    { encoding: 'utf8', timeout: 10000 }).trim();
                if (uuid) {
                    fstabEntries += `UUID=${uuid} ${c.mountPoint} ext4 defaults,nofail 0 2\n`;
                }
            } catch (e) {
                // Skip if UUID can't be retrieved
            }
        }

        fstabEntries += `${mergerfsSource} ${POOL_MOUNT} fuse.mergerfs ${mergerfsOpts},nofail 0 0\n`;

        // SECURITY: Write to temp file, then use sudo to append
        const tempFstabFile = '/tmp/homepinas-fstab-temp';
        fs.writeFileSync(tempFstabFile, fstabEntries, 'utf8');
        
        // Remove old HomePiNAS entries and append new ones
        execSync(`sudo sed -i '/# HomePiNAS Storage/,/^$/d' /etc/fstab`, { encoding: 'utf8', timeout: 10000 });
        execFileSync('sudo', ['sh', '-c', `cat ${tempFstabFile} >> /etc/fstab`], { encoding: 'utf8', timeout: 10000 });
        fs.unlinkSync(tempFstabFile);
        results.push('Updated /etc/fstab for persistence');

        results.push('Starting initial SnapRAID sync (this may take a while)...');

        // Save storage config (use validated disks)
        const data = getData();
        data.storageConfig = validatedDisks.map(d => ({ id: d.id, role: d.role }));
        data.poolConfigured = true;
        saveData(data);

        logSecurityEvent('STORAGE_CONFIGURED', { disks: validatedDisks.map(d => d.id), dataCount: dataDisks.length, parityCount: parityDisks.length }, req.ip);

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
    // SECURITY: Check for stale running state (timeout after 6 hours)
    const MAX_SYNC_TIME = 6 * 60 * 60 * 1000; // 6 hours
    if (snapraidSyncStatus.running) {
        const elapsed = Date.now() - snapraidSyncStatus.startTime;
        if (elapsed > MAX_SYNC_TIME) {
            // Force reset stale state
            logSecurityEvent('SNAPRAID_SYNC_TIMEOUT_RESET', { elapsed }, '');
            snapraidSyncStatus.running = false;
        } else {
            return res.status(409).json({ error: 'Sync already in progress', progress: snapraidSyncStatus.progress });
        }
    }

    snapraidSyncStatus = {
        running: true,
        progress: 0,
        status: 'Starting sync...',
        startTime: Date.now(),
        error: null
    };

    // SECURITY: Use spawn without shell option
    const syncProcess = spawn('sudo', ['snapraid', 'sync', '-v'], {
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
// NOTE: This endpoint allows initial config without auth (first-time setup),
// but requires auth if storage is already configured
router.post('/config', (req, res) => {
    try {
        const { config } = req.body;
        const data = getData();

        // SECURITY: Require auth if storage already configured
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

        // SECURITY: Use validateDiskConfig from sanitize module
        const validatedConfig = validateDiskConfig(config);
        if (!validatedConfig) {
            return res.status(400).json({ error: 'Invalid disk configuration. Check disk IDs and roles.' });
        }

        data.storageConfig = validatedConfig;
        saveData(data);

        logSecurityEvent('STORAGE_CONFIG', { disks: validatedConfig.length }, req.ip);
        res.json({ success: true, message: 'Storage configuration saved' });
    } catch (e) {
        console.error('Storage config error:', e);
        res.status(500).json({ error: 'Failed to save storage configuration' });
    }
});

module.exports = router;
