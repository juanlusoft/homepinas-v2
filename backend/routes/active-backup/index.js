/**
 * HomePiNAS v2 - Active Backup for Business (ABB)
 * Centralized backup of PCs/servers to NAS via rsync+SSH
 *
 * Modular structure:
 *   agent.js    — Agent endpoints (no auth: ping, register, poll, report)
 *   devices.js  — Device CRUD
 *   backup.js   — Backup operations (trigger, status, runBackup)
 *   browse.js   — Browse & restore backup versions
 *   recovery.js — USB recovery ISO
 *   pending.js  — Agent approval management
 *   helpers.js  — Shared utilities
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const { getData } = require('../../utils/data');
const { parseCronHourMinute } = require('./helpers');

// ── Agent endpoints (no auth) ──
const agentRouter = require('./agent');
router.use('/', agentRouter);

// ── All remaining routes require auth ──
router.use(requireAuth);

// ── Device management ──
const devicesRouter = require('./devices');
router.use('/devices', devicesRouter);
// Also mount at root for backward compat (GET /devices, POST /devices, etc.)
router.get('/devices', (req, res, next) => next());
router.use('/', devicesRouter);

// ── Backup operations ──
const backupRouter = require('./backup');
router.use('/devices', backupRouter);

// ── Browse & restore ──
const browseRouter = require('./browse');
router.use('/devices', browseRouter);

// ── Recovery USB ──
const recoveryRouter = require('./recovery');
router.use('/recovery', recoveryRouter);

// ── Agent management (pending, approve, reject, trigger) ──
const pendingRouter = require('./pending');
router.use('/pending', pendingRouter);

// ── Trigger endpoint at legacy path ──
const { runningBackups } = require('./backup');
router.post('/devices/:id/trigger', (req, res) => {
  const data = getData();
  if (!data.activeBackup) return res.status(404).json({ error: 'Not configured' });
  const device = data.activeBackup.devices.find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  if (!device.agentToken) return res.status(400).json({ error: 'Device is not agent-managed' });
  const { saveData } = require('../../utils/data');
  device._triggerBackup = true;
  saveData(data);
  res.json({ success: true, message: `Backup triggered for "${device.name}". Agent will start on next poll.` });
});

// ── SSH key endpoint ──
router.get('/ssh-key', async (req, res) => {
  const { ensureSSHKey } = require('./helpers');
  try {
    const pubKey = await ensureSSHKey();
    res.json({ success: true, publicKey: pubKey });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate SSH key' });
  }
});

// ── Scheduler: check every minute for scheduled backups ──
const { runBackup } = require('./backup');
setInterval(() => {
  const now = new Date();
  const data = getData();
  if (!data.activeBackup || !data.activeBackup.devices) return;

  for (const device of data.activeBackup.devices) {
    if (!device.enabled || !device.schedule) continue;
    if (runningBackups.has(device.id)) continue;

    const parsed = parseCronHourMinute(device.schedule);
    if (!parsed) continue;

    if (now.getHours() === parsed.hour && now.getMinutes() === parsed.minute) {
      console.log(`[Active Backup] Starting scheduled backup for ${device.name}`);
      runBackup(device);
    }
  }
}, 60000);

module.exports = router;
