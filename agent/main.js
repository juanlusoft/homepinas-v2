/**
 * HomePiNAS Backup Agent - Electron Main Process
 * Instalar → auto-descubre NAS → se anuncia → espera aprobación → backups automáticos
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { NASDiscovery } = require('./src/discovery');
const { BackupManager } = require('./src/backup');
const { NASApi } = require('./src/api');

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

const store = new Store({
  defaults: {
    nasAddress: '',
    nasPort: 3001,
    agentId: '',
    agentToken: '',
    status: 'disconnected', // disconnected | pending | approved
    deviceName: '',
    backupType: 'image',
    backupPaths: [],
    schedule: '0 3 * * *',
    retention: 3,
    sambaShare: '',
    sambaUser: '',
    sambaPass: '',
    autoStart: true,
    lastBackup: null,
    lastResult: null,
  }
});

let tray = null;
let mainWindow = null;
let discovery = null;
let backupManager = null;
let api = null;
let pollInterval = null;

// ── Create main window ──
function createWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 600,
    height: 450,
    resizable: false,
    maximizable: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── System tray ──
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch (e) {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('HomePiNAS Backup');
  updateTrayMenu();
  tray.on('double-click', () => createWindow());
}

function updateTrayMenu(backupRunning = false) {
  const status = store.get('status');
  const nasAddr = store.get('nasAddress');
  const lastResult = store.get('lastResult');
  const lastBackup = store.get('lastBackup');

  let statusText = '⚪ Sin conexión al NAS';
  if (status === 'pending') statusText = '🟡 Esperando aprobación del NAS';
  else if (status === 'approved' && backupRunning) statusText = '⏳ Backup en progreso...';
  else if (status === 'approved' && lastResult === 'success') statusText = `✅ Último: ${formatDate(lastBackup)}`;
  else if (status === 'approved' && lastResult === 'error') statusText = '❌ Último backup falló';
  else if (status === 'approved') statusText = '🟢 Conectado — esperando horario';

  const contextMenu = Menu.buildFromTemplate([
    { label: 'HomePiNAS Backup', enabled: false },
    { type: 'separator' },
    { label: statusText, enabled: false },
    { type: 'separator' },
    { label: 'Hacer backup ahora', click: () => runBackupNow(), enabled: status === 'approved' && !backupRunning },
    { label: 'Abrir configuración', click: () => createWindow() },
    { label: 'Abrir dashboard NAS', click: () => { if (nasAddr) shell.openExternal(`https://${nasAddr}:${store.get('nasPort')}`); }, enabled: !!nasAddr },
    { type: 'separator' },
    { label: 'Iniciar con Windows', type: 'checkbox', checked: store.get('autoStart'), click: (item) => { store.set('autoStart', item.checked); app.setLoginItemSettings({ openAtLogin: item.checked }); } },
    { type: 'separator' },
    { label: 'Desconectar del NAS', click: () => disconnect(), enabled: !!nasAddr },
    { label: 'Salir', click: () => { app.isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(contextMenu);
}

function formatDate(isoStr) {
  if (!isoStr) return 'nunca';
  const d = new Date(isoStr);
  return d.toLocaleDateString('es-ES') + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

// ── NAS Polling ──
function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  
  // Poll every 60 seconds
  pollInterval = setInterval(() => pollNAS(), 60000);
  // First poll immediately
  pollNAS();
}

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

async function pollNAS() {
  const nasAddr = store.get('nasAddress');
  const agentToken = store.get('agentToken');
  if (!nasAddr || !agentToken) return;

  try {
    const result = await api.agentPoll(nasAddr, store.get('nasPort'), agentToken);

    if (result.status === 'pending') {
      if (store.get('status') !== 'pending') {
        store.set('status', 'pending');
        updateTrayMenu();
        sendToRenderer('status-update', { status: 'pending' });
      }
    } else if (result.status === 'approved') {
      const wasNotApproved = store.get('status') !== 'approved';
      store.set('status', 'approved');

      // Save config from NAS
      if (result.config) {
        store.set('deviceName', result.config.deviceName || '');
        store.set('backupType', result.config.backupType || 'image');
        store.set('schedule', result.config.schedule || '0 3 * * *');
        store.set('retention', result.config.retention || 3);
        if (result.config.paths) store.set('backupPaths', result.config.paths);
        if (result.config.sambaShare) store.set('sambaShare', result.config.sambaShare);
        if (result.config.sambaUser) store.set('sambaUser', result.config.sambaUser);
        if (result.config.sambaPass) store.set('sambaPass', result.config.sambaPass);
        if (result.config.nasAddress) store.set('nasAddress', result.config.nasAddress);
      }

      if (wasNotApproved) {
        notify('✅ Dispositivo aprobado', 'Tu PC ha sido aprobada para backup en el NAS');
      }

      // Check if NAS triggered a manual backup
      if (result.action === 'backup') {
        runBackupNow();
      }

      // Check schedule
      checkSchedule();

      updateTrayMenu();
      sendToRenderer('status-update', { status: 'approved', config: result.config });
    }
  } catch (err) {
    // Silent fail — will retry on next poll
  }
}

// ── Schedule check ──
function checkSchedule() {
  const schedule = store.get('schedule');
  if (!schedule || store.get('status') !== 'approved') return;

  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5) return;

  const minute = parseInt(parts[0]);
  const hour = parseInt(parts[1]);
  const now = new Date();

  if (now.getHours() === hour && now.getMinutes() === minute && !backupManager.running) {
    runBackupNow();
  }
}

// ── Backup execution ──
async function runBackupNow() {
  if (backupManager.running) return;

  updateTrayMenu(true);
  notify('Backup iniciado', 'Creando copia de seguridad...');

  const startTime = Date.now();
  try {
    await backupManager.runBackup({
      nasAddress: store.get('nasAddress'),
      nasPort: store.get('nasPort'),
      backupType: store.get('backupType'),
      backupPaths: store.get('backupPaths'),
      sambaShare: store.get('sambaShare'),
      sambaUser: store.get('sambaUser'),
      sambaPass: store.get('sambaPass'),
    });

    const duration = Math.round((Date.now() - startTime) / 1000);
    store.set('lastBackup', new Date().toISOString());
    store.set('lastResult', 'success');
    notify('✅ Backup completado', 'Copia de seguridad guardada en el NAS');

    // Report to NAS
    try { await api.agentReport(store.get('nasAddress'), store.get('nasPort'), store.get('agentToken'), { status: 'success', duration }); } catch(e) {}

  } catch (err) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    store.set('lastResult', 'error');
    notify('❌ Backup fallido', err.message);

    try { await api.agentReport(store.get('nasAddress'), store.get('nasPort'), store.get('agentToken'), { status: 'error', duration, error: err.message }); } catch(e) {}
  }

  updateTrayMenu();
  sendToRenderer('status-update', { lastBackup: store.get('lastBackup'), lastResult: store.get('lastResult') });
}

function notify(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png') }).show();
  }
}

function sendToRenderer(channel, data) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, data);
  }
}

function disconnect() {
  stopPolling();
  store.set('nasAddress', '');
  store.set('agentId', '');
  store.set('agentToken', '');
  store.set('status', 'disconnected');
  store.set('sambaShare', '');
  store.set('sambaUser', '');
  store.set('sambaPass', '');
  updateTrayMenu();
  sendToRenderer('status-update', { status: 'disconnected' });
}

// ── IPC Handlers ──
function setupIPC() {
  ipcMain.handle('get-status', () => ({
    status: store.get('status'),
    nasAddress: store.get('nasAddress'),
    deviceName: store.get('deviceName'),
    backupType: store.get('backupType'),
    schedule: store.get('schedule'),
    retention: store.get('retention'),
    lastBackup: store.get('lastBackup'),
    lastResult: store.get('lastResult'),
    autoStart: store.get('autoStart'),
    platform: process.platform,
  }));

  // Discover and register with NAS
  ipcMain.handle('connect-nas', async (_, { address, port }) => {
    try {
      // Test connection
      await api.testConnection(address, port || 3001);

      // Register agent
      const os = require('os');
      const nets = os.networkInterfaces();
      let mac = '';
      for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
          if (net.family === 'IPv4' && !net.internal && net.mac !== '00:00:00:00:00:00') {
            mac = net.mac;
            break;
          }
        }
        if (mac) break;
      }

      const result = await api.agentRegister(address, port || 3001, {
        hostname: os.hostname(),
        ip: getLocalIP(),
        os: process.platform,
        mac,
      });

      store.set('nasAddress', address);
      store.set('nasPort', port || 3001);
      store.set('agentId', result.agentId);
      store.set('agentToken', result.agentToken);
      store.set('status', result.status);

      startPolling();

      return { success: true, status: result.status };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('discover-nas', async () => {
    try {
      const results = await discovery.discover();
      return { success: true, results };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('run-backup', async () => {
    await runBackupNow();
    return { success: true };
  });

  ipcMain.handle('disconnect', () => {
    disconnect();
    return { success: true };
  });
}

function getLocalIP() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '0.0.0.0';
}

// ── App lifecycle ──
app.on('ready', () => {
  discovery = new NASDiscovery();
  backupManager = new BackupManager();
  api = new NASApi();

  setupIPC();
  createTray();

  app.setLoginItemSettings({ openAtLogin: store.get('autoStart') });

  // If already registered, start polling
  if (store.get('agentToken')) {
    startPolling();
  }

  // Show window on first run
  if (!store.get('nasAddress')) {
    createWindow();
  }
});

app.on('second-instance', () => createWindow());
app.on('window-all-closed', (e) => { e?.preventDefault?.(); });
app.on('before-quit', () => { app.isQuitting = true; });
app.on('activate', () => createWindow());
