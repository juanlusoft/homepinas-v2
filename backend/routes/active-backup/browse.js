/**
 * Active Backup — Browse & Restore
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getData } = require('../../utils/data');
const { logSecurityEvent } = require('../../utils/security');
const { BACKUP_BASE, SSH_KEY_PATH, execFileAsync, deviceDir, getVersions, getDirSize } = require('./helpers');

/**
 * GET /:id/versions - List backup versions
 */
router.get('/:id/versions', (req, res) => {
  const versions = getVersions(req.params.id);
  const dir = deviceDir(req.params.id);

  const result = versions.map(v => {
    const vPath = path.join(dir, v);
    const stat = fs.statSync(vPath);
    return { name: v, date: stat.mtime, size: getDirSize(vPath) };
  });

  res.json({ success: true, versions: result });
});

// ── Resolve base path for a device+version ──
function resolveVersionPath(deviceId, version) {
  const safe = deviceId.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeVersion = version.replace(/[^a-zA-Z0-9_.-]/g, '');
  let basePath = path.join(BACKUP_BASE, safe, safeVersion);

  if (safeVersion === 'latest') {
    const target = fs.readlinkSync(basePath);
    basePath = path.join(BACKUP_BASE, safe, target);
  }

  return { basePath, safe, safeVersion };
}

/**
 * GET /:id/browse?version=v1&path=/home/user
 */
router.get('/:id/browse', (req, res) => {
  const version = req.query.version || 'latest';
  const browsePath = req.query.path || '/';

  let basePath, safe, safeVersion;
  try {
    ({ basePath, safe, safeVersion } = resolveVersionPath(req.params.id, version));
  } catch(e) {
    return res.status(404).json({ error: 'No backups available' });
  }

  const cleanPath = browsePath.replace(/\0/g, '').replace(/^\/+/, '');
  const fullPath = path.resolve(basePath, cleanPath);

  if (!fullPath.startsWith(path.resolve(BACKUP_BASE, safe))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Path not found' });
  if (!fs.statSync(fullPath).isDirectory()) return res.status(400).json({ error: 'Not a directory' });

  try {
    const items = fs.readdirSync(fullPath, { withFileTypes: true }).map(entry => {
      const entryPath = path.join(fullPath, entry.name);
      let size = 0, modified = null;
      try { const s = fs.statSync(entryPath); size = s.size; modified = s.mtime; } catch(e) {}
      return { name: entry.name, type: entry.isDirectory() ? 'directory' : 'file', size, modified };
    });

    res.json({
      success: true, path: browsePath, version: safeVersion,
      items: items.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      }),
    });
  } catch(err) {
    res.status(500).json({ error: 'Failed to browse directory' });
  }
});

/**
 * GET /:id/download?version=v1&path=/home/user/file.txt
 */
router.get('/:id/download', (req, res) => {
  const version = req.query.version || 'latest';
  const filePath = req.query.path || '';

  let basePath, safe;
  try {
    ({ basePath, safe } = resolveVersionPath(req.params.id, version));
  } catch(e) {
    return res.status(404).json({ error: 'No backups available' });
  }

  const cleanPath = filePath.replace(/\0/g, '').replace(/^\/+/, '');
  const fullPath = path.resolve(basePath, cleanPath);

  if (!fullPath.startsWith(path.resolve(BACKUP_BASE, safe))) return res.status(403).json({ error: 'Access denied' });
  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) return res.status(404).json({ error: 'File not found' });

  res.download(fullPath);
});

/**
 * POST /:id/restore - Restore files back to source device
 */
router.post('/:id/restore', async (req, res) => {
  const data = getData();
  if (!data.activeBackup) return res.status(404).json({ error: 'No devices' });
  const device = data.activeBackup.devices.find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const { version, sourcePath, destPath } = req.body;
  if (!version || !sourcePath) return res.status(400).json({ error: 'version and sourcePath required' });

  let basePath, safe;
  try {
    ({ basePath, safe } = resolveVersionPath(device.id, version));
  } catch(e) {
    return res.status(404).json({ error: 'No backups available' });
  }

  const cleanPath = sourcePath.replace(/\0/g, '').replace(/^\/+/, '');
  const localPath = path.resolve(basePath, cleanPath);

  if (!localPath.startsWith(path.resolve(BACKUP_BASE, safe))) return res.status(403).json({ error: 'Access denied' });
  if (!fs.existsSync(localPath)) return res.status(404).json({ error: 'Source path not found in backup' });

  const remoteDest = destPath || '/' + cleanPath;
  const sshCmd = `ssh -i ${SSH_KEY_PATH} -o StrictHostKeyChecking=no -o ConnectTimeout=10 -p ${device.sshPort || 22}`;

  try {
    const isDir = fs.statSync(localPath).isDirectory();
    const args = [
      '-az', '--progress', '-e', sshCmd,
      isDir ? localPath + '/' : localPath,
      `${device.sshUser}@${device.ip}:${remoteDest}${isDir ? '/' : ''}`,
    ];

    const { stdout } = await execFileAsync('rsync', args, { timeout: 300000 });
    logSecurityEvent('active_backup_restore', req.user.username, { device: device.name, version, path: sourcePath });
    res.json({ success: true, message: `Restored to ${device.ip}:${remoteDest}`, output: stdout });
  } catch (err) {
    res.status(500).json({ error: `Restore failed: ${err.message}` });
  }
});

module.exports = router;
