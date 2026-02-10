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

// Get storage pool status (real-time)
router.get('/pool/status', requireAuth, async (req, res) => {
    try {
        const status = {
            // MergerFS status
            mergerfs: {
                running: false,
                mountPoint: POOL_MOUNT,
                sources: [],
                systemdUnit: 'unknown'
            },
            // SnapRAID status
            snapraid: {
                configured: false,
                dataDisks: 0,
                parityDisks: 0,
                lastSync: null,
                syncStatus: 'unknown'
            },
            // Pool capacity
            capacity: {
                total: '0 GB',
                used: '0 GB',
                free: '0 GB',
                usedPercent: 0
            },
            // Individual disks in pool
            disks: [],
            // Overall health
            health: 'unknown',
            warnings: []
        };

        // ══════════════════════════════════════════════════════════════════
        // 1. Check MergerFS status
        // ══════════════════════════════════════════════════════════════════
        try {
            const mounts = execSync('mount | grep mergerfs || echo ""', { encoding: 'utf8' });
            if (mounts.includes('mergerfs')) {
                status.mergerfs.running = true;
                
                // Extract source paths from mount output
                const match = mounts.match(/^(.+?) on \/mnt\/storage type fuse\.mergerfs/);
                if (match) {
                    status.mergerfs.sources = match[1].split(':').filter(s => s);
                }
                
                // Get pool capacity
                const df = execSync(`df -BG ${POOL_MOUNT} 2>/dev/null | tail -1`, { encoding: 'utf8' });
                const parts = df.trim().split(/\s+/);
                if (parts.length >= 5) {
                    const total = parseInt(parts[1]) || 0;
                    const used = parseInt(parts[2]) || 0;
                    const free = parseInt(parts[3]) || 0;
                    const usedPercent = parseInt(parts[4]) || 0;
                    
                    status.capacity.total = formatSize(total);
                    status.capacity.used = formatSize(used);
                    status.capacity.free = formatSize(free);
                    status.capacity.usedPercent = usedPercent;
                    
                    // Warn if pool is getting full
                    if (usedPercent > 90) {
                        status.warnings.push('Pool is over 90% full');
                    } else if (usedPercent > 80) {
                        status.warnings.push('Pool is over 80% full');
                    }
                }
            }
        } catch (e) {
            console.log('MergerFS status check failed:', e.message);
        }

        // Check systemd mount unit status
        try {
            const unitStatus = execSync('systemctl is-active mnt-storage.mount 2>/dev/null || echo "inactive"', { encoding: 'utf8' }).trim();
            status.mergerfs.systemdUnit = unitStatus;
        } catch (e) {
            status.mergerfs.systemdUnit = 'not-found';
        }

        // ══════════════════════════════════════════════════════════════════
        // 2. Check SnapRAID status
        // ══════════════════════════════════════════════════════════════════
        try {
            const snapraidConf = execSync(`cat ${SNAPRAID_CONF} 2>/dev/null || echo ""`, { encoding: 'utf8' });
            if (snapraidConf.includes('content') && snapraidConf.includes('disk')) {
                status.snapraid.configured = true;
                
                // Count data and parity disks from config
                const dataMatches = snapraidConf.match(/^disk\s+/gm);
                const parityMatches = snapraidConf.match(/^(\d+-)?parity\s+/gm);
                status.snapraid.dataDisks = dataMatches ? dataMatches.length : 0;
                status.snapraid.parityDisks = parityMatches ? parityMatches.length : 0;
            }
        } catch (e) {}

        // Get last sync time
        try {
            const logContent = execSync('tail -50 /var/log/snapraid-sync.log 2>/dev/null || echo ""', { encoding: 'utf8' });
            const syncMatch = logContent.match(/=== SnapRAID Sync Finished: (.+?) ===/);
            if (syncMatch) {
                status.snapraid.lastSync = syncMatch[1].trim();
            }
            
            // Check sync status
            if (logContent.includes('Sync completed successfully')) {
                status.snapraid.syncStatus = 'ok';
            } else if (logContent.includes('ERROR')) {
                status.snapraid.syncStatus = 'error';
                status.warnings.push('Last SnapRAID sync had errors');
            }
        } catch (e) {}

        // ══════════════════════════════════════════════════════════════════
        // 3. Get individual disk status
        // ══════════════════════════════════════════════════════════════════
        
        // Get disk serials and models from lsblk
        let diskDetails = {};
        try {
            const lsblkJson = execSync('lsblk -Jbo NAME,MODEL,SERIAL 2>/dev/null || echo "{}"', { encoding: 'utf8' });
            const parsed = JSON.parse(lsblkJson);
            for (const dev of (parsed.blockdevices || [])) {
                diskDetails[dev.name] = { model: dev.model || '', serial: dev.serial || '' };
            }
        } catch (e) {}
        
        const data = getData();
        const configuredDisks = data.storageConfig || [];
        
        for (const diskConf of configuredDisks) {
            const details = diskDetails[diskConf.id] || {};
            const diskInfo = {
                id: diskConf.id,
                role: diskConf.role,
                mountPoint: diskConf.mountPoint || 'unknown',
                mounted: false,
                size: '0 GB',
                used: '0 GB',
                free: '0 GB',
                health: 'unknown',
                model: details.model || 'Unknown',
                serial: details.serial || ''
            };
            
            // Check if mounted
            if (diskConf.mountPoint) {
                try {
                    const mountCheck = execSync(`mountpoint -q ${escapeShellArg(diskConf.mountPoint)} && echo "yes" || echo "no"`, { encoding: 'utf8' }).trim();
                    diskInfo.mounted = mountCheck === 'yes';
                    
                    if (diskInfo.mounted) {
                        // Get disk capacity
                        const df = execSync(`df -BG ${escapeShellArg(diskConf.mountPoint)} 2>/dev/null | tail -1`, { encoding: 'utf8' });
                        const parts = df.trim().split(/\s+/);
                        if (parts.length >= 4) {
                            diskInfo.size = formatSize(parseInt(parts[1]) || 0);
                            diskInfo.used = formatSize(parseInt(parts[2]) || 0);
                            diskInfo.free = formatSize(parseInt(parts[3]) || 0);
                        }
                    } else {
                        status.warnings.push(`Disk ${diskConf.id} is not mounted`);
                    }
                } catch (e) {}
            }
            
            // Get SMART health (quick check)
            try {
                const smartResult = execSync(`sudo smartctl -H /dev/${escapeShellArg(diskConf.id)} 2>/dev/null | grep -i "SMART overall-health" || echo ""`, { encoding: 'utf8' });
                if (smartResult.toLowerCase().includes('passed')) {
                    diskInfo.health = 'healthy';
                } else if (smartResult.toLowerCase().includes('failed')) {
                    diskInfo.health = 'failing';
                    status.warnings.push(`Disk ${diskConf.id} SMART status: FAILING`);
                }
            } catch (e) {}
            
            status.disks.push(diskInfo);
        }

        // ══════════════════════════════════════════════════════════════════
        // 4. Determine overall health
        // ══════════════════════════════════════════════════════════════════
        if (status.warnings.length === 0 && status.mergerfs.running) {
            status.health = 'healthy';
        } else if (status.warnings.some(w => w.includes('FAILING') || w.includes('not mounted'))) {
            status.health = 'degraded';
        } else if (!status.mergerfs.running && configuredDisks.length > 0) {
            status.health = 'offline';
        } else if (status.warnings.length > 0) {
            status.health = 'warning';
        } else {
            status.health = 'unconfigured';
        }

        // Legacy fields for backward compatibility
        res.json({
            ...status,
            // Legacy fields
            configured: status.snapraid.configured || configuredDisks.length > 0,
            running: status.mergerfs.running,
            poolMount: POOL_MOUNT,
            poolSize: status.capacity.total,
            poolUsed: status.capacity.used,
            poolFree: status.capacity.free,
            lastSync: status.snapraid.lastSync
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

        // Add MergerFS entry to fstab for persistence
        // Using fstab with nofail ensures it mounts at boot even if there are timing issues
        fstabEntries += `# MergerFS Pool\n`;
        fstabEntries += `${mergerfsSource} ${POOL_MOUNT} fuse.mergerfs ${mergerfsOpts},nofail 0 0\n`;

        // SECURITY: Write to temp file, then use sudo to append
        const tempFstabFile = '/tmp/homepinas-fstab-temp';
        fs.writeFileSync(tempFstabFile, fstabEntries, 'utf8');
        
        // Remove ALL old HomePiNAS entries (comment + UUID/mergerfs lines)
        execSync(`sudo sed -i '/# HomePiNAS Storage/d; /# MergerFS Pool/d; /\\/mnt\\/disks\\//d; /\\/mnt\\/parity/d; /\\/mnt\\/storage.*mergerfs/d; /\\/mnt\\/storage.*fuse\\.mergerfs/d' /etc/fstab`, { encoding: 'utf8', timeout: 10000 });
        // Remove trailing blank lines
        execSync(`sudo sed -i -e :a -e '/^\\n*$/{$d;N;ba' -e '}' /etc/fstab`, { encoding: 'utf8', timeout: 10000 });
        execFileSync('sudo', ['sh', '-c', `cat ${tempFstabFile} >> /etc/fstab`], { encoding: 'utf8', timeout: 10000 });
        fs.unlinkSync(tempFstabFile);
        results.push('Updated /etc/fstab for persistence (including MergerFS)');

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
        // Provide clearer error message for common sudo issues
        let userMessage = 'Failed to configure storage';
        if (e.message && e.message.includes('unable to change to root gid')) {
            userMessage = 'Error de permisos: sudo no puede ejecutarse correctamente. Verifica que el servicio HomePiNAS se ejecuta con el usuario correcto y que /etc/sudoers está configurado. Ejecuta: sudo visudo';
        } else if (e.message && e.message.includes('not allowed')) {
            userMessage = 'Error de permisos: el usuario actual no tiene permisos sudo. Ejecuta: sudo usermod -aG sudo homepinas';
        }
        res.status(500).json({ error: userMessage });
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
router.get('/snapraid/sync/progress', requireAuth, (req, res) => {
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
router.get('/snapraid/status', requireAuth, async (req, res) => {
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
 * Body: { diskId: 'sdb', format: true/false, role: 'data'|'cache', force: false }
 * 
 * Validations performed:
 * 1. Disk ID is valid and sanitized
 * 2. Device exists in /dev
 * 3. Device is a block device (not a file or directory)
 * 4. If has existing data and format=false, warns but allows with force=true
 * 5. Partition is valid and mountable
 */
router.post('/disks/add-to-pool', requireAuth, async (req, res) => {
    try {
        const { diskId, format, role = 'data', force = false } = req.body;
        
        // ══════════════════════════════════════════════════════════════════
        // VALIDATION PHASE
        // ══════════════════════════════════════════════════════════════════
        
        // 1. Validate disk ID format
        const safeDiskId = sanitizeDiskId(diskId);
        if (!safeDiskId) {
            return res.status(400).json({ 
                error: 'Invalid disk ID format',
                details: 'Disk ID must be alphanumeric (e.g., sda, nvme0n1)'
            });
        }
        
        // 2. Validate role
        if (!['data', 'cache', 'parity'].includes(role)) {
            return res.status(400).json({ 
                error: 'Invalid role',
                details: 'Role must be: data, cache, or parity'
            });
        }

        const devicePath = `/dev/${safeDiskId}`;
        
        // 3. Check if device exists
        if (!fs.existsSync(devicePath)) {
            return res.status(400).json({ 
                error: 'Device not found',
                details: `${devicePath} does not exist. Is the disk connected?`
            });
        }
        
        // 4. Verify it's a block device
        try {
            const statResult = execSync(`stat -c '%F' ${escapeShellArg(devicePath)} 2>/dev/null`, { encoding: 'utf8' }).trim();
            if (!statResult.includes('block')) {
                return res.status(400).json({
                    error: 'Not a block device',
                    details: `${devicePath} is not a valid disk device`
                });
            }
        } catch (e) {
            return res.status(400).json({
                error: 'Cannot verify device',
                details: `Failed to stat ${devicePath}: ${e.message}`
            });
        }
        
        // 5. Check if disk is already in the pool
        const data = getData();
        const existingDisk = (data.storageConfig || []).find(d => d.id === safeDiskId);
        if (existingDisk) {
            return res.status(400).json({
                error: 'Disk already in pool',
                details: `${safeDiskId} is already configured as ${existingDisk.role}`
            });
        }
        
        // 6. Get disk info and check for existing partitions/data
        let hasPartition = false;
        let hasFilesystem = false;
        let hasData = false;
        let partitionPath = '';
        let diskSize = 0;
        
        try {
            // Check for existing partitions using lsblk
            const lsblkJson = execSync(
                `lsblk -Jbo NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT /dev/${escapeShellArg(safeDiskId)} 2>/dev/null || echo "{}"`,
                { encoding: 'utf8' }
            );
            const lsblk = JSON.parse(lsblkJson);
            const device = (lsblk.blockdevices || [])[0];
            
            if (device) {
                diskSize = device.size || 0;
                
                if (device.children && device.children.length > 0) {
                    hasPartition = true;
                    const firstPart = device.children[0];
                    partitionPath = `/dev/${firstPart.name}`;
                    
                    if (firstPart.fstype) {
                        hasFilesystem = true;
                    }
                    
                    // Check if mounted somewhere (indicates data)
                    if (firstPart.mountpoint) {
                        hasData = true;
                    }
                }
            }
        } catch (e) {
            console.log('lsblk check failed, continuing:', e.message);
        }
        
        // Determine partition path (for NVMe vs SATA)
        if (!partitionPath) {
            partitionPath = safeDiskId.includes('nvme') ? `/dev/${safeDiskId}p1` : `/dev/${safeDiskId}1`;
        }
        
        // 7. If disk has existing filesystem and format=false, require confirmation
        if (hasFilesystem && !format && !force) {
            return res.status(409).json({
                error: 'Disk has existing data',
                details: `${safeDiskId} has an existing filesystem. Set format=true to erase, or force=true to use existing data`,
                hasData: true,
                requiresConfirmation: true
            });
        }
        
        // 8. Verify disk is not the boot disk
        try {
            const rootDevice = execSync('findmnt -n -o SOURCE / 2>/dev/null | sed "s/[0-9]*$//" | sed "s/p[0-9]*$//"', { encoding: 'utf8' }).trim();
            if (rootDevice.includes(safeDiskId)) {
                return res.status(400).json({
                    error: 'Cannot use boot disk',
                    details: 'This appears to be the system boot disk'
                });
            }
        } catch (e) {
            // Ignore - extra safety check
        }
        
        // ══════════════════════════════════════════════════════════════════
        // PREPARATION PHASE
        // ══════════════════════════════════════════════════════════════════
        
        // Step 1: Unmount ALL partitions of this disk (MUST be first!)
        try {
            // Find all mount points for this disk (any partition)
            const mountCheck = execSync(`mount | grep "/dev/${safeDiskId}" || true`, { encoding: 'utf8' });
            if (mountCheck.trim()) {
                console.log(`Unmounting all partitions of /dev/${safeDiskId}...`);
                const mountLines = mountCheck.trim().split('\n');
                for (const line of mountLines) {
                    const mountedDev = line.split(' ')[0];
                    if (mountedDev) {
                        console.log(`  Unmounting ${mountedDev}...`);
                        try {
                            execSync(`sudo umount ${escapeShellArg(mountedDev)} 2>/dev/null || sudo umount -l ${escapeShellArg(mountedDev)} 2>/dev/null || true`, { encoding: 'utf8' });
                        } catch (e) {
                            console.log(`  Failed to unmount ${mountedDev}: ${e.message}`);
                        }
                    }
                }
                // Wait for unmount to complete
                execSync('sleep 1', { encoding: 'utf8' });
            }
        } catch (e) {
            console.log('Unmount check/attempt:', e.message);
        }
        
        // Step 2: Create partition if needed (for new disks or format requested)
        if (!hasPartition || format) {
            try {
                console.log(`Creating partition on ${devicePath}...`);
                execSync(`sudo parted -s ${escapeShellArg(devicePath)} mklabel gpt`, { encoding: 'utf8', timeout: 30000 });
                execSync(`sudo parted -s ${escapeShellArg(devicePath)} mkpart primary ext4 0% 100%`, { encoding: 'utf8', timeout: 30000 });
                execSync('sync', { encoding: 'utf8' });
                execSync(`sudo partprobe ${escapeShellArg(devicePath)}`, { encoding: 'utf8', timeout: 10000 });
                // Wait for partition to appear
                execSync('sleep 2', { encoding: 'utf8' });
                hasPartition = true;
            } catch (e) {
                if (!hasPartition) {
                    return res.status(500).json({ 
                        error: 'Failed to create partition',
                        details: e.message
                    });
                }
                // Partition might already exist, continue
                console.log('Partition creation skipped (may already exist):', e.message);
            }
        }
        
        // Step 3: Format if requested
        if (format) {
            const label = `${role}_${safeDiskId}`.substring(0, 16);
            try {
                console.log(`Formatting ${partitionPath} as ext4...`);
                execSync(`sudo mkfs.ext4 -F -L ${escapeShellArg(label)} ${escapeShellArg(partitionPath)}`, { encoding: 'utf8', timeout: 300000 });
            } catch (e) {
                return res.status(500).json({ 
                    error: 'Format failed',
                    details: e.message
                });
            }
        }

        // Step 4: Verify partition is mountable (test mount)
        const testMountPoint = `/tmp/homepinas-test-mount-${Date.now()}`;
        try {
            execSync(`sudo mkdir -p ${testMountPoint}`, { encoding: 'utf8' });
            execSync(`sudo mount ${escapeShellArg(partitionPath)} ${testMountPoint}`, { encoding: 'utf8', timeout: 30000 });
            execSync(`sudo umount ${testMountPoint}`, { encoding: 'utf8' });
            execSync(`sudo rmdir ${testMountPoint}`, { encoding: 'utf8' });
        } catch (e) {
            try { execSync(`sudo umount ${testMountPoint} 2>/dev/null || true`, { encoding: 'utf8' }); } catch {}
            try { execSync(`sudo rmdir ${testMountPoint} 2>/dev/null || true`, { encoding: 'utf8' }); } catch {}
            return res.status(500).json({
                error: 'Disk not mountable',
                details: `Failed to mount ${partitionPath}. Is it formatted? Error: ${e.message}`
            });
        }

        // ══════════════════════════════════════════════════════════════════
        // INTEGRATION PHASE
        // ══════════════════════════════════════════════════════════════════

        // Step 5: Get UUID
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
        const storageData = getData();
        if (!storageData.storageConfig) storageData.storageConfig = [];
        storageData.storageConfig.push({
            id: safeDiskId,
            role: role,
            uuid: uuid,
            mountPoint: mountPoint,
            addedAt: new Date().toISOString()
        });
        saveData(storageData);

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
 * Remove disk from pool
 * POST /disks/remove-from-pool
 * Body: { diskId: 'sdb' }
 */
router.post('/disks/remove-from-pool', requireAuth, async (req, res) => {
    try {
        const { diskId } = req.body;
        
        const safeDiskId = sanitizeDiskId(diskId);
        if (!safeDiskId) {
            return res.status(400).json({ error: 'Invalid disk ID' });
        }

        // Find disk in storage config
        const data = getData();
        if (!data.storageConfig) data.storageConfig = [];
        
        const diskConfig = data.storageConfig.find(d => d.id === safeDiskId);
        if (!diskConfig) {
            return res.status(400).json({ error: 'Disk not found in pool configuration' });
        }

        const mountPoint = diskConfig.mountPoint;
        if (!mountPoint) {
            return res.status(400).json({ error: 'Disk mount point not found' });
        }

        // Get current MergerFS sources
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
            // MergerFS not mounted
        }

        // Remove this mount point from sources
        const sourcesList = currentSources.split(':').filter(s => s && s !== mountPoint);
        
        if (sourcesList.length === 0) {
            return res.status(400).json({ error: 'Cannot remove last disk from pool. At least one disk must remain.' });
        }

        const newSources = sourcesList.join(':');

        // Unmount MergerFS
        if (isMounted) {
            try {
                execSync(`sudo umount ${POOL_MOUNT}`, { encoding: 'utf8' });
            } catch (e) {
                try {
                    execSync(`sudo umount -l ${POOL_MOUNT}`, { encoding: 'utf8' });
                } catch (e2) {
                    return res.status(500).json({ error: 'Cannot unmount pool. Files may be in use.' });
                }
            }
        }

        // Remount with remaining disks
        try {
            execSync(
                `sudo mergerfs -o defaults,allow_other,nonempty,use_ino,cache.files=partial,dropcacheonclose=true,category.create=mfs,moveonenospc=true ${escapeShellArg(newSources)} ${POOL_MOUNT}`,
                { encoding: 'utf8' }
            );
        } catch (e) {
            return res.status(500).json({ error: `Failed to remount pool: ${e.message}` });
        }

        // Update fstab
        updateMergerFSFstab(newSources, 'mfs');

        // Remove from storage config
        data.storageConfig = data.storageConfig.filter(d => d.id !== safeDiskId);
        saveData(data);

        logSecurityEvent('DISK_REMOVED_FROM_POOL', { diskId: safeDiskId, mountPoint }, req.ip);

        res.json({ 
            success: true, 
            message: `Disk ${safeDiskId} removed from pool`,
            remainingDisks: sourcesList.length
        });
    } catch (e) {
        console.error('Remove from pool error:', e);
        res.status(500).json({ error: `Failed to remove disk: ${e.message}` });
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
        
        // Mount MergerFS (nofail is only for fstab, not mount command)
        execSync(
            `sudo mergerfs -o defaults,allow_other,nonempty,use_ino,cache.files=partial,dropcacheonclose=true,category.create=${policy},moveonenospc=true ${escapeShellArg(newSources)} ${POOL_MOUNT}`,
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

// Update MergerFS persistence (uses systemd mount unit instead of fstab)
function updateMergerFSFstab(sources, policy = 'mfs') {
    try {
        // Now using systemd mount unit for better boot ordering
        updateMergerFSSystemdUnit(sources, policy);
        console.log('Updated MergerFS systemd mount unit');
    } catch (e) {
        console.error('Failed to update MergerFS systemd unit:', e);
        // Don't throw - the mount worked, persistence is just for reboot
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

// ════════════════════════════════════════════════════════════════════════════
// SYSTEMD MOUNT UNIT FOR MERGERFS
// Ensures MergerFS mounts AFTER all underlying disks are ready at boot
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create systemd mount unit for MergerFS pool
 * This ensures proper boot order: disks mount first, then MergerFS
 * 
 * @param {string} sources - Colon-separated list of mount points (e.g., "/mnt/disks/disk1:/mnt/disks/disk2")
 * @param {string} options - MergerFS mount options
 * @param {string[]} diskMountPoints - Array of disk mount points to wait for
 */
function createMergerFSSystemdUnit(sources, options, diskMountPoints) {
    const { execFileSync } = require('child_process');
    
    // Generate systemd mount unit name from path: /mnt/storage -> mnt-storage.mount
    const mountUnitName = 'mnt-storage.mount';
    const mountUnitPath = `/etc/systemd/system/${mountUnitName}`;
    
    // Generate RequiresMountsFor directive for all disk mount points
    const requiresMountsFor = diskMountPoints.join(' ');
    
    // Generate After directive from disk mount points
    // Convert /mnt/disks/disk1 -> mnt-disks-disk1.mount
    const afterMounts = diskMountPoints
        .map(mp => mp.replace(/^\//, '').replace(/\//g, '-') + '.mount')
        .join(' ');
    
    const mountUnit = `# HomePiNAS MergerFS Pool Mount Unit
# Auto-generated - do not edit manually
# Ensures MergerFS mounts after all underlying disks are ready

[Unit]
Description=HomePiNAS MergerFS Storage Pool
Documentation=https://github.com/trapexit/mergerfs
After=local-fs.target ${afterMounts}
Requires=local-fs.target
RequiresMountsFor=${requiresMountsFor}
# Don't fail boot if mount fails
DefaultDependencies=no

[Mount]
What=${sources}
Where=${POOL_MOUNT}
Type=fuse.mergerfs
Options=${options}
TimeoutSec=30

[Install]
WantedBy=multi-user.target
`;

    // Write unit file via temp file + sudo
    const tempFile = `/tmp/homepinas-mergerfs-mount-${Date.now()}`;
    fs.writeFileSync(tempFile, mountUnit, 'utf8');
    
    try {
        // Copy unit file to systemd directory
        execFileSync('sudo', ['cp', tempFile, mountUnitPath], { encoding: 'utf8', timeout: 10000 });
        execFileSync('sudo', ['chmod', '644', mountUnitPath], { encoding: 'utf8', timeout: 5000 });
        
        // Reload systemd and enable the mount
        execFileSync('sudo', ['systemctl', 'daemon-reload'], { encoding: 'utf8', timeout: 10000 });
        execFileSync('sudo', ['systemctl', 'enable', mountUnitName], { encoding: 'utf8', timeout: 10000 });
        
        console.log('Created systemd mount unit:', mountUnitPath);
        
        // Also remove any MergerFS entry from fstab to avoid conflicts
        try {
            execSync(`sudo sed -i '/\\/mnt\\/storage.*mergerfs/d' /etc/fstab`, { encoding: 'utf8', timeout: 10000 });
            console.log('Removed MergerFS fstab entry (now using systemd)');
        } catch (e) {
            // Ignore - fstab entry might not exist
        }
    } finally {
        // Clean up temp file
        try { fs.unlinkSync(tempFile); } catch (e) {}
    }
}

/**
 * Update systemd mount unit when disks change
 * Called when adding/removing disks from pool
 */
function updateMergerFSSystemdUnit(sources, policy = 'mfs') {
    const hasCache = sources.includes('cache');
    const policyToUse = hasCache ? 'lfs' : policy;
    const options = `defaults,allow_other,nonempty,use_ino,cache.files=partial,dropcacheonclose=true,category.create=${policyToUse},moveonenospc=true`;
    
    // Extract mount points from sources
    const mountPoints = sources.split(':').filter(s => s);
    
    createMergerFSSystemdUnit(sources, options, mountPoints);
}

module.exports = router;
