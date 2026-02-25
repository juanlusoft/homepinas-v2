/**
 * Active Backup — Agent endpoints (with rate limiting)
 * SECURITY: Rate limiting protects against brute-force and DoS attacks
 */
const express = require('express');
const router = express.Router();
const os = require('os');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { getData, saveData } = require('../../utils/data');
const { logSecurityEvent } = require('../../utils/security');
const { getLocalIPs } = require('./helpers');

// Rate limiting configurations
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Max 5 registration attempts per IP per hour
  message: { error: 'Too many registration attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const pollLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // Max 60 polls per IP per minute
  message: { error: 'Too many poll requests. Slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const reportLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Max 10 reports per IP per minute
  message: { error: 'Too many report submissions. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * GET /agent/ping - Health check for agent discovery
 * Note: No rate limiting on ping (health check)
 */
router.get('/agent/ping', (req, res) => {
  res.json({ success: true, service: 'HomePiNAS', hostname: os.hostname() });
});

/**
 * POST /agent/register - Agent announces itself to the NAS
 * SECURITY: Rate limited to 5 requests per IP per hour
 */
router.post('/agent/register', registerLimiter, (req, res) => {
  const { hostname, ip, os: agentOS, mac } = req.body;
  if (!hostname) return res.status(400).json({ error: 'hostname is required' });

  const data = getData();
  if (!data.activeBackup) data.activeBackup = { devices: [], pendingAgents: [] };
  if (!data.activeBackup.pendingAgents) data.activeBackup.pendingAgents = [];

  // Already registered?
  const existing = data.activeBackup.devices.find(d => d.agentMac === mac || (d.agentHostname === hostname && d.ip === ip));
  if (existing) {
    return res.json({ success: true, agentId: existing.id, agentToken: existing.agentToken, status: existing.status || 'approved' });
  }

  // Already pending?
  const pending = data.activeBackup.pendingAgents.find(a => a.mac === mac || (a.hostname === hostname && a.ip === ip));
  if (pending) {
    return res.json({ success: true, agentId: pending.id, agentToken: pending.agentToken, status: 'pending' });
  }

  // New agent → pending
  const agentId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const agentToken = crypto.randomBytes(32).toString('hex');

  data.activeBackup.pendingAgents.push({
    id: agentId, agentToken, hostname,
    ip: ip || req.ip, os: agentOS || 'unknown',
    mac: mac || null, registeredAt: new Date().toISOString(),
  });
  saveData(data);

  console.log(`[Active Backup] New agent registered: ${hostname} (${ip || req.ip})`);
  res.json({ success: true, agentId, agentToken, status: 'pending' });
});

/**
 * GET /agent/poll - Agent checks for config and tasks
 * SECURITY: Rate limited to 60 requests per IP per minute
 */
router.get('/agent/poll', pollLimiter, (req, res) => {
  const token = req.headers['x-agent-token'];
  if (!token) return res.status(401).json({ error: 'Missing agent token' });

  const data = getData();
  if (!data.activeBackup) return res.status(404).json({ error: 'Not configured' });

  const pending = (data.activeBackup.pendingAgents || []).find(a => a.agentToken === token);
  if (pending) {
    return res.json({ status: 'pending', message: 'Esperando aprobación del administrador' });
  }

  const device = data.activeBackup.devices.find(d => d.agentToken === token);
  if (!device) return res.status(404).json({ error: 'Agent not found' });

  // Update presence
  device.lastSeen = new Date().toISOString();
  const pollVersion = req.headers['x-agent-version'] || device.agentVersion;
  const pollIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || device.ip;
  if (pollVersion) device.agentVersion = pollVersion;
  if (pollIp) device.ip = pollIp;

  const response = {
    status: 'approved',
    config: {
      deviceId: device.id, deviceName: device.name, backupType: device.backupType,
      schedule: device.schedule, retention: device.retention,
      paths: device.paths || [], enabled: device.enabled,
    },
    lastBackup: device.lastBackup,
    lastResult: device.lastResult,
  };

  // Samba config for image backups
  if (device.backupType === 'image' && device.sambaShare) {
    response.config.sambaShare = device.sambaShare;
    response.config.nasAddress = getLocalIPs()[0] || req.hostname;
    response.config.sambaUser = device.sambaUser || '';
    response.config.sambaPass = device.sambaPass || '';
  }

  // Pending trigger?
  if (device._triggerBackup) {
    response.action = 'backup';
    device._triggerBackup = false;
  }

  saveData(data);
  res.json(response);
});

/**
 * POST /agent/report - Agent reports backup result
 * SECURITY: Rate limited to 10 requests per IP per minute
 */
router.post('/agent/report', reportLimiter, async (req, res) => {
  const token = req.headers['x-agent-token'];
  if (!token) return res.status(401).json({ error: 'Missing agent token' });

  const { status, duration, error: errorMsg, size, log: backupLog } = req.body;
  const data = getData();
  if (!data.activeBackup) return res.status(404).json({ error: 'Not configured' });

  const device = data.activeBackup.devices.find(d => d.agentToken === token);
  if (!device) return res.status(404).json({ error: 'Agent not found' });

  device.lastBackup = new Date().toISOString();
  device.lastResult = status === 'success' ? 'success' : 'failed';
  device.lastError = status === 'success' ? null : (errorMsg || 'Unknown error');
  device.lastDuration = duration || null;
  saveData(data);

  // Save log
  if (backupLog) {
    try {
      const path = require('path');
      const fsp = require('fs').promises;
      const logDir = path.join('/mnt/storage/active-backup', device.id, 'logs');
      await fsp.mkdir(logDir, { recursive: true });
      const logFile = path.join(logDir, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
      await fsp.writeFile(logFile, backupLog);
    } catch (logErr) {
      console.error('[ActiveBackup] Could not save log:', logErr.message);
    }
  }

  if (status !== 'success') {
    const { notifyBackupFailure } = require('./helpers');
    notifyBackupFailure(device, errorMsg || 'Unknown error');
  }

  logSecurityEvent(`active_backup_agent_${status}`, 'agent', { device: device.name, duration });
  res.json({ success: true });
});

module.exports = router;
