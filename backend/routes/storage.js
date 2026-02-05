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
        // Cache disks go FIRST so writes land on fast storage, then data disks
        const poolMounts = [...cacheMounts.map(c => c.mountPoint), ...dataMounts.map(d => d.mountPoint)];
        const mergerfsSource = poolMounts.join(':');
        execFileSync('sudo', ['mkdir', '-p', POOL_MOUNT], { encoding: 'utf8', timeout: 10000 });
        try {
            execFileSync('sudo', ['umount', POOL_MOUNT], { encoding: 'utf8', timeout: 30000 });
        } catch (e) {
            // May not be mounted
        }

        // If cache disks present: use lfs (least free space) so writes go to cache first,
        // moveonenospc to overflow to data disks when cache is full
        const hasCache = cacheMounts.length > 0;
        const createPolicy = hasCache ? 'lfs' : 'mfs';
        const cacheOpts = hasCache ? ',moveonenospc=true,minfreespace=20G' : '';
        const mergerfsOpts = `defaults,allow_other,nonempty,use_ino,cache.files=partial,dropcacheonclose=true,category.create=${createPolicy}${cacheOpts}`;
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

        // Helper: resolve UUID or fall back to /dev/path
        const addFstabEntry = (partition, mountPoint) => {
            try {
                const uuid = execFileSync('sudo', ['blkid', '-s', 'UUID', '-o', 'value', `/dev/${partition}`], 
                    { encoding: 'utf8', timeout: 10000 }).trim();
                if (uuid && uuid.length > 8 && !uuid.includes('$') && !uuid.includes('(')) {
                    fstabEntries += `UUID=${uuid} ${mountPoint} ext4 defaults,nofail 0 2\n`;
                    return;
                }
            } catch (e) {}
            // Fallback: use device path directly
            fstabEntries += `/dev/${partition} ${mountPoint} ext4 defaults,nofail 0 2\n`;
            results.push(`Warning: UUID not found for /dev/${partition}, using device path`);
        };

        for (const d of dataMounts) {
            addFstabEntry(d.partition, d.mountPoint);
        }

        for (const p of parityMounts) {
            addFstabEntry(p.partition, p.mountPoint);
        }

        for (const c of cacheMounts) {
            addFstabEntry(c.partition, c.mountPoint);
        }

        fstabEntries += `${mergerfsSource} ${POOL_MOUNT} fuse.mergerfs ${mergerfsOpts},nofail 0 0\n`;

        // SECURITY: Write to temp file, then use sudo to append
        const tempFstabFile = '/tmp/homepinas-fstab-temp';
        fs.writeFileSync(tempFstabFile, fstabEntries, 'utf8');
        
        // Remove ALL old HomePiNAS entries (comment + UUID/mergerfs lines until next non-HomePiNAS line)
        execSync(`sudo sed -i '/# HomePiNAS Storage/d; /\\/mnt\\/disks\\//d; /\\/mnt\\/parity/d; /\\/mnt\\/storage.*mergerfs/d' /etc/fstab`, { encoding: 'utf8', timeout: 10000 });
        // Remove trailing blank lines
        execSync(`sudo sed -i -e :a -e '/^\\n*$/{$d;N;ba' -e '}' /etc/fstab`, { encoding: 'utf8', timeout: 10000 });
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

// ════════════════════════════════════════════════════════════════════════════
// HYBRID DISK DETECTION - Detect new disks and let user decide what to do
// ════════════════════════════════════════════════════════════════════════════

/**
 * Get all block devices and their status
 * Returns: { configured: [...], unconfigured: [...] }
 */
router.get('/disks/detect', requireAuth, async (req, res) => {
    try {
        // Get all block devices with details
        const lsblkJson = execSync(
            'lsblk -Jbo NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL,SERIAL,TRAN 2>/dev/null || echo "{}"',
            { encoding: 'utf8' }
        );
        
        let devices = [];
        try {
            const parsed = JSON.parse(lsblkJson);
            devices = parsed.blockdevices || [];
        } catch (e) {
            console.error('Failed to parse lsblk:', e);
        }

        const data = getData();
        const configuredDisks = (data.storageConfig || []).map(d => d.id);
        
        // Get currently mounted disks in our pool
        const poolMounts = [];
        try {
            const mounts = execSync(`ls -1 ${STORAGE_MOUNT_BASE}/ 2>/dev/null || echo ""`, { encoding: 'utf8' });
            mounts.split('\n').filter(Boolean).forEach(m => poolMounts.push(m));
        } catch (e) {}

        const configured = [];
        const unconfigured = [];

        for (const dev of devices) {
            // Skip non-disk devices (loop, rom, etc)
            if (dev.type !== 'disk') continue;
            // Skip virtual/RAM disks
            if (dev.name.startsWith('zram') || dev.name.startsWith('ram') || dev.name.startsWith('loop')) continue;
            // Skip small devices (<1GB, likely USB sticks or boot media)
            if (dev.size < 1000000000) continue;
            // Skip mmcblk (SD card, usually boot)
            if (dev.name.startsWith('mmcblk')) continue;

            const diskInfo = {
                id: dev.name,
                path: `/dev/${dev.name}`,
                size: dev.size,
                sizeFormatted: formatSize(Math.round(dev.size / 1073741824)), // bytes to GB
                model: dev.model || 'Unknown',
                serial: dev.serial || '',
                transport: dev.tran || 'unknown',
                partitions: []
            };

            // Check partitions
            if (dev.children && dev.children.length > 0) {
                for (const part of dev.children) {
                    diskInfo.partitions.push({
                        name: part.name,
                        path: `/dev/${part.name}`,
                        size: part.size,
                        sizeFormatted: formatSize(Math.round(part.size / 1073741824)),
                        fstype: part.fstype || null,
                        mountpoint: part.mountpoint || null
                    });
                }
            }

            // Determine if configured or unconfigured
            const isConfigured = configuredDisks.includes(dev.name) || 
                                 diskInfo.partitions.some(p => p.mountpoint && p.mountpoint.startsWith(STORAGE_MOUNT_BASE));
            
            if (isConfigured) {
                // Find role from config
                const configEntry = (data.storageConfig || []).find(d => d.id === dev.name);
                diskInfo.role = configEntry ? configEntry.role : 'data';
                diskInfo.inPool = true;
                configured.push(diskInfo);
            } else {
                diskInfo.inPool = false;
                // Check if it has a filesystem
                diskInfo.hasData = diskInfo.partitions.some(p => p.fstype);
                diskInfo.formatted = diskInfo.partitions.some(p => ['ext4', 'xfs', 'btrfs', 'ntfs'].includes(p.fstype));
                unconfigured.push(diskInfo);
            }
        }

        res.json({ configured, unconfigured });
    } catch (e) {
        console.error('Disk detection error:', e);
        res.status(500).json({ error: 'Failed to detect disks' });
    }
});

/**
 * Add a disk to the MergerFS pool
 * POST /disks/add-to-pool
 * Body: { diskId: 'sdb', format: true/false, role: 'data'|'cache' }
 */
router.post('/disks/add-to-pool', requireAuth, async (req, res) => {
    try {
        const { diskId, format, role = 'data' } = req.body;
        
        // Validate disk ID
        const safeDiskId = sanitizeDiskId(diskId);
        if (!safeDiskId) {
            return res.status(400).json({ error: 'Invalid disk ID' });
        }
        
        if (!['data', 'cache', 'parity'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role. Must be data, cache, or parity' });
        }

        const devicePath = `/dev/${safeDiskId}`;
        const partitionPath = `/dev/${safeDiskId}1`;
        
        // Check if device exists
        if (!fs.existsSync(devicePath)) {
            return res.status(400).json({ error: `Device ${devicePath} not found` });
        }

        // Step 1: Create partition if needed (for new disks)
        try {
            execSync(`sudo parted -s ${escapeShellArg(devicePath)} mklabel gpt`, { encoding: 'utf8' });
            execSync(`sudo parted -s ${escapeShellArg(devicePath)} mkpart primary ext4 0% 100%`, { encoding: 'utf8' });
            execSync('sync', { encoding: 'utf8' });
            // Wait for partition to appear
            execSync('sleep 2', { encoding: 'utf8' });
        } catch (e) {
            // Partition might already exist, that's fine
            console.log('Partition creation skipped or failed (may already exist):', e.message);
        }

        // Step 2: Format if requested
        if (format) {
            const label = `${role}_${safeDiskId}`.substring(0, 16);
            try {
                execSync(`sudo mkfs.ext4 -F -L ${escapeShellArg(label)} ${escapeShellArg(partitionPath)}`, { encoding: 'utf8' });
            } catch (e) {
                return res.status(500).json({ error: `Format failed: ${e.message}` });
            }
        }

        // Step 3: Get UUID
        let uuid = '';
        try {
            uuid = execSync(`sudo blkid -s UUID -o value ${escapeShellArg(partitionPath)} 2>/dev/null`, { encoding: 'utf8' }).trim();
        } catch (e) {
            return res.status(500).json({ error: 'Failed to get disk UUID' });
        }

        if (!uuid) {
            return res.status(500).json({ error: 'Could not determine disk UUID. Is it formatted?' });
        }

        // Step 4: Create mount point
        const mountIndex = await getNextDiskIndex();
        const mountPoint = `${STORAGE_MOUNT_BASE}/disk${mountIndex}`;
        
        try {
            execSync(`sudo mkdir -p ${escapeShellArg(mountPoint)}`, { encoding: 'utf8' });
        } catch (e) {
            return res.status(500).json({ error: 'Failed to create mount point' });
        }

        // Step 5: Mount the disk
        try {
            execSync(`sudo mount UUID=${escapeShellArg(uuid)} ${escapeShellArg(mountPoint)}`, { encoding: 'utf8' });
        } catch (e) {
            return res.status(500).json({ error: `Mount failed: ${e.message}` });
        }

        // Step 6: Add to fstab
        const fstabEntry = `UUID=${uuid} ${mountPoint} ext4 defaults,nofail 0 2`;
        try {
            // Check if entry already exists
            const fstab = execSync('cat /etc/fstab', { encoding: 'utf8' });
            if (!fstab.includes(uuid)) {
                const tempFile = `/tmp/fstab-add-${Date.now()}`;
                fs.writeFileSync(tempFile, `\n# HomePiNAS: ${safeDiskId} (${role})\n${fstabEntry}\n`);
                execSync(`sudo sh -c 'cat ${escapeShellArg(tempFile)} >> /etc/fstab'`, { encoding: 'utf8' });
                fs.unlinkSync(tempFile);
            }
        } catch (e) {
            console.error('fstab update failed:', e);
            // Continue anyway, disk is mounted
        }

        // Step 7: Add to MergerFS pool
        try {
            await addDiskToMergerFS(mountPoint, role);
        } catch (e) {
            return res.status(500).json({ error: `Failed to add to pool: ${e.message}` });
        }

        // Step 8: Update storage config
        const data = getData();
        if (!data.storageConfig) data.storageConfig = [];
        data.storageConfig.push({
            id: safeDiskId,
            role: role,
            uuid: uuid,
            mountPoint: mountPoint,
            addedAt: new Date().toISOString()
        });
        saveData(data);

        logSecurityEvent('DISK_ADDED_TO_POOL', { diskId: safeDiskId, role, mountPoint }, req.ip);

        res.json({ 
            success: true, 
            message: `Disk ${safeDiskId} added to pool as ${role}`,
            mountPoint,
            uuid
        });
    } catch (e) {
        console.error('Add to pool error:', e);
        res.status(500).json({ error: `Failed to add disk: ${e.message}` });
    }
});

/**
 * Mount disk as standalone volume (not in pool)
 * POST /disks/mount-standalone
 * Body: { diskId: 'sdb', format: true/false, name: 'backups' }
 */
router.post('/disks/mount-standalone', requireAuth, async (req, res) => {
    try {
        const { diskId, format, name } = req.body;
        
        const safeDiskId = sanitizeDiskId(diskId);
        if (!safeDiskId) {
            return res.status(400).json({ error: 'Invalid disk ID' });
        }

        // Sanitize volume name
        const safeName = (name || safeDiskId).replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32);
        if (!safeName) {
            return res.status(400).json({ error: 'Invalid volume name' });
        }

        const devicePath = `/dev/${safeDiskId}`;
        const partitionPath = `/dev/${safeDiskId}1`;
        const mountPoint = `/mnt/${safeName}`;

        if (!fs.existsSync(devicePath)) {
            return res.status(400).json({ error: `Device ${devicePath} not found` });
        }

        // Create partition if needed
        try {
            execSync(`sudo parted -s ${escapeShellArg(devicePath)} mklabel gpt`, { encoding: 'utf8' });
            execSync(`sudo parted -s ${escapeShellArg(devicePath)} mkpart primary ext4 0% 100%`, { encoding: 'utf8' });
            execSync('sleep 2', { encoding: 'utf8' });
        } catch (e) {
            console.log('Partition exists or creation skipped');
        }

        // Format if requested
        if (format) {
            try {
                execSync(`sudo mkfs.ext4 -F -L ${escapeShellArg(safeName)} ${escapeShellArg(partitionPath)}`, { encoding: 'utf8' });
            } catch (e) {
                return res.status(500).json({ error: `Format failed: ${e.message}` });
            }
        }

        // Get UUID
        let uuid = '';
        try {
            uuid = execSync(`sudo blkid -s UUID -o value ${escapeShellArg(partitionPath)} 2>/dev/null`, { encoding: 'utf8' }).trim();
        } catch (e) {
            return res.status(500).json({ error: 'Failed to get UUID' });
        }

        // Create mount point and mount
        try {
            execSync(`sudo mkdir -p ${escapeShellArg(mountPoint)}`, { encoding: 'utf8' });
            execSync(`sudo mount UUID=${escapeShellArg(uuid)} ${escapeShellArg(mountPoint)}`, { encoding: 'utf8' });
        } catch (e) {
            return res.status(500).json({ error: `Mount failed: ${e.message}` });
        }

        // Add to fstab
        const fstabEntry = `UUID=${uuid} ${mountPoint} ext4 defaults,nofail 0 2`;
        try {
            const fstab = execSync('cat /etc/fstab', { encoding: 'utf8' });
            if (!fstab.includes(uuid)) {
                const tempFile = `/tmp/fstab-standalone-${Date.now()}`;
                fs.writeFileSync(tempFile, `\n# HomePiNAS: Standalone volume ${safeName}\n${fstabEntry}\n`);
                execSync(`sudo sh -c 'cat ${escapeShellArg(tempFile)} >> /etc/fstab'`, { encoding: 'utf8' });
                fs.unlinkSync(tempFile);
            }
        } catch (e) {
            console.error('fstab update failed:', e);
        }

        // Save to config as standalone volume
        const data = getData();
        if (!data.standaloneVolumes) data.standaloneVolumes = [];
        data.standaloneVolumes.push({
            id: safeDiskId,
            name: safeName,
            uuid: uuid,
            mountPoint: mountPoint,
            addedAt: new Date().toISOString()
        });
        saveData(data);

        logSecurityEvent('STANDALONE_VOLUME_CREATED', { diskId: safeDiskId, name: safeName, mountPoint }, req.ip);

        res.json({
            success: true,
            message: `Volume "${safeName}" created at ${mountPoint}`,
            mountPoint,
            uuid
        });
    } catch (e) {
        console.error('Standalone mount error:', e);
        res.status(500).json({ error: `Failed: ${e.message}` });
    }
});

/**
 * Dismiss/ignore a detected disk (won't show in notifications)
 * POST /disks/ignore
 */
router.post('/disks/ignore', requireAuth, async (req, res) => {
    try {
        const { diskId } = req.body;
        const safeDiskId = sanitizeDiskId(diskId);
        if (!safeDiskId) {
            return res.status(400).json({ error: 'Invalid disk ID' });
        }

        const data = getData();
        if (!data.ignoredDisks) data.ignoredDisks = [];
        if (!data.ignoredDisks.includes(safeDiskId)) {
            data.ignoredDisks.push(safeDiskId);
            saveData(data);
        }

        res.json({ success: true, message: `Disk ${safeDiskId} ignored` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Get list of ignored disks
 */
router.get('/disks/ignored', requireAuth, (req, res) => {
    const data = getData();
    res.json({ ignored: data.ignoredDisks || [] });
});

/**
 * Un-ignore a disk
 */
router.post('/disks/unignore', requireAuth, async (req, res) => {
    try {
        const { diskId } = req.body;
        const data = getData();
        if (data.ignoredDisks) {
            data.ignoredDisks = data.ignoredDisks.filter(d => d !== diskId);
            saveData(data);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Helper: Get next disk index for mount point
async function getNextDiskIndex() {
    try {
        const existing = execSync(`ls -1 ${STORAGE_MOUNT_BASE}/ 2>/dev/null || echo ""`, { encoding: 'utf8' });
        const disks = existing.split('\n').filter(d => d.startsWith('disk'));
        const indices = disks.map(d => parseInt(d.replace('disk', '')) || 0);
        return Math.max(0, ...indices) + 1;
    } catch (e) {
        return 1;
    }
}

// Helper: Add disk to MergerFS pool (hot add)
async function addDiskToMergerFS(mountPoint, role) {
    try {
        // Check if MergerFS is currently mounted
        let currentSources = '';
        let isMounted = false;
        
        try {
            const mounts = execSync('mount | grep mergerfs', { encoding: 'utf8' }).trim();
            if (mounts) {
                isMounted = true;
                const match = mounts.match(/^(.+?) on \/mnt\/storage type fuse\.mergerfs/);
                if (match) {
                    currentSources = match[1];
                }
            }
        } catch (e) {
            // MergerFS not mounted, that's OK
            isMounted = false;
        }

        // Build new sources list
        let newSources;
        if (currentSources) {
            // Add to existing sources
            if (role === 'cache') {
                newSources = `${mountPoint}:${currentSources}`;
            } else {
                newSources = `${currentSources}:${mountPoint}`;
            }
        } else {
            // First disk in pool or MergerFS not running
            // Scan for all mounted data disks in /mnt/disks
            const diskDirs = fs.readdirSync(STORAGE_MOUNT_BASE)
                .filter(d => d.startsWith('disk'))
                .map(d => `${STORAGE_MOUNT_BASE}/${d}`)
                .filter(p => {
                    try {
                        // Check if it's a mount point (has something mounted)
                        const stat = execSync(`mountpoint -q ${escapeShellArg(p)} && echo yes || echo no`, { encoding: 'utf8' }).trim();
                        return stat === 'yes';
                    } catch {
                        return false;
                    }
                });
            
            // Include the new mount point if not already in list
            if (!diskDirs.includes(mountPoint)) {
                diskDirs.push(mountPoint);
            }
            
            if (diskDirs.length === 0) {
                throw new Error('No disks available for pool');
            }
            
            newSources = diskDirs.join(':');
        }

        // Unmount if currently mounted
        if (isMounted) {
            try {
                execSync(`sudo umount ${POOL_MOUNT}`, { encoding: 'utf8' });
            } catch (e) {
                console.error('Failed to unmount MergerFS:', e.message);
                // Try lazy unmount
                try {
                    execSync(`sudo umount -l ${POOL_MOUNT}`, { encoding: 'utf8' });
                } catch (e2) {
                    throw new Error('Cannot unmount MergerFS pool. Files may be in use.');
                }
            }
        }

        // Create pool mount point if needed
        if (!fs.existsSync(POOL_MOUNT)) {
            execSync(`sudo mkdir -p ${POOL_MOUNT}`, { encoding: 'utf8' });
        }

        // Determine policy
        const hasCache = newSources.includes('cache') || role === 'cache';
        const policy = hasCache ? 'lfs' : 'mfs';
        
        // Mount MergerFS
        execSync(
            `sudo mergerfs -o defaults,allow_other,nonempty,use_ino,cache.files=partial,dropcacheonclose=true,category.create=${policy},moveonenospc=true,nofail ${escapeShellArg(newSources)} ${POOL_MOUNT}`,
            { encoding: 'utf8' }
        );

        // Update fstab for MergerFS
        updateMergerFSFstab(newSources, policy);

        return true;
    } catch (e) {
        console.error('MergerFS add disk failed:', e);
        throw e;
    }
}

// Update MergerFS line in fstab
function updateMergerFSFstab(sources, policy = 'mfs') {
    try {
        const fstabPath = '/etc/fstab';
        let fstab = fs.readFileSync(fstabPath, 'utf8');
        
        // New MergerFS fstab entry
        const newEntry = `${sources} ${POOL_MOUNT} fuse.mergerfs defaults,allow_other,nonempty,use_ino,cache.files=partial,dropcacheonclose=true,category.create=${policy},moveonenospc=true,nofail 0 0`;
        
        // Check if MergerFS entry exists
        const mergerfsRegex = /^.*\/mnt\/storage\s+fuse\.mergerfs.*$/gm;
        
        if (fstab.match(mergerfsRegex)) {
            // Replace existing entry
            fstab = fstab.replace(mergerfsRegex, `# HomePiNAS MergerFS Pool\n${newEntry}`);
        } else {
            // Add new entry
            fstab += `\n# HomePiNAS MergerFS Pool\n${newEntry}\n`;
        }
        
        // Write to temp file and copy (for safety)
        const tempFile = `/tmp/fstab-mergerfs-${Date.now()}`;
        fs.writeFileSync(tempFile, fstab);
        execSync(`sudo cp ${escapeShellArg(tempFile)} ${fstabPath}`, { encoding: 'utf8' });
        fs.unlinkSync(tempFile);
        
        console.log('Updated MergerFS fstab entry:', newEntry);
    } catch (e) {
        console.error('Failed to update MergerFS fstab:', e);
        // Don't throw - the mount worked, fstab is just for persistence
    }
}

// ════════════════════════════════════════════════════════════════════════════

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
