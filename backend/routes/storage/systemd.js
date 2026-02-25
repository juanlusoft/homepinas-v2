/**
 * HomePiNAS - Systemd Mount Unit Management
 * Creates and manages systemd mount units for MergerFS pool
 * Ensures proper boot order: disks mount first, then MergerFS
 */

const fs = require('fs');
const { execFileSync } = require('child_process');

const POOL_MOUNT = '/mnt/storage';

/**
 * Create systemd mount unit for MergerFS pool
 * This ensures proper boot order: disks mount first, then MergerFS
 * 
 * @param {string} sources - Colon-separated list of mount points (e.g., "/mnt/disks/disk1:/mnt/disks/disk2")
 * @param {string} options - MergerFS mount options
 * @param {string[]} diskMountPoints - Array of disk mount points to wait for
 */
function createMergerFSSystemdUnit(sources, options, diskMountPoints) {
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
    const tempFile = `/mnt/storage/.tmp/homepinas-mergerfs-mount-${Date.now()}`;
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
            const fstabRaw = execFileSync('sudo', ['cat', '/etc/fstab'], { encoding: 'utf8', timeout: 10000 });
            const fstabFiltered = fstabRaw.split('\n').filter(line => !/\/mnt\/storage.*mergerfs/.test(line)).join('\n');
            const tempFstabClean = `/tmp/homepinas-fstab-clean-${Date.now()}`;
            fs.writeFileSync(tempFstabClean, fstabFiltered, 'utf8');
            execFileSync('sudo', ['cp', tempFstabClean, '/etc/fstab'], { encoding: 'utf8', timeout: 10000 });
            try { fs.unlinkSync(tempFstabClean); } catch (e2) {}
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
 * 
 * @param {string} sources - MergerFS source paths
 * @param {string} policy - MergerFS create policy (mfs/lfs)
 */
function updateMergerFSSystemdUnit(sources, policy = 'mfs') {
    const hasCache = sources.includes('cache');
    const policyToUse = hasCache ? 'lfs' : policy;
    const options = `defaults,allow_other,nonempty,use_ino,cache.files=partial,dropcacheonclose=true,category.create=${policyToUse},moveonenospc=true`;
    
    // Extract mount points from sources
    const mountPoints = sources.split(':').filter(s => s);
    
    createMergerFSSystemdUnit(sources, options, mountPoints);
}

module.exports = {
    createMergerFSSystemdUnit,
    updateMergerFSSystemdUnit
};
