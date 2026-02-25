/**
 * Active Backup — Shared helpers
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const { getData, saveData } = require('../../utils/data');

const execFileAsync = promisify(execFile);

const BACKUP_BASE = '/mnt/storage/active-backup';
const SSH_KEY_PATH = path.join(os.homedir(), '.ssh', 'homepinas_backup_rsa');

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_BASE)) {
  try { fs.mkdirSync(BACKUP_BASE, { recursive: true }); } catch(e) {}
}

// ── SSH key ──
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

// ── Device backup dir ──
function deviceDir(deviceId) {
  const safe = deviceId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(BACKUP_BASE, safe);
}

// ── Version management ──
function getVersions(deviceId) {
  const dir = deviceDir(deviceId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(d => d.startsWith('v') && fs.statSync(path.join(dir, d)).isDirectory())
    .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
}

function nextVersion(deviceId) {
  const versions = getVersions(deviceId);
  if (versions.length === 0) return 1;
  return parseInt(versions[versions.length - 1].slice(1)) + 1;
}

function enforceRetention(deviceId, retention) {
  const versions = getVersions(deviceId);
  const toDelete = versions.slice(0, Math.max(0, versions.length - retention));
  for (const v of toDelete) {
    fs.rmSync(path.join(deviceDir(deviceId), v), { recursive: true, force: true });
  }
  const remaining = getVersions(deviceId);
  const latestLink = path.join(deviceDir(deviceId), 'latest');
  try { fs.unlinkSync(latestLink); } catch(e) {}
  if (remaining.length > 0) {
    fs.symlinkSync(remaining[remaining.length - 1], latestLink);
  }
}

// ── Directory size ──
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

// ── Local IPs ──
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

// ── Notifications ──
async function notifyBackupFailure(device, error) {
  const data = getData();
  const notifConfig = data.notifications || {};
  const message = `⚠️ Active Backup FAILED\n\nDevice: ${device.name} (${device.ip})\nTime: ${new Date().toLocaleString('es-ES')}\nError: ${error}`;

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

// ── Samba helpers ──
async function ensureSambaUser(username, password) {
  try {
    const { stdout } = await execFileAsync('sudo', ['pdbedit', '-L']);
    if (!stdout.includes(`${username}:`)) {
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

  if (!fs.existsSync(sharePath)) fs.mkdirSync(sharePath, { recursive: true });

  try {
    await execFileAsync('sudo', ['chown', '-R', `${sambaUser}:sambashare`, sharePath]);
    await execFileAsync('sudo', ['chmod', '-R', '775', sharePath]);
  } catch (e) {
    console.error('Permission setup warning:', e.message);
  }

  const smbConfPath = '/etc/samba/smb.conf';
  const shareBlock = `\n[${shareName}]\n   path = ${sharePath}\n   browseable = no\n   writable = yes\n   guest ok = no\n   valid users = ${sambaUser}\n   create mask = 0660\n   directory mask = 0770\n   comment = HomePiNAS Image Backup - ${device.name}\n`;

  try {
    const currentConf = fs.readFileSync(smbConfPath, 'utf8');
    if (!currentConf.includes(`[${shareName}]`)) {
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

// ── Image backup instructions ──
function getImageBackupInstructions(device) {
  const nasIP = '192.168.1.123';
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
  }

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

// ── Image files listing ──
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

// ── Cron parser (simple "M H * * *") ──
function parseCronHourMinute(cronExpr) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const minute = parseInt(parts[0]);
  const hour = parseInt(parts[1]);
  if (isNaN(minute) || isNaN(hour)) return null;
  return { hour, minute };
}

module.exports = {
  BACKUP_BASE,
  SSH_KEY_PATH,
  execFileAsync,
  ensureSSHKey,
  deviceDir,
  getVersions,
  nextVersion,
  enforceRetention,
  getDirSize,
  getLocalIPs,
  notifyBackupFailure,
  ensureSambaUser,
  createImageBackupShare,
  getImageBackupInstructions,
  getImageFiles,
  parseCronHourMinute,
};
