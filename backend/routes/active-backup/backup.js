/**
 * Active Backup — Backup operations (trigger, status, runBackup)
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getData, saveData } = require('../../utils/data');
const { logSecurityEvent } = require('../../utils/security');
const {
  SSH_KEY_PATH, deviceDir, getVersions, nextVersion,
  enforceRetention, notifyBackupFailure,
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

// Track running backups (shared state)
const runningBackups = new Map();

/**
 * POST /:id/backup - Trigger manual backup
 */
router.post('/:id/backup', async (req, res) => {
  const data = getData();
  if (!data.activeBackup) return res.status(404).json({ error: 'No devices configured' });

  const device = data.activeBackup.devices.find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  if (runningBackups.has(device.id)) {
    return res.status(409).json({ error: 'Backup already in progress for this device' });
  }

  res.json({ success: true, message: `Backup started for "${device.name}"` });
  runBackup(device);
});

/**
 * GET /:id/status - Get backup progress
 */
router.get('/:id/status', (req, res) => {
  const running = runningBackups.get(req.params.id);
  if (running) {
    return res.json({ success: true, status: 'running', startedAt: running.startedAt, output: running.output.slice(-2000) });
  }

  const data = getData();
  if (!data.activeBackup) return res.json({ success: true, status: 'idle' });
  const device = data.activeBackup.devices.find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  res.json({
    success: true, status: 'idle',
    lastBackup: device.lastBackup, lastResult: device.lastResult,
    lastError: device.lastError, lastDuration: device.lastDuration,
  });
});

/**
 * Core backup function: rsync with hardlinks for deduplication
 */
async function runBackup(device) {
  const startTime = Date.now();
  const backupState = { startedAt: new Date().toISOString(), output: '' };
  runningBackups.set(device.id, backupState);

  const dir = deviceDir(device.id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const vNum = nextVersion(device.id);
  const vDir = path.join(dir, `v${vNum}`);
  const versions = getVersions(device.id);
  const prevDir = versions.length > 0 ? path.join(dir, versions[versions.length - 1]) : null;

  try {
    const sshCmd = `ssh -i ${SSH_KEY_PATH} -o StrictHostKeyChecking=no -o ConnectTimeout=10 -p ${device.sshPort || 22}`;

    // SECURITY: Validate all paths before use
    const sanitizedPaths = [];
    for (const srcPath of device.paths) {
      const sanitized = sanitizeBackupPath(srcPath);
      if (!sanitized) {
        throw new Error(`Invalid backup path rejected: ${srcPath}`);
      }
      sanitizedPaths.push(sanitized);
    }

    // SECURITY: Validate all exclude patterns
    const sanitizedExcludes = [];
    for (const exc of (device.excludes || [])) {
      const sanitized = sanitizeBackupPath(exc);
      if (!sanitized) {
        throw new Error(`Invalid exclude pattern rejected: ${exc}`);
      }
      sanitizedExcludes.push(sanitized);
    }

    for (const srcPath of sanitizedPaths) {
      const args = ['-az', '--delete', '--stats', '-e', sshCmd];
      if (prevDir) args.push('--link-dest=' + prevDir);
      for (const exc of sanitizedExcludes) args.push('--exclude=' + exc);

      const remoteSrc = `${device.sshUser}@${device.ip}:${srcPath}/`;
      const destSub = path.join(vDir, srcPath);
      if (!fs.existsSync(destSub)) fs.mkdirSync(destSub, { recursive: true });
      args.push(remoteSrc, destSub + '/');

      await new Promise((resolve, reject) => {
        const proc = spawn('rsync', args);
        proc.stdout.on('data', (chunk) => { backupState.output += chunk.toString(); });
        proc.stderr.on('data', (chunk) => { backupState.output += chunk.toString(); });
        proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`rsync exited with code ${code}\n${backupState.output.slice(-500)}`)));
        proc.on('error', reject);
      });
    }

    // Success
    const duration = Math.round((Date.now() - startTime) / 1000);
    const data = getData();
    const dev = data.activeBackup.devices.find(d => d.id === device.id);
    if (dev) {
      dev.lastBackup = new Date().toISOString();
      dev.lastResult = 'success';
      dev.lastError = null;
      dev.lastDuration = duration;
      saveData(data);
    }

    enforceRetention(device.id, device.retention || 5);

    const latestLink = path.join(dir, 'latest');
    try { fs.unlinkSync(latestLink); } catch(e) {}
    fs.symlinkSync(`v${vNum}`, latestLink);

    logSecurityEvent('active_backup_success', 'system', { device: device.name, version: vNum, duration });
  } catch (err) {
    console.error(`Backup failed for ${device.name}:`, err.message);

    if (fs.existsSync(vDir)) {
      try { fs.rmSync(vDir, { recursive: true, force: true }); } catch(e) {}
    }

    const data = getData();
    const dev = data.activeBackup.devices.find(d => d.id === device.id);
    if (dev) {
      dev.lastBackup = new Date().toISOString();
      dev.lastResult = 'failed';
      dev.lastError = err.message.slice(0, 500);
      dev.lastDuration = Math.round((Date.now() - startTime) / 1000);
      saveData(data);
    }

    await notifyBackupFailure(device, err.message.slice(0, 200));
    logSecurityEvent('active_backup_failed', 'system', { device: device.name, error: err.message.slice(0, 200) });
  } finally {
    runningBackups.delete(device.id);
  }
}

// Expose for scheduler
module.exports = router;
module.exports.runBackup = runBackup;
module.exports.runningBackups = runningBackups;
