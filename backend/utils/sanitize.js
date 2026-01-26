/**
 * HomePiNAS - Input Sanitization Utilities
 * v1.5.6 - Modular Architecture
 *
 * Security functions to sanitize user inputs before use in shell commands
 */

const path = require('path');

/**
 * Sanitize username for shell commands
 * Only allows alphanumeric, underscore, and hyphen
 */
function sanitizeUsername(username) {
    if (!username || typeof username !== 'string') return null;
    const sanitized = username.replace(/[^a-zA-Z0-9_-]/g, '');
    if (sanitized.length < 3 || sanitized.length > 32) return null;
    if (!/^[a-zA-Z]/.test(sanitized)) return null;
    return sanitized;
}

/**
 * Sanitize shell argument - escapes special characters
 */
function sanitizeShellArg(arg) {
    if (!arg || typeof arg !== 'string') return '';
    return arg.replace(/'/g, "'\\''");
}

/**
 * Sanitize path - prevent directory traversal
 */
function sanitizePath(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') return null;
    let sanitized = inputPath.replace(/\0/g, '');
    const normalized = path.normalize(sanitized);
    if (normalized.includes('..')) return null;
    if (!/^[a-zA-Z0-9/_.-]+$/.test(normalized)) return null;
    return normalized;
}

/**
 * Sanitize disk device path (e.g., /dev/sda)
 */
function sanitizeDiskPath(diskPath) {
    if (!diskPath || typeof diskPath !== 'string') return null;
    const validPatterns = [
        /^\/dev\/sd[a-z]$/,
        /^\/dev\/sd[a-z][0-9]+$/,
        /^\/dev\/nvme[0-9]+n[0-9]+$/,
        /^\/dev\/nvme[0-9]+n[0-9]+p[0-9]+$/,
        /^\/dev\/hd[a-z]$/,
        /^\/dev\/hd[a-z][0-9]+$/
    ];
    for (const pattern of validPatterns) {
        if (pattern.test(diskPath)) return diskPath;
    }
    return null;
}

/**
 * Input validation helpers
 */
function validateUsername(username) {
    if (!username || typeof username !== 'string') return false;
    if (username.length < 3 || username.length > 32) return false;
    return /^[a-zA-Z0-9_-]+$/.test(username);
}

function validatePassword(password) {
    if (!password || typeof password !== 'string') return false;
    if (password.length < 6 || password.length > 128) return false;
    return true;
}

function validateDockerAction(action) {
    return ['start', 'stop', 'restart'].includes(action);
}

function validateSystemAction(action) {
    return ['reboot', 'shutdown'].includes(action);
}

module.exports = {
    sanitizeUsername,
    sanitizeShellArg,
    sanitizePath,
    sanitizeDiskPath,
    validateUsername,
    validatePassword,
    validateDockerAction,
    validateSystemAction
};
