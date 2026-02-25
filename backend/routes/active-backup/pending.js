/**
 * Active Backup — Agent management (approve, reject, trigger)
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { spawn } = require('child_process');
const { getData, saveData } = require('../../utils/data');
const { logSecurityEvent } = require('../../utils/security');
const { execFileAsync, deviceDir, createImageBackupShare } = require('./helpers');

/**
 * GET / - List pending agents
 */
router.get('/', (req, res) => {
  const data = getData();
  res.json({ success: true, pending: (data.activeBackup && data.activeBackup.pendingAgents) || [] });
});

/**
 * POST /:id/approve - Approve a pending agent
 */
router.post('/:id/approve', async (req, res) => {
  try {
    const { backupType, schedule, retention, paths } = req.body;
    const data = getData();
    if (!data.activeBackup || !data.activeBackup.pendingAgents) return res.status(404).json({ error: 'No pending agents' });

    const idx = data.activeBackup.pendingAgents.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Pending agent not found' });

    const agent = data.activeBackup.pendingAgents[idx];
    const isImage = backupType === 'image';
    const deviceId = agent.id;
    const sambaPass = crypto.randomBytes(16).toString('hex');

    const device = {
      id: deviceId, name: agent.hostname, ip: agent.ip,
      agentHostname: agent.hostname, agentMac: agent.mac, agentToken: agent.agentToken,
      backupType: isImage ? 'image' : 'files',
      os: agent.os === 'win32' ? 'windows' : (agent.os === 'darwin' ? 'macos' : agent.os),
      sshUser: '', sshPort: 22,
      paths: paths || (isImage ? [] : []),
      excludes: ['.cache', '*.tmp', 'node_modules', '.Trash*', '.local/share/Trash'],
      schedule: schedule || '0 3 * * *', retention: parseInt(retention) || 3,
      enabled: true, status: 'approved',
      registeredAt: agent.registeredAt, approvedAt: new Date().toISOString(), approvedBy: req.user.username,
      lastBackup: null, lastResult: null, lastError: null, lastDuration: null,
      sambaShare: isImage ? `backup-${deviceId.slice(0, 8)}` : null,
      sambaUser: null, sambaPass: null,
    };

    if (isImage) {
      const sambaUser = `backup-${deviceId.slice(0, 8)}`;
      device.sambaUser = sambaUser;
      device.sambaPass = sambaPass;

      try { await execFileAsync('sudo', ['useradd', '-r', '-s', '/usr/sbin/nologin', sambaUser]); } catch(e) {}
      try { await execFileAsync('sudo', ['usermod', '-aG', 'sambashare', sambaUser]); } catch(e) {}
      await new Promise((resolve, reject) => {
        const proc = spawn('sudo', ['smbpasswd', '-a', sambaUser, '-s'], { stdio: ['pipe', 'pipe', 'pipe'] });
        proc.on('error', reject);
        proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`smbpasswd exited ${code}`)));
        proc.stdin.write(`${sambaPass}\n${sambaPass}\n`);
        proc.stdin.end();
      });
      await execFileAsync('sudo', ['smbpasswd', '-e', sambaUser]);
      await createImageBackupShare(device, sambaUser);
    }

    data.activeBackup.pendingAgents.splice(idx, 1);
    if (!data.activeBackup.devices) data.activeBackup.devices = [];
    data.activeBackup.devices.push(device);
    saveData(data);

    logSecurityEvent('active_backup_agent_approved', req.user.username, { device: agent.hostname, ip: agent.ip });
    res.json({ success: true, device });
  } catch (err) {
    console.error('Approve agent error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/reject - Reject a pending agent
 */
router.post('/:id/reject', (req, res) => {
  const data = getData();
  if (!data.activeBackup || !data.activeBackup.pendingAgents) return res.status(404).json({ error: 'No pending agents' });

  const idx = data.activeBackup.pendingAgents.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Pending agent not found' });

  const agent = data.activeBackup.pendingAgents[idx];
  data.activeBackup.pendingAgents.splice(idx, 1);
  saveData(data);

  logSecurityEvent('active_backup_agent_rejected', req.user.username, { hostname: agent.hostname });
  res.json({ success: true, message: `Agent "${agent.hostname}" rejected` });
});

/**
 * POST /trigger/:id - Trigger immediate backup on agent
 */
router.post('/trigger/:id', (req, res) => {
  const data = getData();
  if (!data.activeBackup) return res.status(404).json({ error: 'Not configured' });

  const device = data.activeBackup.devices.find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  if (!device.agentToken) return res.status(400).json({ error: 'Device is not agent-managed' });

  device._triggerBackup = true;
  saveData(data);
  res.json({ success: true, message: `Backup triggered for "${device.name}". Agent will start on next poll.` });
});

module.exports = router;
