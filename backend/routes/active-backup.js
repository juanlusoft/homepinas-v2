/**
 * HomePiNAS v2 - Active Backup for Business (ABB)
 * Centralized backup of PCs/servers to NAS via rsync+SSH
 * Features: device management, versioned backups with hardlinks, browse/restore, alerts
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const { requireAuth } = require('../middleware/auth');
const { logSecurityEvent } = require('../utils/security');
const { getData, saveData } = require('../utils/data');

const execFileAsync = promisify(execFile);

// Base directory for all active backups
const BACKUP_BASE = '/mnt/storage/active-backup';
const SSH_KEY_PATH = path.join(os.homedir(), '.ssh', 'homepinas_backup_rsa');

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_BASE)) {
  try { fs.mkdirSync(BACKUP_BASE, { recursive: true }); } catch(e) {}
}

const crypto = require('crypto');

// ══════════════════════════════════════════
// AGENT ENDPOINTS (no auth — use agentToken)
// ══════════════════════════════════════════

/**
 * POST /agent/register - Agent announces itself to the NAS
 * No auth required — agent just says "I exist"
 */
router.post('/agent/register', (req, res) => {
  const { hostname, ip, os: agentOS, mac } = req.body;
  if (!hostname) return res.status(400).json({ error: 'hostname is required' });

  const data = getData();
  if (!data.activeBackup) data.activeBackup = { devices: [], pendingAgents: [] };
  if (!data.activeBackup.pendingAgents) data.activeBackup.pendingAgents = [];

  // Check if agent already registered (by MAC or hostname+ip)
  const existing = data.activeBackup.devices.find(d => d.agentMac === mac || (d.agentHostname === hostname && d.ip === ip));
  if (existing) {
    return res.json({
      success: true,
      agentId: existing.id,
      agentToken: existing.agentToken,
      status: existing.status || 'approved',
    });
  }

  // Check if already pending
  const pending = data.activeBackup.pendingAgents.find(a => a.mac === mac || (a.hostname === hostname && a.ip === ip));
  if (pending) {
    return res.json({
      success: true,
      agentId: pending.id,
      agentToken: pending.agentToken,
      status: 'pending',
    });
  }

  // New agent — add to pending
  const agentId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const agentToken = crypto.randomBytes(32).toString('hex');

  const agent = {
    id: agentId,
    agentToken,
    hostname,
    ip: ip || req.ip,
    os: agentOS || 'unknown',
    mac: mac || null,
    registeredAt: new Date().toISOString(),
  };

  data.activeBackup.pendingAgents.push(agent);
  saveData(data);

  console.log(`[Active Backup] New agent registered: ${hostname} (${ip || req.ip})`);

  res.json({
    success: true,
    agentId,
    agentToken,
    status: 'pending',
  });
});

/**
 * GET /agent/poll - Agent checks for config and tasks
 * Auth via X-Agent-Token header
 */
router.get('/agent/poll', (req, res) => {
  const token = req.headers['x-agent-token'];
  if (!token) return res.status(401).json({ error: 'Missing agent token' });

  const data = getData();
  if (!data.activeBackup) return res.status(404).json({ error: 'Not configured' });

  // Check if still pending
  const pending = (data.activeBackup.pendingAgents || []).find(a => a.agentToken === token);
  if (pending) {
    return res.json({ status: 'pending', message: 'Esperando aprobación del administrador' });
  }

  // Check approved device
  const device = data.activeBackup.devices.find(d => d.agentToken === token);
  if (!device) return res.status(404).json({ error: 'Agent not found' });

  // Build response with config
  const response = {
    status: 'approved',
    config: {
      deviceId: device.id,
      deviceName: device.name,
      backupType: device.backupType,
      schedule: device.schedule,
      retention: device.retention,
      paths: device.paths || [],
      enabled: device.enabled,
    },
    lastBackup: device.lastBackup,
    lastResult: device.lastResult,
  };

  // Include Samba credentials for image backups
  if (device.backupType === 'image' && device.sambaShare) {
    response.config.sambaShare = device.sambaShare;
    response.config.sambaUser = device.sambaUser || 'homepinas';
    response.config.sambaPass = device.sambaPass || '';
    response.config.nasAddress = getLocalIPs()[0] || req.hostname;
  }

  // Check if there's a pending trigger (manual backup from dashboard)
  if (device._triggerBackup) {
    response.action = 'backup';
    // Clear the trigger
    device._triggerBackup = false;
    saveData(data);
  }

  res.json(response);
});

/**
 * POST /agent/report - Agent reports backup result
 * Auth via X-Agent-Token header
 */
router.post('/agent/report', (req, res) => {
  const token = req.headers['x-agent-token'];
  if (!token) return res.status(401).json({ error: 'Missing agent token' });

  const { status, duration, error: errorMsg, size } = req.body;

  const data = getData();
  if (!data.activeBackup) return res.status(404).json({ error: 'Not configured' });

  const device = data.activeBackup.devices.find(d => d.agentToken === token);
  if (!device) return res.status(404).json({ error: 'Agent not found' });

  device.lastBackup = new Date().toISOString();
  device.lastResult = status === 'success' ? 'success' : 'failed';
  device.lastError = status === 'success' ? null : (errorMsg || 'Unknown error');
  device.lastDuration = duration || null;

  saveData(data);

  if (status !== 'success') {
    notifyBackupFailure(device, errorMsg || 'Unknown error');
  }

  logSecurityEvent(`active_backup_agent_${status}`, 'agent', { device: device.name, duration });

  res.json({ success: true });
});

// Helper: get local IPs for NAS address
function getLocalIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

// All remaining routes require auth
router.use(requireAuth);

// ── Helper: generate SSH key pair if not exists ──
async function ensureSSHKey() {
  if (fs.existsSync(SSH_KEY_PATH)) {
    return fs.readFileSync(SSH_KEY_PATH + '.pub', 'utf8').trim();
  }
  const sshDir = path.dirname(SSH_KEY_PATH);
  if (!fs.existsSync(sshDir)) fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
  await execFileAsync('ssh-keygen', ['-t', 'rsa', '-b', '4096', '-f', SSH_KEY_PATH, '-N', '', '-C', 'homepinas-backup']);
  fs.chmodSync(SSH_KEY_PATH, 0o600);
  return fs.readFileSync(SSH_KEY_PATH + '.pub', 'utf8').trim();
}

// ── Helper: get device backup dir ──
function deviceDir(deviceId) {
  // Sanitize deviceId
  const safe = deviceId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(BACKUP_BASE, safe);
}

// ── Helper: list version dirs sorted ──
function getVersions(deviceId) {
  const dir = deviceDir(deviceId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(d => d.startsWith('v') && fs.statSync(path.join(dir, d)).isDirectory())
    .sort((a, b) => {
      const na = parseInt(a.slice(1));
      const nb = parseInt(b.slice(1));
      return na - nb;
    });
}

// ── Helper: get next version number ──
function nextVersion(deviceId) {
  const versions = getVersions(deviceId);
  if (versions.length === 0) return 1;
  return parseInt(versions[versions.length - 1].slice(1)) + 1;
}

// ── Helper: enforce retention (delete oldest versions) ──
function enforceRetention(deviceId, retention) {
  const versions = getVersions(deviceId);
  const toDelete = versions.slice(0, Math.max(0, versions.length - retention));
  for (const v of toDelete) {
    const vPath = path.join(deviceDir(deviceId), v);
    fs.rmSync(vPath, { recursive: true, force: true });
  }
  // Update 'latest' symlink
  const remaining = getVersions(deviceId);
  const latestLink = path.join(deviceDir(deviceId), 'latest');
  try { fs.unlinkSync(latestLink); } catch(e) {}
  if (remaining.length > 0) {
    fs.symlinkSync(remaining[remaining.length - 1], latestLink);
  }
}

// ── Helper: calculate directory size ──
function getDirSize(dirPath) {
  let total = 0;
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(dirPath, item.name);
      if (item.isDirectory()) {
        total += getDirSize(full);
      } else {
        try { total += fs.statSync(full).size; } catch(e) {}
      }
    }
  } catch(e) {}
  return total;
}

// ── Helper: send failure notification ──
async function notifyBackupFailure(device, error) {
  const data = getData();
  const notifConfig = data.notifications || {};
  const message = `⚠️ Active Backup FAILED\n\nDevice: ${device.name} (${device.ip})\nTime: ${new Date().toLocaleString('es-ES')}\nError: ${error}`;

  // Telegram notification
  if (notifConfig.telegram && notifConfig.telegram.enabled && notifConfig.telegram.token && notifConfig.telegram.chatId) {
    try {
      const url = `https://api.telegram.org/bot${notifConfig.telegram.token}/sendMessage`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: notifConfig.telegram.chatId, text: message }),
      });
    } catch(e) { console.error('Telegram notify error:', e.message); }
  }

  // Email notification
  if (notifConfig.email && notifConfig.email.host && notifConfig.email.to) {
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: notifConfig.email.host,
        port: notifConfig.email.port || 587,
        secure: notifConfig.email.secure || false,
        auth: { user: notifConfig.email.user, pass: notifConfig.email.password },
      });
      await transporter.sendMail({
        from: notifConfig.email.from || notifConfig.email.user,
        to: notifConfig.email.to,
        subject: `⚠️ HomePiNAS: Backup failed - ${device.name}`,
        text: message,
      });
    } catch(e) { console.error('Email notify error:', e.message); }
  }
}

// ── Helper: create Samba share for image backup device ──
async function ensureSambaUser(username, password) {
  // Ensure the NAS user has a Samba password set for backup share access
  try {
    const { stdout } = await execFileAsync('sudo', ['pdbedit', '-L']);
    if (!stdout.includes(`${username}:`)) {
      // Add user to Samba with the same password as their NAS account
      await new Promise((resolve, reject) => {
        const proc = spawn('sudo', ['smbpasswd', '-a', username, '-s'], { stdio: ['pipe', 'pipe', 'pipe'] });
        proc.on('error', reject);
        proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`smbpasswd exited ${code}`)));
        proc.stdin.write(`${password}\n${password}\n`);
        proc.stdin.end();
      });
      await execFileAsync('sudo', ['smbpasswd', '-e', username]);
    }
  } catch (e) {
    console.error('Samba user setup warning:', e.message);
  }
}

async function createImageBackupShare(device, username) {
  const shareName = device.sambaShare;
  const sharePath = deviceDir(device.id);
  const sambaUser = username || 'homepinas';
  
  // Ensure directory exists with right permissions
  if (!fs.existsSync(sharePath)) fs.mkdirSync(sharePath, { recursive: true });

  // Set ownership so the user can write
  try {
    await execFileAsync('sudo', ['chown', '-R', `${sambaUser}:sambashare`, sharePath]);
    await execFileAsync('sudo', ['chmod', '-R', '775', sharePath]);
  } catch (e) {
    console.error('Permission setup warning:', e.message);
  }

  // Add share to smb.conf with the actual user
  const smbConfPath = '/etc/samba/smb.conf';
  const shareBlock = `\n[${shareName}]\n   path = ${sharePath}\n   browseable = no\n   writable = yes\n   guest ok = no\n   valid users = ${sambaUser}\n   create mask = 0660\n   directory mask = 0770\n   comment = HomePiNAS Image Backup - ${device.name}\n`;

  try {
    const currentConf = fs.readFileSync(smbConfPath, 'utf8');
    if (!currentConf.includes(`[${shareName}]`)) {
      // Use spawn to pipe shareBlock to stdin (execFile doesn't support input option)
      await new Promise((resolve, reject) => {
        const proc = spawn('sudo', ['tee', '-a', smbConfPath], { stdio: ['pipe', 'pipe', 'pipe'] });
        proc.on('error', reject);
        proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`tee exited ${code}`)));
        proc.stdin.write(shareBlock);
        proc.stdin.end();
      });
      await execFileAsync('sudo', ['systemctl', 'reload', 'smbd']);
    }
  } catch(e) {
    console.error('Samba share creation error:', e.message);
    throw e;
  }
}

// ── Helper: generate instructions for image backup ──
function getImageBackupInstructions(device, uncPath, nasHostname) {
  const nasIP = '192.168.1.123'; // TODO: detect dynamically
  const shareName = device.sambaShare;
  
  if (device.os === 'windows') {
    return {
      title: 'Configurar Backup de Imagen en Windows',
      steps: [
        {
          title: '1. Programar backup automático (recomendado)',
          description: 'Abre PowerShell como Administrador y ejecuta:',
          command: `wbadmin start backup -backupTarget:\\\\${nasIP}\\${shareName} -user:homepinas -password:homepinas -allCritical -systemState -vssFull -quiet`,
        },
        {
          title: '2. Programar con Task Scheduler',
          description: 'Para backup automático diario, ejecuta en PowerShell (Admin):',
          command: `$action = New-ScheduledTaskAction -Execute "wbadmin" -Argument "start backup -backupTarget:\\\\${nasIP}\\${shareName} -user:homepinas -password:homepinas -allCritical -systemState -vssFull -quiet"\n$trigger = New-ScheduledTaskTrigger -Daily -At 3am\n$settings = New-ScheduledTaskSettingsSet -RunOnlyIfNetworkAvailable -WakeToRun\nRegister-ScheduledTask -TaskName "HomePiNAS Backup" -Action $action -Trigger $trigger -Settings $settings -User "SYSTEM" -RunLevel Highest`,
        },
        {
          title: '3. Para restaurar',
          description: 'Si necesitas restaurar la imagen completa:',
          command: 'Arranca con USB de instalación de Windows → Reparar → Solucionar problemas → Recuperación de imagen del sistema → Selecciona la imagen de red',
        },
        {
          title: '4. Activar Windows Server Backup (si no está)',
          description: 'Si wbadmin no funciona, actívalo primero:',
          command: 'En Windows 10/11 Pro: dism /online /enable-feature /featurename:WindowsServerBackup\nEn Windows Home: usa el Panel de Control → Copia de seguridad → Crear imagen del sistema → Red',
        },
      ],
    };
  } else {
    // Linux image backup
    return {
      title: 'Configurar Backup de Imagen en Linux',
      steps: [
        {
          title: '1. Backup completo del disco',
          description: 'Ejecuta como root en el equipo:',
          command: `dd if=/dev/sda bs=4M status=progress | gzip | ssh homepinas@${nasIP} "cat > /mnt/storage/active-backup/${device.id}/image-$(date +%Y%m%d).img.gz"`,
        },
        {
          title: '2. Solo partición del sistema',
          description: 'Para copiar solo la partición principal:',
          command: `dd if=/dev/sda1 bs=4M status=progress | gzip | ssh homepinas@${nasIP} "cat > /mnt/storage/active-backup/${device.id}/sda1-$(date +%Y%m%d).img.gz"`,
        },
        {
          title: '3. Con partclone (más eficiente)',
          description: 'Instala partclone y haz backup solo de bloques usados:',
          command: `sudo apt install partclone\nsudo partclone.ext4 -c -s /dev/sda1 | gzip | ssh homepinas@${nasIP} "cat > /mnt/storage/active-backup/${device.id}/sda1-$(date +%Y%m%d).pcl.gz"`,
        },
        {
          title: '4. Restaurar',
          description: 'Para restaurar la imagen:',
          command: `ssh homepinas@${nasIP} "cat /mnt/storage/active-backup/${device.id}/image-FECHA.img.gz" | gunzip | sudo dd of=/dev/sda bs=4M status=progress`,
        },
      ],
    };
  }
}

// ── Helper: list image backup files for a device ──
function getImageFiles(deviceId) {
  const dir = deviceDir(deviceId);
  if (!fs.existsSync(dir)) return [];
  
  return fs.readdirSync(dir)
    .filter(f => {
      const ext = f.toLowerCase();
      return ext.endsWith('.vhd') || ext.endsWith('.vhdx') || ext.endsWith('.img') || 
             ext.endsWith('.img.gz') || ext.endsWith('.pcl.gz') || ext.endsWith('.xml') ||
             f === 'WindowsImageBackup' || f.startsWith('backup-');
    })
    .map(f => {
      const fPath = path.join(dir, f);
      const stat = fs.statSync(fPath);
      return {
        name: f,
        size: stat.isDirectory() ? getDirSize(fPath) : stat.size,
        modified: stat.mtime,
        type: stat.isDirectory() ? 'directory' : 'file',
      };
    })
    .sort((a, b) => new Date(b.modified) - new Date(a.modified));
}

// ══════════════════════════════════════════
// DEVICE MANAGEMENT
// ══════════════════════════════════════════

/**
 * GET /devices - List all registered devices with status
 */
router.get('/devices', (req, res) => {
  const data = getData();
  const ab = data.activeBackup || { devices: [] };
  
  const devices = ab.devices.map(d => {
    const dir = deviceDir(d.id);
    const isImage = d.backupType === 'image';
    
    if (isImage) {
      const images = getImageFiles(d.id);
      return {
        ...d,
        backupCount: images.length,
        totalSize: fs.existsSync(dir) ? getDirSize(dir) : 0,
        images,
      };
    } else {
      const versions = getVersions(d.id);
      return {
        ...d,
        backupCount: versions.length,
        totalSize: fs.existsSync(dir) ? getDirSize(dir) : 0,
        versions: versions.map(v => {
          const vPath = path.join(dir, v);
          const stat = fs.statSync(vPath);
          return { name: v, date: stat.mtime };
        }),
      };
    }
  });

  res.json({ success: true, devices });
});

/**
 * GET /devices/:id/images - List image backup files for a device
 */
router.get('/devices/:id/images', (req, res) => {
  const data = getData();
  if (!data.activeBackup) return res.json({ success: true, images: [] });
  const device = data.activeBackup.devices.find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  
  const images = getImageFiles(device.id);
  const dir = deviceDir(device.id);
  
  // Also list WindowsImageBackup subdirectories
  const wibPath = path.join(dir, 'WindowsImageBackup');
  let windowsBackups = [];
  if (fs.existsSync(wibPath)) {
    try {
      windowsBackups = fs.readdirSync(wibPath, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => {
          const bPath = path.join(wibPath, d.name);
          return {
            name: d.name,
            size: getDirSize(bPath),
            modified: fs.statSync(bPath).mtime,
            type: 'windows-image',
          };
        });
    } catch(e) {}
  }
  
  res.json({ success: true, images, windowsBackups, totalSize: getDirSize(dir) });
});

/**
 * GET /devices/:id/instructions - Get setup instructions for a device
 */
router.get('/devices/:id/instructions', async (req, res) => {
  const data = getData();
  if (!data.activeBackup) return res.status(404).json({ error: 'No devices' });
  const device = data.activeBackup.devices.find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  
  if (device.backupType === 'image') {
    const nasHostname = os.hostname();
    const uncPath = `\\\\${nasHostname}\\${device.sambaShare}`;
    const instructions = getImageBackupInstructions(device, uncPath, nasHostname);
    res.json({ success: true, instructions });
  } else {
    const pubKey = await ensureSSHKey();
    res.json({
      success: true,
      sshPublicKey: pubKey,
      instructions: {
        title: 'Configurar acceso SSH',
        command: `mkdir -p ~/.ssh && echo '${pubKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`,
      },
    });
  }
});

/**
 * POST /devices - Register a new device
 * backupType: "files" (rsync) or "image" (full disk image via SMB)
 */
router.post('/devices', async (req, res) => {
  try {
    const { name, ip, sshUser, sshPort, paths, excludes, schedule, retention, backupType, os: deviceOS, password } = req.body;

    const isImage = backupType === 'image';

    if (!name || !ip) {
      return res.status(400).json({ error: 'name and ip are required' });
    }
    if (!isImage && !sshUser) {
      return res.status(400).json({ error: 'sshUser is required for file backups' });
    }

    let pubKey = null;
    if (!isImage) {
      pubKey = await ensureSSHKey();
    }

    const deviceId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    const device = {
      id: deviceId,
      name: name.trim(),
      ip: ip.trim(),
      backupType: isImage ? 'image' : 'files',
      os: deviceOS || (isImage ? 'windows' : 'linux'),
      // File backup fields
      sshUser: sshUser ? sshUser.trim() : '',
      sshPort: parseInt(sshPort) || 22,
      paths: paths || (isImage ? [] : ['/home']),
      excludes: excludes || ['.cache', '*.tmp', 'node_modules', '.Trash*', '.local/share/Trash'],
      // Common fields
      schedule: schedule || '0 2 * * *',
      retention: parseInt(retention) || 5,
      enabled: true,
      registeredAt: new Date().toISOString(),
      lastBackup: null,
      lastResult: null,
      lastError: null,
      lastDuration: null,
      // Image backup: Samba share name for this device
      sambaShare: isImage ? `backup-${deviceId.slice(0, 8)}` : null,
    };

    const data = getData();
    if (!data.activeBackup) data.activeBackup = { devices: [] };
    data.activeBackup.devices.push(device);
    saveData(data);

    // Create device backup directory
    const dir = deviceDir(deviceId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // For image backups: create a Samba share for this device
    let sambaSetup = null;
    if (isImage) {
      try {
        // Ensure the user has Samba access with their NAS password
        if (password) {
          await ensureSambaUser(req.user.username, password);
        }
        await createImageBackupShare(device, req.user.username);
        const nasHostname = os.hostname();
        const shareName = device.sambaShare;
        const uncPath = `\\\\${device.ip === '127.0.0.1' ? 'localhost' : nasHostname}\\${shareName}`;
        
        sambaSetup = {
          sharePath: uncPath,
          shareUser: req.user.username,
          instructions: getImageBackupInstructions(device, uncPath, nasHostname),
        };
      } catch (sambaErr) {
        console.error('Failed to create Samba share for image backup:', sambaErr.message);
      }
    }

    logSecurityEvent('active_backup_device_added', req.user.username, { device: name, ip, type: device.backupType });

    const response = {
      success: true,
      device,
    };

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
 * PUT /devices/:id - Update device configuration
 */
router.put('/devices/:id', (req, res) => {
  const data = getData();
  if (!data.activeBackup) return res.status(404).json({ error: 'No devices configured' });

  const idx = data.activeBackup.devices.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Device not found' });

  const allowed = ['name', 'ip', 'sshUser', 'sshPort', 'paths', 'excludes', 'schedule', 'retention', 'enabled', 'os'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      data.activeBackup.devices[idx][key] = req.body[key];
    }
  }

  saveData(data);
  res.json({ success: true, device: data.activeBackup.devices[idx] });
});

/**
 * DELETE /devices/:id - Remove device and optionally delete backups
 */
router.delete('/devices/:id', (req, res) => {
  const data = getData();
  if (!data.activeBackup) return res.status(404).json({ error: 'No devices configured' });

  const idx = data.activeBackup.devices.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Device not found' });

  const device = data.activeBackup.devices[idx];
  data.activeBackup.devices.splice(idx, 1);
  saveData(data);

  // Delete backup data if requested
  if (req.query.deleteData === 'true') {
    const dir = deviceDir(req.params.id);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  logSecurityEvent('active_backup_device_removed', req.user.username, { device: device.name });
  res.json({ success: true, message: `Device "${device.name}" removed` });
});

/**
 * GET /ssh-key - Get the NAS public SSH key
 */
router.get('/ssh-key', async (req, res) => {
  try {
    const pubKey = await ensureSSHKey();
    res.json({ success: true, publicKey: pubKey });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate SSH key' });
  }
});

// ══════════════════════════════════════════
// BACKUP OPERATIONS
// ══════════════════════════════════════════

// Track running backups
const runningBackups = new Map();

/**
 * POST /devices/:id/backup - Trigger manual backup
 */
router.post('/devices/:id/backup', async (req, res) => {
  const data = getData();
  if (!data.activeBackup) return res.status(404).json({ error: 'No devices configured' });

  const device = data.activeBackup.devices.find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  if (runningBackups.has(device.id)) {
    return res.status(409).json({ error: 'Backup already in progress for this device' });
  }

  // Start backup in background
  res.json({ success: true, message: `Backup started for "${device.name}"` });
  runBackup(device);
});

/**
 * GET /devices/:id/status - Get backup progress
 */
router.get('/devices/:id/status', (req, res) => {
  const running = runningBackups.get(req.params.id);
  if (running) {
    return res.json({ success: true, status: 'running', startedAt: running.startedAt, output: running.output.slice(-2000) });
  }

  const data = getData();
  if (!data.activeBackup) return res.json({ success: true, status: 'idle' });
  const device = data.activeBackup.devices.find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  res.json({
    success: true,
    status: 'idle',
    lastBackup: device.lastBackup,
    lastResult: device.lastResult,
    lastError: device.lastError,
    lastDuration: device.lastDuration,
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
    // Build rsync command
    const sshCmd = `ssh -i ${SSH_KEY_PATH} -o StrictHostKeyChecking=no -o ConnectTimeout=10 -p ${device.sshPort || 22}`;
    
    for (const srcPath of device.paths) {
      const args = [
        '-az', '--delete', '--stats',
        '-e', sshCmd,
      ];

      // Hardlink to previous version for deduplication
      if (prevDir) {
        args.push('--link-dest=' + prevDir);
      }

      // Add excludes
      for (const exc of (device.excludes || [])) {
        args.push('--exclude=' + exc);
      }

      // Source (remote) → Destination (local)
      const remoteSrc = `${device.sshUser}@${device.ip}:${srcPath}/`;
      // Preserve path structure in backup
      const destSub = path.join(vDir, srcPath);
      if (!fs.existsSync(destSub)) fs.mkdirSync(destSub, { recursive: true });

      args.push(remoteSrc, destSub + '/');

      // Run rsync
      await new Promise((resolve, reject) => {
        const proc = spawn('rsync', args);
        
        proc.stdout.on('data', (chunk) => {
          backupState.output += chunk.toString();
        });
        proc.stderr.on('data', (chunk) => {
          backupState.output += chunk.toString();
        });
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`rsync exited with code ${code}\n${backupState.output.slice(-500)}`));
        });
        proc.on('error', reject);
      });
    }

    // Success — update device status
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

    // Enforce retention
    enforceRetention(device.id, device.retention || 5);

    // Update latest symlink
    const latestLink = path.join(dir, 'latest');
    try { fs.unlinkSync(latestLink); } catch(e) {}
    fs.symlinkSync(`v${vNum}`, latestLink);

    logSecurityEvent('active_backup_success', 'system', { device: device.name, version: vNum, duration });

  } catch (err) {
    console.error(`Backup failed for ${device.name}:`, err.message);

    // Clean up failed version directory
    if (fs.existsSync(vDir)) {
      try { fs.rmSync(vDir, { recursive: true, force: true }); } catch(e) {}
    }

    // Update device status
    const data = getData();
    const dev = data.activeBackup.devices.find(d => d.id === device.id);
    if (dev) {
      dev.lastBackup = new Date().toISOString();
      dev.lastResult = 'failed';
      dev.lastError = err.message.slice(0, 500);
      dev.lastDuration = Math.round((Date.now() - startTime) / 1000);
      saveData(data);
    }

    // Send failure notification
    await notifyBackupFailure(device, err.message.slice(0, 200));

    logSecurityEvent('active_backup_failed', 'system', { device: device.name, error: err.message.slice(0, 200) });
  } finally {
    runningBackups.delete(device.id);
  }
}

// ══════════════════════════════════════════
// BROWSE & RESTORE
// ══════════════════════════════════════════

/**
 * GET /devices/:id/versions - List backup versions
 */
router.get('/devices/:id/versions', (req, res) => {
  const versions = getVersions(req.params.id);
  const dir = deviceDir(req.params.id);

  const result = versions.map(v => {
    const vPath = path.join(dir, v);
    const stat = fs.statSync(vPath);
    return {
      name: v,
      date: stat.mtime,
      size: getDirSize(vPath),
    };
  });

  res.json({ success: true, versions: result });
});

/**
 * GET /devices/:id/browse?version=v1&path=/home/user
 * Browse files inside a specific backup version
 */
router.get('/devices/:id/browse', (req, res) => {
  const version = req.query.version || 'latest';
  const browsePath = req.query.path || '/';

  const safe = (req.params.id).replace(/[^a-zA-Z0-9_-]/g, '');
  const safeVersion = version.replace(/[^a-zA-Z0-9_.-]/g, '');

  let basePath = path.join(BACKUP_BASE, safe, safeVersion);

  // Resolve 'latest' symlink
  if (safeVersion === 'latest') {
    try {
      const target = fs.readlinkSync(basePath);
      basePath = path.join(BACKUP_BASE, safe, target);
    } catch(e) {
      return res.status(404).json({ error: 'No backups available' });
    }
  }

  // Navigate into the requested path
  const cleanPath = browsePath.replace(/\0/g, '').replace(/^\/+/, '');
  const fullPath = path.resolve(basePath, cleanPath);

  // Security: ensure we're still inside the backup dir
  if (!fullPath.startsWith(path.resolve(BACKUP_BASE, safe))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'Path not found' });
  }

  const stat = fs.statSync(fullPath);
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: 'Not a directory' });
  }

  try {
    const items = fs.readdirSync(fullPath, { withFileTypes: true }).map(entry => {
      const entryPath = path.join(fullPath, entry.name);
      let size = 0;
      let modified = null;
      try {
        const s = fs.statSync(entryPath);
        size = s.size;
        modified = s.mtime;
      } catch(e) {}
      return {
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size,
        modified,
      };
    });

    res.json({
      success: true,
      path: browsePath,
      version: safeVersion,
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
 * GET /devices/:id/download?version=v1&path=/home/user/file.txt
 * Download a file from a backup version
 */
router.get('/devices/:id/download', (req, res) => {
  const version = req.query.version || 'latest';
  const filePath = req.query.path || '';

  const safe = (req.params.id).replace(/[^a-zA-Z0-9_-]/g, '');
  const safeVersion = version.replace(/[^a-zA-Z0-9_.-]/g, '');

  let basePath = path.join(BACKUP_BASE, safe, safeVersion);

  if (safeVersion === 'latest') {
    try {
      const target = fs.readlinkSync(basePath);
      basePath = path.join(BACKUP_BASE, safe, target);
    } catch(e) {
      return res.status(404).json({ error: 'No backups available' });
    }
  }

  const cleanPath = filePath.replace(/\0/g, '').replace(/^\/+/, '');
  const fullPath = path.resolve(basePath, cleanPath);

  if (!fullPath.startsWith(path.resolve(BACKUP_BASE, safe))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.download(fullPath);
});

/**
 * POST /devices/:id/restore - Restore files back to source device
 * Body: { version, sourcePath, destPath? }
 */
router.post('/devices/:id/restore', async (req, res) => {
  const data = getData();
  if (!data.activeBackup) return res.status(404).json({ error: 'No devices' });
  const device = data.activeBackup.devices.find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const { version, sourcePath, destPath } = req.body;
  if (!version || !sourcePath) {
    return res.status(400).json({ error: 'version and sourcePath required' });
  }

  const safe = device.id.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeVersion = version.replace(/[^a-zA-Z0-9_.-]/g, '');
  let basePath = path.join(BACKUP_BASE, safe, safeVersion);

  if (safeVersion === 'latest') {
    try {
      const target = fs.readlinkSync(basePath);
      basePath = path.join(BACKUP_BASE, safe, target);
    } catch(e) {
      return res.status(404).json({ error: 'No backups available' });
    }
  }

  const cleanPath = sourcePath.replace(/\0/g, '').replace(/^\/+/, '');
  const localPath = path.resolve(basePath, cleanPath);

  if (!localPath.startsWith(path.resolve(BACKUP_BASE, safe))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(localPath)) {
    return res.status(404).json({ error: 'Source path not found in backup' });
  }

  const remoteDest = destPath || '/' + cleanPath;
  const sshCmd = `ssh -i ${SSH_KEY_PATH} -o StrictHostKeyChecking=no -o ConnectTimeout=10 -p ${device.sshPort || 22}`;

  try {
    const isDir = fs.statSync(localPath).isDirectory();
    const args = [
      '-az', '--progress',
      '-e', sshCmd,
      isDir ? localPath + '/' : localPath,
      `${device.sshUser}@${device.ip}:${remoteDest}${isDir ? '/' : ''}`,
    ];

    const { stdout, stderr } = await execFileAsync('rsync', args, { timeout: 300000 });

    logSecurityEvent('active_backup_restore', req.user.username, {
      device: device.name,
      version,
      path: sourcePath,
    });

    res.json({ success: true, message: `Restored to ${device.ip}:${remoteDest}`, output: stdout });
  } catch (err) {
    res.status(500).json({ error: `Restore failed: ${err.message}` });
  }
});

// ══════════════════════════════════════════
// SCHEDULER — runs scheduled backups via setInterval
// ══════════════════════════════════════════

function parseCronHourMinute(cronExpr) {
  // Simple cron parser for "M H * * *" format
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const minute = parseInt(parts[0]);
  const hour = parseInt(parts[1]);
  if (isNaN(minute) || isNaN(hour)) return null;
  return { hour, minute };
}

// Check every minute if a scheduled backup needs to run
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
}, 60000); // Check every 60 seconds

// ══════════════════════════════════════════
// RECOVERY USB
// ══════════════════════════════════════════

/**
 * GET /recovery/status - Check if recovery ISO exists
 */
router.get('/recovery/status', (req, res) => {
  const isoDir = path.join(__dirname, '..', '..', 'recovery-usb');
  const isoPath = path.join(isoDir, 'homepinas-recovery.iso');
  const scriptsExist = fs.existsSync(path.join(isoDir, 'build-recovery-iso.sh'));

  let isoInfo = null;
  if (fs.existsSync(isoPath)) {
    const stat = fs.statSync(isoPath);
    isoInfo = {
      exists: true,
      size: stat.size,
      modified: stat.mtime,
    };
  }

  res.json({
    success: true,
    scriptsAvailable: scriptsExist,
    iso: isoInfo,
  });
});

/**
 * POST /recovery/build - Build recovery ISO (long operation)
 */
router.post('/recovery/build', async (req, res) => {
  const isoDir = path.join(__dirname, '..', '..', 'recovery-usb');
  const buildScript = path.join(isoDir, 'build-recovery-iso.sh');

  if (!fs.existsSync(buildScript)) {
    return res.status(404).json({ error: 'Build script not found' });
  }

  res.json({ success: true, message: 'ISO build started. This will take several minutes.' });

  // Run build in background
  const proc = spawn('sudo', ['bash', buildScript], {
    cwd: isoDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  proc.stdout.on('data', (chunk) => { output += chunk.toString(); });
  proc.stderr.on('data', (chunk) => { output += chunk.toString(); });

  proc.on('close', (code) => {
    if (code === 0) {
      logSecurityEvent('recovery_iso_built', 'system', { success: true });
      console.log('[Active Backup] Recovery ISO built successfully');
    } else {
      logSecurityEvent('recovery_iso_build_failed', 'system', { code, output: output.slice(-500) });
      console.error('[Active Backup] Recovery ISO build failed:', output.slice(-500));
    }
  });
});

/**
 * GET /recovery/download - Download recovery ISO
 */
router.get('/recovery/download', (req, res) => {
  const isoPath = path.join(__dirname, '..', '..', 'recovery-usb', 'homepinas-recovery.iso');

  if (!fs.existsSync(isoPath)) {
    return res.status(404).json({ error: 'Recovery ISO not found. Build it first.' });
  }

  res.download(isoPath, 'homepinas-recovery.iso');
});

/**
 * GET /recovery/scripts - Download recovery scripts as tar.gz (for manual USB creation)
 */
router.get('/recovery/scripts', (req, res) => {
  const scriptsDir = path.join(__dirname, '..', '..', 'recovery-usb');

  if (!fs.existsSync(scriptsDir)) {
    return res.status(404).json({ error: 'Recovery scripts not found' });
  }

  const archiveName = 'homepinas-recovery-scripts.tar.gz';
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);

  const tar = spawn('tar', ['-czf', '-', '-C', path.dirname(scriptsDir), 'recovery-usb'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  tar.stdout.pipe(res);
});

// ══════════════════════════════════════════
// AGENT MANAGEMENT (admin endpoints)
// ══════════════════════════════════════════

/**
 * GET /pending - List pending agents waiting for approval
 */
router.get('/pending', (req, res) => {
  const data = getData();
  const pending = (data.activeBackup && data.activeBackup.pendingAgents) || [];
  res.json({ success: true, pending });
});

/**
 * POST /pending/:id/approve - Approve a pending agent
 * Body: { backupType, schedule, retention, paths }
 */
router.post('/pending/:id/approve', async (req, res) => {
  try {
    const { backupType, schedule, retention, paths } = req.body;
    const data = getData();
    if (!data.activeBackup || !data.activeBackup.pendingAgents) {
      return res.status(404).json({ error: 'No pending agents' });
    }

    const idx = data.activeBackup.pendingAgents.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Pending agent not found' });

    const agent = data.activeBackup.pendingAgents[idx];
    const isImage = backupType === 'image';
    const deviceId = agent.id;

    // Generate Samba credentials for image backup
    const sambaPass = crypto.randomBytes(16).toString('hex');

    const device = {
      id: deviceId,
      name: agent.hostname,
      ip: agent.ip,
      agentHostname: agent.hostname,
      agentMac: agent.mac,
      agentToken: agent.agentToken,
      backupType: isImage ? 'image' : 'files',
      os: agent.os === 'win32' ? 'windows' : (agent.os === 'darwin' ? 'macos' : agent.os),
      sshUser: '',
      sshPort: 22,
      paths: paths || (isImage ? [] : []),
      excludes: ['.cache', '*.tmp', 'node_modules', '.Trash*', '.local/share/Trash'],
      schedule: schedule || '0 3 * * *',
      retention: parseInt(retention) || 3,
      enabled: true,
      status: 'approved',
      registeredAt: agent.registeredAt,
      approvedAt: new Date().toISOString(),
      approvedBy: req.user.username,
      lastBackup: null,
      lastResult: null,
      lastError: null,
      lastDuration: null,
      sambaShare: isImage ? `backup-${deviceId.slice(0, 8)}` : null,
      sambaUser: null,
      sambaPass: null,
    };

    // For image backups: setup Samba
    if (isImage) {
      const sambaUser = `backup-${deviceId.slice(0, 8)}`;
      device.sambaUser = sambaUser;
      device.sambaPass = sambaPass;

      // Create system user for this device
      try { await execFileAsync('sudo', ['useradd', '-r', '-s', '/usr/sbin/nologin', sambaUser]); } catch(e) {}
      // Add to sambashare group
      try { await execFileAsync('sudo', ['usermod', '-aG', 'sambashare', sambaUser]); } catch(e) {}
      // Set Samba password
      await new Promise((resolve, reject) => {
        const proc = spawn('sudo', ['smbpasswd', '-a', sambaUser, '-s'], { stdio: ['pipe', 'pipe', 'pipe'] });
        proc.on('error', reject);
        proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`smbpasswd exited ${code}`)));
        proc.stdin.write(`${sambaPass}\n${sambaPass}\n`);
        proc.stdin.end();
      });
      await execFileAsync('sudo', ['smbpasswd', '-e', sambaUser]);

      // Create share
      await createImageBackupShare(device, sambaUser);
    }

    // Remove from pending, add to devices
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
 * POST /pending/:id/reject - Reject a pending agent
 */
router.post('/pending/:id/reject', (req, res) => {
  const data = getData();
  if (!data.activeBackup || !data.activeBackup.pendingAgents) {
    return res.status(404).json({ error: 'No pending agents' });
  }

  const idx = data.activeBackup.pendingAgents.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Pending agent not found' });

  const agent = data.activeBackup.pendingAgents[idx];
  data.activeBackup.pendingAgents.splice(idx, 1);
  saveData(data);

  logSecurityEvent('active_backup_agent_rejected', req.user.username, { hostname: agent.hostname });
  res.json({ success: true, message: `Agent "${agent.hostname}" rejected` });
});

/**
 * POST /devices/:id/trigger - Trigger an immediate backup on an agent
 */
router.post('/devices/:id/trigger', (req, res) => {
  const data = getData();
  if (!data.activeBackup) return res.status(404).json({ error: 'Not configured' });

  const device = data.activeBackup.devices.find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  if (!device.agentToken) {
    return res.status(400).json({ error: 'Device is not agent-managed' });
  }

  device._triggerBackup = true;
  saveData(data);

  res.json({ success: true, message: `Backup triggered for "${device.name}". Agent will start on next poll.` });
});

module.exports = router;
