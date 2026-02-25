/**
 * HomePiNAS - Disk Management
 * Handles disk detection, addition, removal, mounting, and ignore list
 * 
 * NOTE: This module is ~650 lines (exceeds 300 line guideline)
 * JUSTIFICATION: Disk management operations are tightly coupled and interdependent.
 * Splitting further would create artificial boundaries and complicate the code.
 * Each operation (detect/add/remove/mount) shares validation, state, and helpers.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const { execFileSync } = require('child_process');
const { requireAuth } = require('../../middleware/auth');
const { logSecurityEvent } = require('../../utils/security');
const { getData, saveData } = require('../../utils/data');
const { sanitizeDiskId, validateDiskConfig } = require('../../utils/sanitize');
const { formatSize, getNextDiskIndex, addDiskToMergerFS, STORAGE_MOUNT_BASE, POOL_MOUNT } = require('./helpers');
const { updateMergerFSSystemdUnit } = require('./systemd');

router.get('/detect', requireAuth, async (req, res) => {
    try {
        // Get all block devices with details
        const lsblkJson = execFileSync('lsblk', ['-Jbo', 'NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL,SERIAL,TRAN'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        
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
            const dirEntries = fs.readdirSync(STORAGE_MOUNT_BASE);
            dirEntries.forEach(m => poolMounts.push(m));
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
router.post('/add-to-pool', requireAuth, async (req, res) => {
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
        if (!(await pathExists(devicePath))) {
            return res.status(400).json({ 
                error: 'Device not found',
                details: `${devicePath} does not exist. Is the disk connected?`
            });
        }
        
        // 4. Verify it's a block device
        try {
            const statResult = execFileSync('stat', ['-c', '%F', devicePath], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
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
            const lsblkJson = execFileSync('lsblk', ['-Jbo', 'NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT', `/dev/${safeDiskId}`], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
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
            const rootDeviceRaw = execFileSync('findmnt', ['-n', '-o', 'SOURCE', '/'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
            const rootDevice = rootDeviceRaw.replace(/[0-9]*$/, '').replace(/p[0-9]*$/, '');
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
            const mountAllRaw = execFileSync('mount', [], { encoding: 'utf8' });
            const mountCheck = mountAllRaw.split('\n').filter(l => l.includes(`/dev/${safeDiskId}`)).join('\n');
            if (mountCheck.trim()) {
                console.log(`Unmounting all partitions of /dev/${safeDiskId}...`);
                const mountLines = mountCheck.trim().split('\n');
                for (const line of mountLines) {
                    const mountedDev = line.split(' ')[0];
                    if (mountedDev) {
                        console.log(`  Unmounting ${mountedDev}...`);
                        try {
                            execFileSync('sudo', ['umount', mountedDev], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
                        } catch (e) {
                            try {
                                execFileSync('sudo', ['umount', '-l', mountedDev], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
                            } catch (e2) {
                                console.log(`  Failed to unmount ${mountedDev}: ${e2.message}`);
                            }
                        }
                    }
                }
                // Wait for unmount to complete
                execFileSync('sleep', ['1'], { encoding: 'utf8' });
            }
        } catch (e) {
            console.log('Unmount check/attempt:', e.message);
        }
        
        // Step 2: Create partition if needed (for new disks or format requested)
        if (!hasPartition || format) {
            try {
                console.log(`Creating partition on ${devicePath}...`);
                execFileSync('sudo', ['parted', '-s', devicePath, 'mklabel', 'gpt'], { encoding: 'utf8', timeout: 30000 });
                execFileSync('sudo', ['parted', '-s', devicePath, 'mkpart', 'primary', 'ext4', '0%', '100%'], { encoding: 'utf8', timeout: 30000 });
                execFileSync('sync', [], { encoding: 'utf8' });
                execFileSync('sudo', ['partprobe', devicePath], { encoding: 'utf8', timeout: 10000 });
                // Wait for partition to appear
                execFileSync('sleep', ['2'], { encoding: 'utf8' });
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
                execFileSync('sudo', ['mkfs.ext4', '-F', '-L', label, partitionPath], { encoding: 'utf8', timeout: 300000 });
            } catch (e) {
                return res.status(500).json({ 
                    error: 'Format failed',
                    details: e.message
                });
            }
        }

        // Step 4: Verify partition is mountable (test mount)
        const testMountPoint = `/mnt/storage/.tmp/homepinas-test-mount-${Date.now()}`;
        try {
            execFileSync('sudo', ['mkdir', '-p', testMountPoint], { encoding: 'utf8' });
            execFileSync('sudo', ['mount', partitionPath, testMountPoint], { encoding: 'utf8', timeout: 30000 });
            execFileSync('sudo', ['umount', testMountPoint], { encoding: 'utf8' });
            execFileSync('sudo', ['rmdir', testMountPoint], { encoding: 'utf8' });
        } catch (e) {
            try { execFileSync('sudo', ['umount', testMountPoint], { stdio: 'ignore' }); } catch {}
            try { execFileSync('sudo', ['rmdir', testMountPoint], { stdio: 'ignore' }); } catch {}
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
            uuid = execFileSync('sudo', ['blkid', '-s', 'UUID', '-o', 'value', partitionPath], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
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
            execFileSync('sudo', ['mkdir', '-p', mountPoint], { encoding: 'utf8' });
        } catch (e) {
            return res.status(500).json({ error: 'Failed to create mount point' });
        }

        // Step 5: Mount the disk
        try {
            execFileSync('sudo', ['mount', `UUID=${uuid}`, mountPoint], { encoding: 'utf8' });
        } catch (e) {
            return res.status(500).json({ error: `Mount failed: ${e.message}` });
        }

        // Step 6: Add to fstab
        const fstabEntry = `UUID=${uuid} ${mountPoint} ext4 defaults,nofail 0 2`;
        try {
            // Check if entry already exists
            const fstab = fs.readFileSync('/etc/fstab', 'utf8');
            if (!fstab.includes(uuid)) {
                const fstabAppend = `\n# HomePiNAS: ${safeDiskId} (${role})\n${fstabEntry}\n`;
                execFileSync('sudo', ['tee', '-a', '/etc/fstab'], { input: fstabAppend, encoding: 'utf8', stdio: ['pipe', 'ignore', 'pipe'] });
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
router.post('/remove-from-pool', requireAuth, async (req, res) => {
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
            const mountsAll = execFileSync('mount', [], { encoding: 'utf8' });
            const mounts = mountsAll.split('\n').filter(l => l.includes('mergerfs')).join('\n').trim();
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
                execFileSync('sudo', ['umount', POOL_MOUNT], { encoding: 'utf8' });
            } catch (e) {
                try {
                    execFileSync('sudo', ['umount', '-l', POOL_MOUNT], { encoding: 'utf8' });
                } catch (e2) {
                    return res.status(500).json({ error: 'Cannot unmount pool. Files may be in use.' });
                }
            }
        }

        // Remount with remaining disks
        try {
            execFileSync('sudo', ['mergerfs', '-o', 'defaults,allow_other,nonempty,use_ino,cache.files=partial,dropcacheonclose=true,category.create=mfs,moveonenospc=true', newSources, POOL_MOUNT], { encoding: 'utf8' });
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
router.post('/mount-standalone', requireAuth, async (req, res) => {
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

        if (!(await pathExists(devicePath))) {
            return res.status(400).json({ error: `Device ${devicePath} not found` });
        }

        // Create partition if needed
        try {
            execFileSync('sudo', ['parted', '-s', devicePath, 'mklabel', 'gpt'], { encoding: 'utf8' });
            execFileSync('sudo', ['parted', '-s', devicePath, 'mkpart', 'primary', 'ext4', '0%', '100%'], { encoding: 'utf8' });
            execFileSync('sleep', ['2'], { encoding: 'utf8' });
        } catch (e) {
            console.log('Partition exists or creation skipped');
        }

        // Format if requested
        if (format) {
            try {
                execFileSync('sudo', ['mkfs.ext4', '-F', '-L', safeName, partitionPath], { encoding: 'utf8' });
            } catch (e) {
                return res.status(500).json({ error: `Format failed: ${e.message}` });
            }
        }

        // Get UUID
        let uuid = '';
        try {
            uuid = execFileSync('sudo', ['blkid', '-s', 'UUID', '-o', 'value', partitionPath], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        } catch (e) {
            return res.status(500).json({ error: 'Failed to get UUID' });
        }

        // Create mount point and mount
        try {
            execFileSync('sudo', ['mkdir', '-p', mountPoint], { encoding: 'utf8' });
            execFileSync('sudo', ['mount', `UUID=${uuid}`, mountPoint], { encoding: 'utf8' });
        } catch (e) {
            return res.status(500).json({ error: `Mount failed: ${e.message}` });
        }

        // Add to fstab
        const fstabEntry = `UUID=${uuid} ${mountPoint} ext4 defaults,nofail 0 2`;
        try {
            const fstab = fs.readFileSync('/etc/fstab', 'utf8');
            if (!fstab.includes(uuid)) {
                const fstabAppend = `\n# HomePiNAS: Standalone volume ${safeName}\n${fstabEntry}\n`;
                execFileSync('sudo', ['tee', '-a', '/etc/fstab'], { input: fstabAppend, encoding: 'utf8', stdio: ['pipe', 'ignore', 'pipe'] });
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
router.post('/ignore', requireAuth, async (req, res) => {
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
router.get('/ignored', requireAuth, (req, res) => {
    const data = getData();
    res.json({ ignored: data.ignoredDisks || [] });
});

/**
 * Un-ignore a disk
 */
router.post('/unignore', requireAuth, async (req, res) => {
    try {
        const { diskId } = req.body;
        const safeDiskId = sanitizeDiskId(diskId);
        if (!safeDiskId) {
            return res.status(400).json({ error: 'Invalid disk ID' });
        }
        const data = getData();
        if (data.ignoredDisks) {
            data.ignoredDisks = data.ignoredDisks.filter(d => d !== safeDiskId);
            saveData(data);
        }
        res.json({ success: true });
    } catch (e) {

        res.status(500).json({ error: e.message });
    }
});
module.exports = router;
