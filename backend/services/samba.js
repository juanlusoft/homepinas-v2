/**
 * HomePiNAS v2 - Samba Service Layer
 * Business logic for Samba share management, configuration parsing, and operations
 */

const fs = require('fs').promises;
const path = require('path');
const { sudoExec } = require('../utils/security');
const { sanitizePathWithinBase } = require('../utils/sanitize');

const SMB_CONF_PATH = '/etc/samba/smb.conf';
const STORAGE_BASE = '/mnt/storage';

/**
 * Check if a path exists
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>}
 */
async function pathExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Parse smb.conf and extract share definitions
 * @returns {Promise<Array>} Array of share objects
 */
async function parseSmbConf() {
    const content = await fs.readFile(SMB_CONF_PATH, 'utf8');
    const lines = content.split('\n');

    const systemSections = ['global', 'printers', 'print$', 'homes'];
    const shares = [];
    let currentSection = null;
    let currentParams = {};

    for (const rawLine of lines) {
        const line = rawLine.trim();

        // Skip comments and empty lines
        if (line === '' || line.startsWith('#') || line.startsWith(';')) {
            continue;
        }

        // Section header: [sharename]
        const sectionMatch = line.match(/^\[(.+)\]$/);
        if (sectionMatch) {
            // Save previous section if it's a share
            if (currentSection && !systemSections.includes(currentSection.toLowerCase())) {
                shares.push({
                    name: currentSection,
                    ...currentParams,
                });
            }
            currentSection = sectionMatch[1];
            currentParams = {};
            continue;
        }

        // Key = value pair
        if (currentSection) {
            const kvMatch = line.match(/^([^=]+?)\s*=\s*(.*)$/);
            if (kvMatch) {
                const key = kvMatch[1].trim().toLowerCase().replace(/\s+/g, '_');
                const value = kvMatch[2].trim();
                currentParams[key] = value;
            }
        }
    }

    // Don't forget the last section
    if (currentSection && !systemSections.includes(currentSection.toLowerCase())) {
        shares.push({
            name: currentSection,
            ...currentParams,
        });
    }

    return shares;
}

/**
 * Build an smb.conf section string for a share
 * @param {Object} share - Share configuration object
 * @returns {string} smb.conf section text
 */
function buildShareSection(share) {
    const lines = [`[${share.name}]`];

    if (share.comment) lines.push(`   comment = ${share.comment}`);
    if (share.path) lines.push(`   path = ${share.path}`);

    // Boolean options
    if (share.readOnly !== undefined) {
        lines.push(`   read only = ${share.readOnly ? 'yes' : 'no'}`);
    }
    if (share.guestOk !== undefined) {
        lines.push(`   guest ok = ${share.guestOk ? 'yes' : 'no'}`);
    }
    if (share.browseable !== undefined) {
        lines.push(`   browseable = ${share.browseable ? 'yes' : 'no'}`);
    } else {
        lines.push(`   browseable = yes`);
    }

    // Valid users list
    if (share.validUsers && Array.isArray(share.validUsers) && share.validUsers.length > 0) {
        lines.push(`   valid users = ${share.validUsers.join(', ')}`);
    }

    // File permissions defaults
    lines.push(`   create mask = 0664`);
    lines.push(`   directory mask = 0775`);

    return lines.join('\n');
}

/**
 * Read smb.conf content
 * @returns {Promise<string>}
 */
async function readSmbConf() {
    return await fs.readFile(SMB_CONF_PATH, 'utf8');
}

/**
 * Write new smb.conf content using temp file + sudo mv
 * @param {string} content - New smb.conf content
 */
async function writeSmbConf(content) {
    const tmpFile = path.join('/mnt/storage/.tmp', `smb.conf.${Date.now()}.tmp`);
    
    // Ensure tmp directory exists
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });
    
    await fs.writeFile(tmpFile, content, 'utf8');

    try {
        // Backup current config
        await sudoExec('cp', [SMB_CONF_PATH, `${SMB_CONF_PATH}.bak`]);
        // Move temp file to smb.conf location
        await sudoExec('mv', [tmpFile, SMB_CONF_PATH]);
        // Ensure correct ownership and permissions
        await sudoExec('chown', ['root:root', SMB_CONF_PATH]);
        await sudoExec('chmod', ['644', SMB_CONF_PATH]);
    } catch (err) {
        // Clean up temp file on failure
        try { await fs.unlink(tmpFile); } catch {}
        throw err;
    }
}

/**
 * Remove a share section from smb.conf content
 * @param {string} content - Current smb.conf content
 * @param {string} shareName - Share name to remove
 * @returns {string} Modified content
 */
function removeSectionFromConf(content, shareName) {
    const lines = content.split('\n');
    const result = [];
    let skipping = false;

    for (const line of lines) {
        const sectionMatch = line.trim().match(/^\[(.+)\]$/);

        if (sectionMatch) {
            if (sectionMatch[1] === shareName) {
                skipping = true;
                continue;
            } else {
                skipping = false;
            }
        }

        if (!skipping) {
            result.push(line);
        }
    }

    return result.join('\n');
}

/**
 * Replace or add a share section in smb.conf content
 * @param {string} content - Current smb.conf content
 * @param {string} shareName - Share name
 * @param {string} newSection - New section text
 * @returns {string} Modified content
 */
function upsertSectionInConf(content, shareName, newSection) {
    let modified = removeSectionFromConf(content, shareName);

    if (!modified.endsWith('\n')) {
        modified += '\n';
    }

    modified += '\n' + newSection + '\n';

    return modified;
}

/**
 * Restart Samba services
 */
async function restartSamba() {
    await sudoExec('systemctl', ['restart', 'smbd']);
    await sudoExec('systemctl', ['restart', 'nmbd']);
}

/**
 * Validate share name
 * @param {string} name - Share name
 * @returns {boolean}
 */
function validateShareName(name) {
    if (!name || typeof name !== 'string') return false;
    if (name.length < 1 || name.length > 64) return false;
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return false;
    
    const reserved = ['global', 'printers', 'print$', 'homes'];
    if (reserved.includes(name.toLowerCase())) return false;
    
    return true;
}

/**
 * Get all Samba shares
 * @returns {Promise<Array>} Array of normalized share objects
 */
async function getAllShares() {
    const shares = await parseSmbConf();

    return shares.map(share => ({
        name: share.name,
        path: share.path || '',
        comment: share.comment || '',
        readOnly: (share.read_only || 'no').toLowerCase() === 'yes',
        guestOk: (share.guest_ok || 'no').toLowerCase() === 'yes',
        browseable: (share.browseable || 'yes').toLowerCase() === 'yes',
        validUsers: share.valid_users
            ? share.valid_users.split(',').map(u => u.trim()).filter(Boolean)
            : [],
    }));
}

/**
 * Create a new Samba share
 * @param {Object} shareParams - Share configuration
 * @returns {Promise<Object>} Result with { success: boolean, share?: Object, error?: string }
 */
async function createShare(shareParams) {
    const { name, path: sharePath, comment, readOnly, guestOk, validUsers } = shareParams;

    try {
        // Validate share name
        if (!validateShareName(name)) {
            return { success: false, error: 'Invalid share name. Use alphanumeric, hyphens, and underscores only.' };
        }

        // Validate path
        if (!sharePath) {
            return { success: false, error: 'Share path is required' };
        }

        const sanitizedPath = sanitizePathWithinBase(sharePath, STORAGE_BASE);
        if (sanitizedPath === null) {
            return { success: false, error: 'Share path must be within /mnt/storage' };
        }

        // Check if share already exists
        const existingShares = await parseSmbConf();
        if (existingShares.some(s => s.name.toLowerCase() === name.toLowerCase())) {
            return { success: false, error: 'A share with this name already exists' };
        }

        // Ensure directory exists
        if (!(await pathExists(sanitizedPath))) {
            await fs.mkdir(sanitizedPath, { recursive: true });
        }

        // Build share config
        const shareConfig = {
            name,
            path: sanitizedPath,
            comment: comment || '',
            readOnly: readOnly === true,
            guestOk: guestOk === true,
            validUsers: Array.isArray(validUsers) ? validUsers : [],
        };

        const section = buildShareSection(shareConfig);

        // Update smb.conf
        const currentConf = await readSmbConf();
        const newConf = upsertSectionInConf(currentConf, name, section);
        await writeSmbConf(newConf);

        // Restart Samba
        await restartSamba();

        return { success: true, share: shareConfig };
    } catch (error) {
        console.error('Create share error:', error);
        return { success: false, error: 'Failed to create share' };
    }
}

/**
 * Update an existing Samba share
 * @param {string} shareName - Share name
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Result
 */
async function updateShare(shareName, updates) {
    const { path: sharePath, comment, readOnly, guestOk, validUsers } = updates;

    try {
        // Check share exists
        const existingShares = await parseSmbConf();
        const existing = existingShares.find(s => s.name === shareName);
        if (!existing) {
            return { success: false, error: 'Share not found' };
        }

        // Validate path if provided
        let resolvedPath = existing.path;
        if (sharePath !== undefined) {
            const sanitizedPath = sanitizePathWithinBase(sharePath, STORAGE_BASE);
            if (sanitizedPath === null) {
                return { success: false, error: 'Share path must be within /mnt/storage' };
            }
            resolvedPath = sanitizedPath;

            if (!(await pathExists(resolvedPath))) {
                await fs.mkdir(resolvedPath, { recursive: true });
            }
        }

        // Build updated config
        const shareConfig = {
            name: shareName,
            path: resolvedPath,
            comment: comment !== undefined ? comment : (existing.comment || ''),
            readOnly: readOnly !== undefined ? readOnly === true :
                (existing.read_only || 'no').toLowerCase() === 'yes',
            guestOk: guestOk !== undefined ? guestOk === true :
                (existing.guest_ok || 'no').toLowerCase() === 'yes',
            validUsers: validUsers !== undefined
                ? (Array.isArray(validUsers) ? validUsers : [])
                : (existing.valid_users
                    ? existing.valid_users.split(',').map(u => u.trim()).filter(Boolean)
                    : []),
        };

        const section = buildShareSection(shareConfig);

        // Update smb.conf
        const currentConf = await readSmbConf();
        const newConf = upsertSectionInConf(currentConf, shareName, section);
        await writeSmbConf(newConf);

        // Restart Samba
        await restartSamba();

        return { success: true, share: shareConfig };
    } catch (error) {
        console.error('Update share error:', error);
        return { success: false, error: 'Failed to update share' };
    }
}

/**
 * Delete a Samba share
 * @param {string} shareName - Share name
 * @returns {Promise<Object>} Result
 */
async function deleteShare(shareName) {
    try {
        // Verify share exists
        const existingShares = await parseSmbConf();
        const existing = existingShares.find(s => s.name === shareName);
        if (!existing) {
            return { success: false, error: 'Share not found' };
        }

        // Remove from smb.conf
        const currentConf = await readSmbConf();
        const newConf = removeSectionFromConf(currentConf, shareName);
        await writeSmbConf(newConf);

        // Restart Samba
        await restartSamba();

        return { success: true, path: existing.path };
    } catch (error) {
        console.error('Delete share error:', error);
        return { success: false, error: 'Failed to delete share' };
    }
}

/**
 * Get Samba service status
 * @returns {Promise<Object>} Status object
 */
async function getSambaStatus() {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);

    try {
        // Check smbd status
        let serviceStatus = 'unknown';
        try {
            const { stdout } = await execFileAsync('systemctl', ['is-active', 'smbd']);
            serviceStatus = stdout.trim();
        } catch (err) {
            serviceStatus = err.stdout ? err.stdout.trim() : 'inactive';
        }

        // Get connected users
        let connectedUsers = [];
        try {
            const { stdout } = await execFileAsync('sudo', ['smbstatus', '-b', '--json']);
            const statusData = JSON.parse(stdout);
            if (statusData.sessions) {
                connectedUsers = Object.values(statusData.sessions).map(session => ({
                    username: session.username,
                    group: session.groupname,
                    machine: session.remote_machine,
                    protocol: session.protocol_ver,
                }));
            }
        } catch {
            // Fallback: parse text output
            try {
                const { stdout } = await execFileAsync('sudo', ['smbstatus', '-b']);
                const lines = stdout.split('\n').filter(l => l.trim() && !l.startsWith('-'));
                let headerPassed = false;
                
                for (const line of lines) {
                    if (line.includes('PID') && line.includes('Username')) {
                        headerPassed = true;
                        continue;
                    }
                    if (!headerPassed) continue;
                    if (line.trim() === '') continue;

                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 4) {
                        connectedUsers.push({
                            pid: parts[0],
                            username: parts[1],
                            group: parts[2],
                            machine: parts[3],
                            protocol: parts[4] || 'unknown',
                        });
                    }
                }
            } catch (innerErr) {
                console.warn('Could not get smbstatus:', innerErr.message);
            }
        }

        return {
            service: serviceStatus,
            running: serviceStatus === 'active',
            connectedUsers,
            connectedCount: connectedUsers.length,
        };
    } catch (error) {
        console.error('Samba status error:', error);
        throw error;
    }
}

module.exports = {
    parseSmbConf,
    buildShareSection,
    validateShareName,
    getAllShares,
    createShare,
    updateShare,
    deleteShare,
    getSambaStatus,
    restartSamba
};
