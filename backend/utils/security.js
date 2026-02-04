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
    const allowedCommands = [
        'sudo', 'cat', 'ls', 'df', 'mount', 'umount', 'smartctl',
        'systemctl', 'snapraid', 'mergerfs', 'smbpasswd', 'useradd',
        'usermod', 'chown', 'chmod', 'mkfs.ext4', 'mkfs.xfs', 'parted',
        'partprobe', 'id', 'getent', 'cp', 'tee', 'mkdir',
        'journalctl', 'smbstatus', 'smbd', 'nmbd', 'userdel',
        'apcaccess', 'apctest', 'upsc', 'upscmd', 'rsync', 'tar',
        'crontab', 'mv', 'rm', 'grep', 'bash'
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

module.exports = {
    logSecurityEvent,
    safeExec
};
