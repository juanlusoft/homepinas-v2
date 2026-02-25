/**
 * HomePiNAS - Storage Helpers
 * Shared utilities for storage management
 */

const fs = require('fs');
const { execFileSync } = require('child_process');
const { getData } = require('../../utils/data');

const STORAGE_MOUNT_BASE = '/mnt/disks';
const POOL_MOUNT = '/mnt/storage';

/**
 * Format size: GB → TB when appropriate
 * @param {number} gb - Size in GB
 * @returns {string} Formatted size string
 */
function formatSize(gb) {
    const num = parseFloat(gb) || 0;
    if (num >= 1024) {
        return (num / 1024).toFixed(1) + ' TB';
    }
    return Math.round(num) + ' GB';
}

/**
 * Middleware: allow during initial setup (no storage configured yet) OR with valid auth.
 * Like Synology DSM: the setup wizard doesn't require login since you just created the account.
 */
function requireAuthOrSetup(req, res, next) {
    const { requireAuth } = require('../../middleware/auth');
    const data = getData();
    // If no storage is configured yet, allow without auth (initial setup wizard)
    if (!data.storageConfig || data.storageConfig.length === 0) {
        return next();
    }
    // Otherwise require normal auth
    return requireAuth(req, res, next);
}

/**
 * Get next disk index for mount point
 * @returns {Promise<number>} Next available disk index
 */
async function getNextDiskIndex() {
    try {
        const existing = fs.readdirSync(STORAGE_MOUNT_BASE);
        const disks = existing.filter(d => d.startsWith('disk'));
        const indices = disks.map(d => parseInt(d.replace('disk', '')) || 0);
        return Math.max(0, ...indices) + 1;
    } catch (e) {
        return 1;
    }
}

/**
 * Add disk to MergerFS pool (hot add)
 * @param {string} mountPoint - Mount point of disk to add
 * @param {string} role - Disk role (data, cache, parity)
 */
async function addDiskToMergerFS(mountPoint, role) {
    try {
        // Check if MergerFS is currently mounted
        let currentSources = '';
        let isMounted = false;
        
        try {
            const mountsAllRaw = execFileSync('mount', [], { encoding: 'utf8' });
            const mounts = mountsAllRaw.split('\n').filter(l => l.includes('mergerfs')).join('\n').trim();
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
                        execFileSync('mountpoint', ['-q', p], { stdio: ['pipe', 'pipe', 'ignore'] });
                        return true;
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
                execFileSync('sudo', ['umount', POOL_MOUNT], { encoding: 'utf8' });
            } catch (e) {
                console.error('Failed to unmount MergerFS:', e.message);
                // Try lazy unmount
                try {
                    execFileSync('sudo', ['umount', '-l', POOL_MOUNT], { encoding: 'utf8' });
                } catch (e2) {
                    throw new Error('Cannot unmount MergerFS pool. Files may be in use.');
                }
            }
        }

        // Create pool mount point if needed
        if (!fs.existsSync(POOL_MOUNT)) {
            execFileSync('sudo', ['mkdir', '-p', POOL_MOUNT], { encoding: 'utf8' });
        }

        // Determine policy
        const hasCache = newSources.includes('cache') || role === 'cache';
        const policy = hasCache ? 'lfs' : 'mfs';

        // Mount MergerFS (nofail is only for fstab, not mount command)
        execFileSync('sudo', ['mergerfs', '-o', `defaults,allow_other,nonempty,use_ino,cache.files=partial,dropcacheonclose=true,category.create=${policy},moveonenospc=true`, newSources, POOL_MOUNT], { encoding: 'utf8' });

        // Update fstab for MergerFS
        updateMergerFSFstab(newSources, policy);

        return true;
    } catch (e) {
        console.error('MergerFS add disk failed:', e);
        throw e;
    }
}

/**
 * Update MergerFS persistence (uses systemd mount unit instead of fstab)
 * @param {string} sources - MergerFS source paths
 * @param {string} policy - MergerFS create policy (mfs/lfs)
 */
function updateMergerFSFstab(sources, policy = 'mfs') {
    const { updateMergerFSSystemdUnit } = require('./systemd');
    try {
        // Now using systemd mount unit for better boot ordering
        updateMergerFSSystemdUnit(sources, policy);
        console.log('Updated MergerFS systemd mount unit');
    } catch (e) {
        console.error('Failed to update MergerFS systemd unit:', e);
        // Don't throw - the mount worked, persistence is just for reboot
    }
}

module.exports = {
    STORAGE_MOUNT_BASE,
    POOL_MOUNT,
    formatSize,
    requireAuthOrSetup,
    getNextDiskIndex,
    addDiskToMergerFS,
    updateMergerFSFstab
};
