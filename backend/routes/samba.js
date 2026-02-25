/**
 * HomePiNAS v2 - Samba Share Management Routes
 * Manage Samba shared folders through the dashboard
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const { requireAuth } = require('../middleware/auth');
const { logSecurityEvent, safeExec, sudoExec } = require('../utils/security');
const { sanitizePathWithinBase } = require('../utils/sanitize');
const { getData } = require('../utils/data');

const SMB_CONF_PATH = '/etc/samba/smb.conf';
const STORAGE_BASE = '/mnt/storage';

// ─── smb.conf Parsing & Writing Helpers ─────────────────────────────────────

/**
 * Parse smb.conf and extract share definitions.
 * Returns an object: { global: {...}, shares: [ { name, ...params } ] }
 * Skips the [global], [printers], [print$] and [homes] sections.
 */
function parseSmbConf() {
  const content = fs.readFileSync(SMB_CONF_PATH, 'utf8');
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
 */
function buildShareSection(share) {
  const lines = [`[${share.name}]`];

  if (share.comment) lines.push(`   comment = ${share.comment}`);
  if (share.path) lines.push(`   path = ${share.path}`);

  // Boolean options: normalize to 'yes'/'no'
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

  // Create mask and directory mask defaults for usability
  lines.push(`   create mask = 0664`);
  lines.push(`   directory mask = 0775`);

  return lines.join('\n');
}

/**
 * Read the full smb.conf content
 */
function readSmbConf() {
  return fs.readFileSync(SMB_CONF_PATH, 'utf8');
}

/**
 * Write new content to smb.conf using a temp file + sudo mv approach
 * This avoids permission issues since smb.conf is owned by root
 */
async function writeSmbConf(content) {
  // Write to a temp file first
  const tmpFile = path.join('/mnt/storage/.tmp', `smb.conf.${Date.now()}.tmp`);
  fs.writeFileSync(tmpFile, content, 'utf8');

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
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Remove a share section from smb.conf content by name
 * Returns the modified content string
 */
function removeSectionFromConf(content, shareName) {
  const lines = content.split('\n');
  const result = [];
  let skipping = false;

  for (const line of lines) {
    const sectionMatch = line.trim().match(/^\[(.+)\]$/);

    if (sectionMatch) {
      if (sectionMatch[1] === shareName) {
        // Start skipping this section
        skipping = true;
        continue;
      } else {
        // New section starts, stop skipping
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
 */
function upsertSectionInConf(content, shareName, newSection) {
  // First remove the old section if it exists
  let modified = removeSectionFromConf(content, shareName);

  // Ensure there's a newline at the end before appending
  if (!modified.endsWith('\n')) {
    modified += '\n';
  }

  // Append the new section
  modified += '\n' + newSection + '\n';

  return modified;
}

/**
 * Restart Samba services (smbd and nmbd)
 */
async function restartSamba() {
  await sudoExec('systemctl', ['restart', 'smbd']);
  await sudoExec('systemctl', ['restart', 'nmbd']);
}

/**
 * Validate share name: alphanumeric, hyphens, underscores only
 */
function validateShareName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length < 1 || name.length > 64) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return false;
  // Prevent system section names
  const reserved = ['global', 'printers', 'print$', 'homes'];
  if (reserved.includes(name.toLowerCase())) return false;
  return true;
}

// All routes require authentication
router.use(requireAuth);

// Admin check middleware - looks up role from data (sessions only store username)
function requireAdmin(req, res, next) {
  const data = getData();
  if (data.user && data.user.username === req.user.username) {
    req.user.role = 'admin';
    return next();
  }
  const users = data.users || [];
  const user = users.find(u => u.username === req.user.username);
  if (user) req.user.role = user.role || 'user';
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin required' });
  }
  next();
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /shares
 * List all configured Samba shares (parsed from smb.conf)
 */
router.get('/shares', requireAdmin, (req, res) => {
  try {
    const shares = parseSmbConf();

    // Normalize the parsed data for consistent API output
    const result = shares.map(share => ({
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

    res.json({ shares: result, count: result.length });
  } catch (err) {
    console.error('List shares error:', err.message);
    res.status(500).json({ error: 'Failed to read Samba configuration' });
  }
});

/**
 * POST /shares
 * Create a new Samba share
 * Body: { name, path, comment, readOnly, guestOk, validUsers }
 */
router.post('/shares', requireAdmin, async (req, res) => {
  try {
    const { name, path: sharePath, comment, readOnly, guestOk, validUsers } = req.body;

    // Validate share name
    if (!validateShareName(name)) {
      return res.status(400).json({
        error: 'Invalid share name. Use alphanumeric characters, hyphens, and underscores only.',
      });
    }

    // Validate path is within storage
    if (!sharePath) {
      return res.status(400).json({ error: 'Share path is required' });
    }
    const sanitizedPath = sanitizePathWithinBase(sharePath, STORAGE_BASE);
    if (sanitizedPath === null) {
      return res.status(400).json({ error: 'Share path must be within /mnt/storage' });
    }

    // Check if share name already exists
    const existingShares = parseSmbConf();
    if (existingShares.some(s => s.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: 'A share with this name already exists' });
    }

    // Ensure the share directory exists
    if (!fs.existsSync(sanitizedPath)) {
      fs.mkdirSync(sanitizedPath, { recursive: true });
    }

    // Build the new share section
    const shareConfig = {
      name,
      path: sanitizedPath,
      comment: comment || '',
      readOnly: readOnly === true,
      guestOk: guestOk === true,
      validUsers: Array.isArray(validUsers) ? validUsers : [],
    };

    const section = buildShareSection(shareConfig);

    // Add to smb.conf
    const currentConf = readSmbConf();
    const newConf = upsertSectionInConf(currentConf, name, section);
    await writeSmbConf(newConf);

    // Restart Samba to apply changes
    await restartSamba();

    logSecurityEvent('samba_share_created', req.user.username, {
      share: name,
      path: sanitizedPath,
    });

    res.status(201).json({
      message: `Share '${name}' created successfully`,
      share: shareConfig,
    });
  } catch (err) {
    console.error('Create share error:', err.message);
    res.status(500).json({ error: 'Failed to create share' });
  }
});

/**
 * PUT /shares/:name
 * Update an existing Samba share configuration
 * Body: { path, comment, readOnly, guestOk, validUsers }
 */
router.put('/shares/:name', requireAdmin, async (req, res) => {
  try {
    const shareName = req.params.name;
    const { path: sharePath, comment, readOnly, guestOk, validUsers } = req.body;

    // Check share exists
    const existingShares = parseSmbConf();
    const existing = existingShares.find(s => s.name === shareName);
    if (!existing) {
      return res.status(404).json({ error: 'Share not found' });
    }

    // Validate path if provided
    let resolvedPath = existing.path;
    if (sharePath !== undefined) {
      const sanitizedPath = sanitizePathWithinBase(sharePath, STORAGE_BASE);
      if (sanitizedPath === null) {
        return res.status(400).json({ error: 'Share path must be within /mnt/storage' });
      }
      resolvedPath = sanitizedPath;

      // Ensure directory exists
      if (!fs.existsSync(resolvedPath)) {
        fs.mkdirSync(resolvedPath, { recursive: true });
      }
    }

    // Build updated share config (merge existing with new values)
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
    const currentConf = readSmbConf();
    const newConf = upsertSectionInConf(currentConf, shareName, section);
    await writeSmbConf(newConf);

    // Restart Samba
    await restartSamba();

    logSecurityEvent('samba_share_updated', req.user.username, {
      share: shareName,
      changes: req.body,
    });

    res.json({
      message: `Share '${shareName}' updated successfully`,
      share: shareConfig,
    });
  } catch (err) {
    console.error('Update share error:', err.message);
    res.status(500).json({ error: 'Failed to update share' });
  }
});

/**
 * DELETE /shares/:name
 * Remove a Samba share from configuration
 */
router.delete('/shares/:name', requireAdmin, async (req, res) => {
  try {
    const shareName = req.params.name;

    // Verify share exists
    const existingShares = parseSmbConf();
    const existing = existingShares.find(s => s.name === shareName);
    if (!existing) {
      return res.status(404).json({ error: 'Share not found' });
    }

    // Remove from smb.conf
    const currentConf = readSmbConf();
    const newConf = removeSectionFromConf(currentConf, shareName);
    await writeSmbConf(newConf);

    // Restart Samba
    await restartSamba();

    logSecurityEvent('samba_share_deleted', req.user.username, {
      share: shareName,
      path: existing.path,
    });

    res.json({ message: `Share '${shareName}' deleted successfully` });
  } catch (err) {
    console.error('Delete share error:', err.message);
    res.status(500).json({ error: 'Failed to delete share' });
  }
});

/**
 * GET /status
 * Get Samba service status and connected users
 */
router.get('/status', requireAdmin, async (req, res) => {
  try {
    // Check if smbd is running
    let serviceStatus = 'unknown';
    try {
      const { stdout } = await execFileAsync('systemctl', ['is-active', 'smbd']);
      serviceStatus = stdout.trim();
    } catch (err) {
      // systemctl returns non-zero for inactive/failed
      serviceStatus = err.stdout ? err.stdout.trim() : 'inactive';
    }

    // Get connected users via smbstatus
    let connectedUsers = [];
    try {
      const { stdout } = await execFileAsync('sudo', ['smbstatus', '-b', '--json']);
      // smbstatus --json returns JSON on newer versions
      const statusData = JSON.parse(stdout);
      if (statusData.sessions) {
        connectedUsers = Object.values(statusData.sessions).map(session => ({
          username: session.username,
          group: session.groupname,
          machine: session.remote_machine,
          protocol: session.protocol_ver,
          connectedSince: session.signing || null,
        }));
      }
    } catch {
      // Fallback: parse text output if JSON not supported
      try {
        const { stdout } = await execFileAsync('sudo', ['smbstatus', '-b']);
        const lines = stdout.split('\n').filter(l => l.trim() && !l.startsWith('-'));
        // Skip header lines (first 3-4 lines are headers)
        let headerPassed = false;
        for (const line of lines) {
          if (line.includes('PID') && line.includes('Username')) {
            headerPassed = true;
            continue;
          }
          if (!headerPassed) continue;
          if (line.trim() === '') continue;

          // Parse: PID  Username  Group  Machine  Protocol Version  Encryption  Signing
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

    res.json({
      service: serviceStatus,
      running: serviceStatus === 'active',
      connectedUsers,
      connectedCount: connectedUsers.length,
    });
  } catch (err) {
    console.error('Samba status error:', err.message);
    res.status(500).json({ error: 'Failed to get Samba status' });
  }
});

/**
 * POST /restart
 * Restart Samba services (smbd and nmbd)
 */
router.post('/restart', requireAdmin, async (req, res) => {
  try {
    await restartSamba();

    logSecurityEvent('samba_restart', req.user.username);

    // Wait a moment then check status
    await new Promise(resolve => setTimeout(resolve, 1000));

    let status = 'unknown';
    try {
      const { stdout } = await execFileAsync('systemctl', ['is-active', 'smbd']);
      status = stdout.trim();
    } catch (err) {
      status = err.stdout ? err.stdout.trim() : 'failed';
    }

    res.json({
      message: 'Samba services restarted',
      status,
      running: status === 'active',
    });
  } catch (err) {
    console.error('Samba restart error:', err.message);
    res.status(500).json({ error: 'Failed to restart Samba services' });
  }
});

module.exports = router;
