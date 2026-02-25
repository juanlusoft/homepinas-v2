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

module.exports = {
    detectDisks,
    validateDiskAddition,
    getStorageConfig,
    updateStorageConfig,
    getDiskHealth
};
