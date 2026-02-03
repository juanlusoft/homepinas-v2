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
function logSecurityEvent(event, details, ip) {
    const timestamp = new Date().toISOString();
    console.log(`[SECURITY] ${timestamp} | ${event} | IP: ${ip} | ${JSON.stringify(details)}`);
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
