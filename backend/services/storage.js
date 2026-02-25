/**
 * HomePiNAS v2 - Storage Service Layer
 * Business logic for disk management, pool configuration, and storage operations
 */

const fs = require('fs');
const { execFileSync } = require('child_process');
const { getData, saveData } = require('../utils/data');
const { sanitizeDiskId } = require('../utils/sanitize');
const { formatSize, getNextDiskIndex, STORAGE_MOUNT_BASE } = require('../routes/storage/helpers');

/**
 * Detect all available disks in the system
 * @returns {Promise<{configured: Array, unconfigured: Array}>}
 */
async function detectDisks() {
    try {
        const lsblkJson = execFileSync('lsblk', ['-Jbo', 'NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL,SERIAL,TRAN'], { 
            encoding: 'utf8', 
            stdio: ['pipe', 'pipe', 'ignore'] 
        });
        
        let devices = [];
        try {
            const parsed = JSON.parse(lsblkJson);
            devices = parsed.blockdevices || [];
        } catch (e) {
            console.error('Failed to parse lsblk:', e);
            return { configured: [], unconfigured: [] };
        }

        const data = getData();
        const configuredDisks = (data.storageConfig || []).map(d => d.id);
        
        const configured = [];
        const unconfigured = [];

        for (const dev of devices) {
            // Skip non-disk devices
            if (dev.type !== 'disk') continue;
            if (dev.name.startsWith('zram') || dev.name.startsWith('ram') || dev.name.startsWith('loop')) continue;
            if (dev.size < 1000000000) continue; // Skip < 1GB
            if (dev.name.startsWith('mmcblk')) continue; // Skip SD cards

            const diskInfo = {
                id: dev.name,
                path: `/dev/${dev.name}`,
                size: dev.size,
                sizeFormatted: formatSize(Math.round(dev.size / 1073741824)),
                model: dev.model || 'Unknown',
                serial: dev.serial || '',
                transport: dev.tran || 'unknown',
                partitions: []
            };

            // Process partitions
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

            const isConfigured = configuredDisks.includes(dev.name) || 
                                 diskInfo.partitions.some(p => p.mountpoint && p.mountpoint.startsWith(STORAGE_MOUNT_BASE));
            
            if (isConfigured) {
                const configEntry = (data.storageConfig || []).find(d => d.id === dev.name);
                diskInfo.role = configEntry ? configEntry.role : 'data';
                diskInfo.inPool = true;
                configured.push(diskInfo);
            } else {
                diskInfo.inPool = false;
                diskInfo.hasData = diskInfo.partitions.some(p => p.fstype);
                diskInfo.formatted = diskInfo.partitions.some(p => ['ext4', 'xfs', 'btrfs', 'ntfs'].includes(p.fstype));
                unconfigured.push(diskInfo);
            }
        }

        return { configured, unconfigured };
    } catch (error) {
        console.error('Disk detection error:', error);
        throw new Error('Failed to detect disks');
    }
}

/**
 * Validate disk addition parameters
 * @param {string} diskId - Disk identifier (e.g., 'sdb')
 * @param {string} role - Disk role ('data', 'cache', 'parity')
 * @returns {Object} Validation result with { valid: boolean, error?: string, safeDiskId?: string }
 */
function validateDiskAddition(diskId, role) {
    const safeDiskId = sanitizeDiskId(diskId);
    if (!safeDiskId) {
        return { valid: false, error: 'Invalid disk ID format' };
    }
    
    if (!['data', 'cache', 'parity'].includes(role)) {
        return { valid: false, error: 'Invalid role. Must be: data, cache, or parity' };
    }

    const devicePath = `/dev/${safeDiskId}`;
    if (!fs.existsSync(devicePath)) {
        return { valid: false, error: 'Device does not exist' };
    }

    return { valid: true, safeDiskId };
}

/**
 * Get storage pool configuration
 * @returns {Object} Storage configuration object
 */
function getStorageConfig() {
    const data = getData();
    return {
        config: data.storageConfig || [],
        poolMounted: data.poolMounted || false,
        lastSync: data.lastStorageSync || null
    };
}

/**
 * Update storage configuration
 * @param {Array} config - New storage configuration array
 * @returns {boolean} Success status
 */
function updateStorageConfig(config) {
    try {
        const data = getData();
        data.storageConfig = config;
        saveData(data);
        return true;
    } catch (error) {
        console.error('Failed to update storage config:', error);
        return false;
    }
}

/**
 * Get disk health status (SMART data if available)
 * @param {string} diskId - Disk identifier
 * @returns {Promise<Object>} Health status object
 */
async function getDiskHealth(diskId) {
    try {
        const safeDiskId = sanitizeDiskId(diskId);
        if (!safeDiskId) {
            throw new Error('Invalid disk ID');
        }

        // Placeholder for SMART data integration
        // TODO: Integrate with smartctl for real health data
        return {
            diskId: safeDiskId,
            status: 'healthy',
            temperature: null,
            powerOnHours: null,
            reallocatedSectors: null
        };
    } catch (error) {
        console.error('Failed to get disk health:', error);
        throw error;
    }
}

/**
 * Add disk to MergerFS pool
 * @param {string} diskId - Disk identifier
 * @param {Object} options - { format: boolean, role: string, force: boolean }
 * @returns {Promise<Object>} Result with { success: boolean, data?: Object, error?: string }
 */
async function addDiskToPool(diskId, options = {}) {
    const { format = false, role = 'data', force = false } = options;
    
    try {
        // Validate input
        const validation = validateDiskAddition(diskId, role);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        const safeDiskId = validation.safeDiskId;
        const devicePath = `/dev/${safeDiskId}`;
        
        // Check if already in pool
        const data = getData();
        const existingDisk = (data.storageConfig || []).find(d => d.id === safeDiskId);
        if (existingDisk) {
            return { success: false, error: `Disk already in pool as ${existingDisk.role}` };
        }

        // Check for existing data
        let hasPartition = false;
        let hasFilesystem = false;
        let partitionPath = '';
        
        try {
            const lsblkJson = execFileSync('lsblk', ['-Jbo', 'NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT', devicePath], { 
                encoding: 'utf8', 
                stdio: ['pipe', 'pipe', 'ignore'] 
            });
            const lsblk = JSON.parse(lsblkJson);
            const device = (lsblk.blockdevices || [])[0];
            
            if (device && device.children && device.children.length > 0) {
                hasPartition = true;
                const firstPart = device.children[0];
                partitionPath = `/dev/${firstPart.name}`;
                
                if (firstPart.fstype) {
                    hasFilesystem = true;
                }
            }
        } catch (e) {
            console.log('lsblk check failed:', e.message);
        }

        // Determine partition path
        if (!partitionPath) {
            partitionPath = safeDiskId.includes('nvme') ? `${devicePath}p1` : `${devicePath}1`;
        }

        // Warn if has data and not formatting
        if (hasFilesystem && !format && !force) {
            return { 
                success: false, 
                error: 'Disk has existing data. Set format=true to erase or force=true to use existing', 
                requiresConfirmation: true 
            };
        }

        // Unmount all partitions first
        try {
            const mountRaw = execFileSync('mount', [], { encoding: 'utf8' });
            const mountLines = mountRaw.split('\n').filter(l => l.includes(devicePath));
            for (const line of mountLines) {
                const mountedDev = line.split(' ')[0];
                if (mountedDev) {
                    try {
                        execFileSync('sudo', ['umount', mountedDev], { stdio: 'ignore' });
                    } catch (e) {
                        execFileSync('sudo', ['umount', '-l', mountedDev], { stdio: 'ignore' });
                    }
                }
            }
            execFileSync('sleep', ['1'], { encoding: 'utf8' });
        } catch (e) {}

        // Create partition if needed or formatting
        if (!hasPartition || format) {
            try {
                execFileSync('sudo', ['parted', '-s', devicePath, 'mklabel', 'gpt'], { 
                    encoding: 'utf8', 
                    timeout: 30000 
                });
                execFileSync('sudo', ['parted', '-s', devicePath, 'mkpart', 'primary', 'ext4', '0%', '100%'], { 
                    encoding: 'utf8', 
                    timeout: 30000 
                });
                execFileSync('sync', [], { encoding: 'utf8' });
                execFileSync('sudo', ['partprobe', devicePath], { encoding: 'utf8', timeout: 10000 });
                execFileSync('sleep', ['2'], { encoding: 'utf8' });
                hasPartition = true;
            } catch (e) {
                if (!hasPartition) {
                    return { success: false, error: `Failed to create partition: ${e.message}` };
                }
            }
        }

        // Format if requested
        if (format) {
            const label = `${role}_${safeDiskId}`.substring(0, 16);
            try {
                execFileSync('sudo', ['mkfs.ext4', '-F', '-L', label, partitionPath], { 
                    encoding: 'utf8', 
                    timeout: 300000 
                });
            } catch (e) {
                return { success: false, error: `Format failed: ${e.message}` };
            }
        }

        // Test mount
        const testMountPoint = `/mnt/storage/.tmp/homepinas-test-mount-${Date.now()}`;
        try {
            execFileSync('sudo', ['mkdir', '-p', testMountPoint], { encoding: 'utf8' });
            execFileSync('sudo', ['mount', partitionPath, testMountPoint], { encoding: 'utf8', timeout: 30000 });
            execFileSync('sudo', ['umount', testMountPoint], { encoding: 'utf8' });
            execFileSync('sudo', ['rmdir', testMountPoint], { encoding: 'utf8' });
        } catch (e) {
            try { execFileSync('sudo', ['umount', testMountPoint], { stdio: 'ignore' }); } catch {}
            try { execFileSync('sudo', ['rmdir', testMountPoint], { stdio: 'ignore' }); } catch {}
            return { success: false, error: `Disk not mountable: ${e.message}` };
        }

        // Get UUID
        let uuid = '';
        try {
            uuid = execFileSync('sudo', ['blkid', '-s', 'UUID', '-o', 'value', partitionPath], { 
                encoding: 'utf8', 
                stdio: ['pipe', 'pipe', 'ignore'] 
            }).trim();
        } catch (e) {
            return { success: false, error: 'Failed to get disk UUID' };
        }

        if (!uuid) {
            return { success: false, error: 'Could not determine disk UUID' };
        }

        // Create mount point
        const mountIndex = getNextDiskIndex();
        const mountPoint = `${STORAGE_MOUNT_BASE}/disk${mountIndex}`;
        
        try {
            execFileSync('sudo', ['mkdir', '-p', mountPoint], { encoding: 'utf8' });
        } catch (e) {
            return { success: false, error: 'Failed to create mount point' };
        }

        // Mount the disk
        try {
            execFileSync('sudo', ['mount', `UUID=${uuid}`, mountPoint], { encoding: 'utf8' });
        } catch (e) {
            return { success: false, error: `Mount failed: ${e.message}` };
        }

        // Add to fstab
        const fstabEntry = `UUID=${uuid} ${mountPoint} ext4 defaults,nofail 0 2`;
        try {
            const fstab = fs.readFileSync('/etc/fstab', 'utf8');
            if (!fstab.includes(uuid)) {
                const fstabAppend = `\n# HomePiNAS: ${safeDiskId} (${role})\n${fstabEntry}\n`;
                execFileSync('sudo', ['tee', '-a', '/etc/fstab'], { 
                    input: fstabAppend, 
                    encoding: 'utf8', 
                    stdio: ['pipe', 'ignore', 'pipe'] 
                });
            }
        } catch (e) {
            console.error('fstab update failed:', e);
        }

        // Add to MergerFS pool
        const { addDiskToMergerFS } = require('../routes/storage/helpers');
        try {
            await addDiskToMergerFS(mountPoint, role);
        } catch (e) {
            return { success: false, error: `Failed to add to pool: ${e.message}` };
        }

        // Update storage config
        if (!data.storageConfig) data.storageConfig = [];
        data.storageConfig.push({
            id: safeDiskId,
            role: role,
            uuid: uuid,
            mountPoint: mountPoint,
            addedAt: new Date().toISOString()
        });
        saveData(data);

        return { 
            success: true, 
            data: { 
                diskId: safeDiskId, 
                role, 
                mountPoint, 
                uuid 
            }
        };
    } catch (error) {
        console.error('Add to pool error:', error);
        return { success: false, error: `Failed to add disk: ${error.message}` };
    }
}

/**
 * Remove disk from pool
 * @param {string} diskId - Disk identifier
 * @returns {Promise<Object>} Result with { success: boolean, error?: string }
 */
async function removeDiskFromPool(diskId) {
    try {
        const safeDiskId = sanitizeDiskId(diskId);
        if (!safeDiskId) {
            return { success: false, error: 'Invalid disk ID' };
        }

        const data = getData();
        if (!data.storageConfig) data.storageConfig = [];
        
        const diskConfig = data.storageConfig.find(d => d.id === safeDiskId);
        if (!diskConfig) {
            return { success: false, error: 'Disk not found in pool configuration' };
        }

        const mountPoint = diskConfig.mountPoint;
        if (!mountPoint) {
            return { success: false, error: 'Disk mount point not found' };
        }

        // Get current MergerFS sources
        let currentSources = '';
        let isMounted = false;
        const POOL_MOUNT = '/mnt/storage';
        
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
        } catch (e) {}

        // Remove this mount point from sources
        const sourcesList = currentSources.split(':').filter(s => s && s !== mountPoint);

        if (sourcesList.length === 0) {
            return { success: false, error: 'Cannot remove last disk from pool' };
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
                    return { success: false, error: 'Cannot unmount pool. Files may be in use.' };
                }
            }
        }

        // Remount with remaining disks
        try {
            execFileSync('sudo', ['mergerfs', '-o', 
                'defaults,allow_other,nonempty,use_ino,cache.files=partial,dropcacheonclose=true,category.create=mfs,moveonenospc=true', 
                newSources, POOL_MOUNT
            ], { encoding: 'utf8' });
        } catch (e) {
            return { success: false, error: `Failed to remount pool: ${e.message}` };
        }

        // Update fstab (import helper from routes/storage/systemd if needed)
        // For now, skip fstab update (can be added later)

        // Remove from storage config
        data.storageConfig = data.storageConfig.filter(d => d.id !== safeDiskId);
        saveData(data);

        return { success: true, data: { diskId: safeDiskId, remainingDisks: sourcesList.length } };
    } catch (error) {
        console.error('Remove from pool error:', error);
        return { success: false, error: `Failed to remove disk: ${error.message}` };
    }
}

/**
 * Mount disk as standalone volume (not in pool)
 * @param {string} diskId - Disk identifier
 * @param {Object} options - { format: boolean, name: string }
 * @returns {Promise<Object>} Result
 */
async function mountStandalone(diskId, options = {}) {
    const { format = false, name = diskId } = options;
    
    try {
        const safeDiskId = sanitizeDiskId(diskId);
        if (!safeDiskId) {
            return { success: false, error: 'Invalid disk ID' };
        }

        // Sanitize volume name
        const safeName = (name || safeDiskId).replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32);
        if (!safeName) {
            return { success: false, error: 'Invalid volume name' };
        }

        const devicePath = `/dev/${safeDiskId}`;
        const partitionPath = `${devicePath}1`;
        const mountPoint = `/mnt/${safeName}`;

        if (!fs.existsSync(devicePath)) {
            return { success: false, error: `Device ${devicePath} not found` };
        }

        // Create partition if needed
        try {
            execFileSync('sudo', ['parted', '-s', devicePath, 'mklabel', 'gpt'], { encoding: 'utf8' });
            execFileSync('sudo', ['parted', '-s', devicePath, 'mkpart', 'primary', 'ext4', '0%', '100%'], { encoding: 'utf8' });
            execFileSync('sleep', ['2'], { encoding: 'utf8' });
        } catch (e) {}

        // Format if requested
        if (format) {
            try {
                execFileSync('sudo', ['mkfs.ext4', '-F', '-L', safeName, partitionPath], { encoding: 'utf8' });
            } catch (e) {
                return { success: false, error: `Format failed: ${e.message}` };
            }
        }

        // Get UUID
        let uuid = '';
        try {
            uuid = execFileSync('sudo', ['blkid', '-s', 'UUID', '-o', 'value', partitionPath], { 
                encoding: 'utf8', 
                stdio: ['pipe', 'pipe', 'ignore'] 
            }).trim();
        } catch (e) {
            return { success: false, error: 'Failed to get UUID' };
        }

        // Create mount point and mount
        try {
            execFileSync('sudo', ['mkdir', '-p', mountPoint], { encoding: 'utf8' });
            execFileSync('sudo', ['mount', `UUID=${uuid}`, mountPoint], { encoding: 'utf8' });
        } catch (e) {
            return { success: false, error: `Mount failed: ${e.message}` };
        }

        // Add to fstab
        const fstabEntry = `UUID=${uuid} ${mountPoint} ext4 defaults,nofail 0 2`;
        try {
            const fstab = fs.readFileSync('/etc/fstab', 'utf8');
            if (!fstab.includes(uuid)) {
                const fstabAppend = `\n# HomePiNAS: Standalone volume ${safeName}\n${fstabEntry}\n`;
                execFileSync('sudo', ['tee', '-a', '/etc/fstab'], { 
                    input: fstabAppend, 
                    encoding: 'utf8', 
                    stdio: ['pipe', 'ignore', 'pipe'] 
                });
            }
        } catch (e) {}

        // Save to config
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

        return { success: true, data: { name: safeName, mountPoint, uuid } };
    } catch (error) {
        console.error('Standalone mount error:', error);
        return { success: false, error: `Failed: ${error.message}` };
    }
}

/**
 * Ignore/dismiss a detected disk
 * @param {string} diskId - Disk identifier
 * @returns {Object} Result
 */
function ignoreDisk(diskId) {
    try {
        const safeDiskId = sanitizeDiskId(diskId);
        if (!safeDiskId) {
            return { success: false, error: 'Invalid disk ID' };
        }

        const data = getData();
        if (!data.ignoredDisks) data.ignoredDisks = [];
        if (!data.ignoredDisks.includes(safeDiskId)) {
            data.ignoredDisks.push(safeDiskId);
            saveData(data);
        }

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Un-ignore a disk
 * @param {string} diskId - Disk identifier
 * @returns {Object} Result
 */
function unignoreDisk(diskId) {
    try {
        const safeDiskId = sanitizeDiskId(diskId);
        if (!safeDiskId) {
            return { success: false, error: 'Invalid disk ID' };
        }

        const data = getData();
        if (data.ignoredDisks) {
            data.ignoredDisks = data.ignoredDisks.filter(d => d !== safeDiskId);
            saveData(data);
        }

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Get ignored disks list
 * @returns {Array} List of ignored disk IDs
 */
function getIgnoredDisks() {
    const data = getData();
    return data.ignoredDisks || [];
}

module.exports = {
    detectDisks,
    validateDiskAddition,
    getStorageConfig,
    updateStorageConfig,
    getDiskHealth,
    addDiskToPool,
    removeDiskFromPool,
    mountStandalone,
    ignoreDisk,
    unignoreDisk,
    getIgnoredDisks
};
