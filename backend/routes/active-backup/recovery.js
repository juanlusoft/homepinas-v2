/**
 * Active Backup — Recovery USB
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { logSecurityEvent } = require('../../utils/security');

/**
 * GET /status - Check if recovery ISO exists
 */
router.get('/status', (req, res) => {
  const isoDir = path.join(__dirname, '..', '..', '..', 'recovery-usb');
  const isoPath = path.join(isoDir, 'homepinas-recovery.iso');

  let isoInfo = null;
  if (fs.existsSync(isoPath)) {
    const stat = fs.statSync(isoPath);
    isoInfo = { exists: true, size: stat.size, modified: stat.mtime };
  }

  res.json({
    success: true,
    scriptsAvailable: fs.existsSync(path.join(isoDir, 'build-recovery-iso.sh')),
    iso: isoInfo,
  });
});

/**
 * POST /build - Build recovery ISO
 */
router.post('/build', async (req, res) => {
  const isoDir = path.join(__dirname, '..', '..', '..', 'recovery-usb');
  const buildScript = path.join(isoDir, 'build-recovery-iso.sh');

  if (!fs.existsSync(buildScript)) return res.status(404).json({ error: 'Build script not found' });

  res.json({ success: true, message: 'ISO build started. This will take several minutes.' });

  const proc = spawn('sudo', ['bash', buildScript], { cwd: isoDir, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  proc.stdout.on('data', (chunk) => { output += chunk.toString(); });
  proc.stderr.on('data', (chunk) => { output += chunk.toString(); });
  proc.on('close', (code) => {
    if (code === 0) {
      logSecurityEvent('recovery_iso_built', 'system', { success: true });
    } else {
      logSecurityEvent('recovery_iso_build_failed', 'system', { code, output: output.slice(-500) });
      console.error('[Active Backup] Recovery ISO build failed:', output.slice(-500));
    }
  });
});

/**
 * GET /download - Download recovery ISO
 */
router.get('/download', (req, res) => {
  const isoPath = path.join(__dirname, '..', '..', '..', 'recovery-usb', 'homepinas-recovery.iso');
  if (!fs.existsSync(isoPath)) return res.status(404).json({ error: 'Recovery ISO not found. Build it first.' });
  res.download(isoPath, 'homepinas-recovery.iso');
});

/**
 * GET /scripts - Download recovery scripts as tar.gz
 */
router.get('/scripts', (req, res) => {
  const scriptsDir = path.join(__dirname, '..', '..', '..', 'recovery-usb');
  if (!fs.existsSync(scriptsDir)) return res.status(404).json({ error: 'Recovery scripts not found' });

  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', 'attachment; filename="homepinas-recovery-scripts.tar.gz"');

  const tar = spawn('tar', ['-czf', '-', '-C', path.dirname(scriptsDir), 'recovery-usb'], { stdio: ['ignore', 'pipe', 'ignore'] });
  tar.stdout.pipe(res);
});

module.exports = router;
