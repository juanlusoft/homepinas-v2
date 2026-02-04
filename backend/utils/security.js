/**
 * HomePiNAS - Security Utilities
 * v1.5.6 - Modular Architecture
 *
 * Security logging and safe command execution
 */

const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);

/**
 * Security event logging
 */
function logSecurityEvent(event, user, ipOrMeta) {
    const timestamp = new Date().toISOString();
    let ip = '-';
    let meta = null;
    if (typeof ipOrMeta === 'string') {
        ip = ipOrMeta;
    } else if (ipOrMeta && typeof ipOrMeta === 'object') {
        ip = ipOrMeta.ip || '-';
        meta = { ...ipOrMeta };
        delete meta.ip;
    }
    const metaStr = meta && Object.keys(meta).length > 0 ? ` | ${JSON.stringify(meta)}` : '';
    console.log(`[SECURITY] ${timestamp} | ${event} | IP: ${ip} | ${JSON.stringify(user)}${metaStr}`);
}

/**
 * Execute command with sanitized arguments using execFile (safer than exec)
 */
async function safeExec(command, args = [], options = {}) {
    // SECURITY: Removed 'rm' and 'bash' from allowlist (audit 2026-02-04)
    // Use safeRemove() for file deletion, Node fs for scripts
    const allowedCommands = [
        'sudo', 'cat', 'ls', 'df', 'mount', 'umount', 'smartctl',
        'systemctl', 'snapraid', 'mergerfs', 'smbpasswd', 'useradd',
        'usermod', 'chown', 'chmod', 'mkfs.ext4', 'mkfs.xfs', 'parted',
        'partprobe', 'id', 'getent', 'cp', 'tee', 'mkdir',
        'journalctl', 'smbstatus', 'smbd', 'nmbd', 'userdel',
        'apcaccess', 'apctest', 'upsc', 'upscmd', 'rsync', 'tar',
        'crontab', 'mv', 'grep', 'blkid', 'lsblk', 'findmnt', 'dd',
        'mkswap', 'swapon', 'swapoff', 'fdisk', 'xorriso', 'mksquashfs'
    ];

    const baseCommand = command.split('/').pop();
    if (!allowedCommands.includes(baseCommand)) {
        throw new Error(`Command not allowed: ${baseCommand}`);
    }

    return execFileAsync(command, args, {
        timeout: options.timeout || 30000,
        maxBuffer: 10 * 1024 * 1024,
        ...options
    });
}

/**
 * Safe file/directory removal with path traversal protection
 */
const fs = require('fs').promises;
const path = require('path');

async function safeRemove(targetPath, basePath) {
    if (!basePath) throw new Error('basePath is required for safe removal');
    
    const resolvedBase = path.resolve(basePath);
    const resolvedTarget = path.resolve(basePath, targetPath);
    
    // Prevent path traversal
    if (!resolvedTarget.startsWith(resolvedBase + path.sep) && resolvedTarget !== resolvedBase) {
        throw new Error('Path traversal attempt blocked');
    }
    
    // Prevent removing the base directory itself
    if (resolvedTarget === resolvedBase) {
        throw new Error('Cannot remove base directory');
    }
    
    return fs.rm(resolvedTarget, { recursive: true, force: true });
}

module.exports = {
    logSecurityEvent,
    safeExec,
    safeRemove
};
