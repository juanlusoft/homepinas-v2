/**
 * Active Backup — Device CRUD
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const os = require('os');
const { getData, saveData } = require('../../utils/data');
const { logSecurityEvent } = require('../../utils/security');
const {
  ensureSSHKey, deviceDir, getVersions, getDirSize, getLocalIPs,
  getImageFiles, getImageBackupInstructions, ensureSambaUser, createImageBackupShare,
} = require('./helpers');

/**
 * SECURITY: Sanitize backup paths to prevent command injection
 * Rejects paths containing shell metacharacters that could be exploited
 * @param {string} pathStr - Path to sanitize
 * @returns {string|null} - Sanitized path or null if invalid
 */
function sanitizeBackupPath(pathStr) {
  if (!pathStr || typeof pathStr !== 'string') return null;
  
  // Reject dangerous shell metacharacters
  const dangerousChars = /[;&|`$(){}[\]<>\\!\n\r]/;
  if (dangerousChars.test(pathStr)) {
    console.error(`[SECURITY] Rejected path with dangerous characters: ${pathStr}`);
    return null;
  }
  
  // Must be absolute path or relative pattern (for excludes)
  if (!pathStr.startsWith('/') && !pathStr.startsWith('.') && !pathStr.includes('*')) {
    console.error(`[SECURITY] Rejected invalid path format: ${pathStr}`);
    return null;
  }
  
  return pathStr.trim();
}

/**
 * GET / - List all devices with status
 */
router.get('/', (req, res) => {
  const data = getData();
  const ab = data.activeBackup || { devices: [] };

  const devices = ab.devices.map(d => {
    const dir = deviceDir(d.id);
    const isImage = d.backupType === 'image';

    if (isImage) {
      const images = getImageFiles(d.id);
      return { ...d, backupCount: images.length, totalSize: fs.existsSync(dir) ? getDirSize(dir) : 0, images };
    }

    const versions = getVersions(d.id);
    return {
      ...d,
      backupCount: versions.length,
      totalSize: fs.existsSync(dir) ? getDirSize(dir) : 0,
      versions: versions.map(v => {
        const stat = fs.statSync(require('path').join(dir, v));
        return { name: v, date: stat.mtime };
      }),
    };
  });

  res.json({ success: true, devices });
});

/**
 * GET /:id/images - List image backup files
 */
router.get('/:id/images', (req, res) => {
  const data = getData();
  if (!data.activeBackup) return res.json({ success: true, images: [] });
  const device = data.activeBackup.devices.find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const images = getImageFiles(device.id);
  const dir = deviceDir(device.id);

  let windowsBackups = [];
  const wibPath = require('path').join(dir, 'WindowsImageBackup');
  if (fs.existsSync(wibPath)) {
    try {
      windowsBackups = fs.readdirSync(wibPath, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => {
          const bPath = require('path').join(wibPath, d.name);
          return { name: d.name, size: getDirSize(bPath), modified: fs.statSync(bPath).mtime, type: 'windows-image' };
        });
    } catch(e) {}
  }

  res.json({ success: true, images, windowsBackups, totalSize: getDirSize(dir) });
});

/**
 * GET /:id/instructions - Setup instructions
 */
router.get('/:id/instructions', async (req, res) => {
  const data = getData();
  if (!data.activeBackup) return res.status(404).json({ error: 'No devices' });
  const device = data.activeBackup.devices.find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  if (device.backupType === 'image') {
    res.json({ success: true, instructions: getImageBackupInstructions(device) });
  } else {
    const pubKey = await ensureSSHKey();
    res.json({
      success: true, sshPublicKey: pubKey,
      instructions: {
        title: 'Configurar acceso SSH',
        command: `mkdir -p ~/.ssh && echo '${pubKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`,
      },
    });
  }
});

/**
 * POST / - Register a new device
 */
router.post('/', async (req, res) => {
  try {
    const { name, ip, sshUser, sshPort, paths, excludes, schedule, retention, backupType, os: deviceOS, password } = req.body;
    const isImage = backupType === 'image';

    if (!name || !ip) return res.status(400).json({ error: 'name and ip are required' });
    if (!isImage && !sshUser) return res.status(400).json({ error: 'sshUser is required for file backups' });

    // SECURITY: Validate all backup paths and excludes
    const sanitizedPaths = [];
    if (paths && Array.isArray(paths)) {
      for (const p of paths) {
        const sanitized = sanitizeBackupPath(p);
        if (!sanitized) {
          return res.status(400).json({ error: `Invalid backup path: ${p}` });
        }
        sanitizedPaths.push(sanitized);
      }
    } else if (!isImage) {
      sanitizedPaths.push('/home'); // Default safe path
    }

    const sanitizedExcludes = [];
    const defaultExcludes = ['.cache', '*.tmp', 'node_modules', '.Trash*', '.local/share/Trash'];
    const excludeList = excludes || defaultExcludes;
    if (Array.isArray(excludeList)) {
      for (const exc of excludeList) {
        const sanitized = sanitizeBackupPath(exc);
        if (!sanitized) {
          return res.status(400).json({ error: `Invalid exclude pattern: ${exc}` });
        }
        sanitizedExcludes.push(sanitized);
      }
    }

    let pubKey = null;
    if (!isImage) pubKey = await ensureSSHKey();

    const deviceId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const device = {
      id: deviceId, name: name.trim(), ip: ip.trim(),
      backupType: isImage ? 'image' : 'files',
      os: deviceOS || (isImage ? 'windows' : 'linux'),
      sshUser: sshUser ? sshUser.trim() : '', sshPort: parseInt(sshPort) || 22,
      paths: sanitizedPaths,
      excludes: sanitizedExcludes,
      schedule: schedule || '0 2 * * *', retention: parseInt(retention) || 5,
      enabled: true, registeredAt: new Date().toISOString(),
      lastBackup: null, lastResult: null, lastError: null, lastDuration: null,
      sambaShare: isImage ? `backup-${deviceId.slice(0, 8)}` : null,
    };

    const data = getData();
    if (!data.activeBackup) data.activeBackup = { devices: [] };
    data.activeBackup.devices.push(device);
    saveData(data);

    const dir = deviceDir(deviceId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let sambaSetup = null;
    if (isImage) {
      try {
        if (password) await ensureSambaUser(req.user.username, password);
        await createImageBackupShare(device, req.user.username);
        const nasHostname = os.hostname();
        const uncPath = `\\\\${device.ip === '127.0.0.1' ? 'localhost' : nasHostname}\\${device.sambaShare}`;
        sambaSetup = { sharePath: uncPath, shareUser: req.user.username, instructions: getImageBackupInstructions(device) };
      } catch (sambaErr) {
        console.error('Failed to create Samba share:', sambaErr.message);
      }
    }

    logSecurityEvent('active_backup_device_added', req.user.username, { device: name, ip, type: device.backupType });

    const response = { success: true, device };
    if (isImage) {
      response.sambaSetup = sambaSetup;
    } else {
      response.sshPublicKey = pubKey;
      response.setupInstructions = `En el equipo "${name}" (${ip}), ejecuta:\n\nmkdir -p ~/.ssh && echo '${pubKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
    }
    res.json(response);
  } catch (err) {
    console.error('Add device error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /:id - Update device config
 */
router.put('/:id', (req, res) => {
  const data = getData();
  if (!data.activeBackup) return res.status(404).json({ error: 'No devices configured' });

  const idx = data.activeBackup.devices.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Device not found' });

  // SECURITY: Validate paths and excludes if provided
  if (req.body.paths !== undefined) {
    if (!Array.isArray(req.body.paths)) {
      return res.status(400).json({ error: 'paths must be an array' });
    }
    const sanitizedPaths = [];
    for (const p of req.body.paths) {
      const sanitized = sanitizeBackupPath(p);
      if (!sanitized) {
        return res.status(400).json({ error: `Invalid backup path: ${p}` });
      }
      sanitizedPaths.push(sanitized);
    }
    data.activeBackup.devices[idx].paths = sanitizedPaths;
  }

  if (req.body.excludes !== undefined) {
    if (!Array.isArray(req.body.excludes)) {
      return res.status(400).json({ error: 'excludes must be an array' });
    }
    const sanitizedExcludes = [];
    for (const exc of req.body.excludes) {
      const sanitized = sanitizeBackupPath(exc);
      if (!sanitized) {
        return res.status(400).json({ error: `Invalid exclude pattern: ${exc}` });
      }
      sanitizedExcludes.push(sanitized);
    }
    data.activeBackup.devices[idx].excludes = sanitizedExcludes;
  }

  // Update other allowed fields
  const allowed = ['name', 'ip', 'sshUser', 'sshPort', 'schedule', 'retention', 'enabled', 'os'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) data.activeBackup.devices[idx][key] = req.body[key];
  }

  saveData(data);
  res.json({ success: true, device: data.activeBackup.devices[idx] });
});

/**
 * DELETE /:id - Remove device
 */
router.delete('/:id', (req, res) => {
  const data = getData();
  if (!data.activeBackup) return res.status(404).json({ error: 'No devices configured' });

  const idx = data.activeBackup.devices.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Device not found' });

  const device = data.activeBackup.devices[idx];
  data.activeBackup.devices.splice(idx, 1);
  saveData(data);

  if (req.query.deleteData === 'true') {
    const dir = deviceDir(req.params.id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }

  logSecurityEvent('active_backup_device_removed', req.user.username, { device: device.name });
  res.json({ success: true, message: `Device "${device.name}" removed` });
});

/**
 * GET /ssh-key - Get NAS public SSH key
 */
router.get('/ssh-key', async (req, res) => {
  try {
    const pubKey = await ensureSSHKey();
    res.json({ success: true, publicKey: pubKey });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate SSH key' });
  }
});

module.exports = router;
