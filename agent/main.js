/**
 * HomePiNAS Backup Agent - Electron Main Process
 * System tray app that manages automatic backups to HomePiNAS NAS
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { NASDiscovery } = require('./src/discovery');
const { BackupManager } = require('./src/backup');
const { Scheduler } = require('./src/scheduler');
const { NASApi } = require('./src/api');

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

const store = new Store({
  defaults: {
    nasAddress: '',
    nasPort: 3001,
    username: '',
    sessionId: '',
    deviceId: '',
    deviceName: '',
    backupType: 'image', // 'image' or 'files'
    backupPaths: [],
    schedule: '0 3 * * *', // Daily at 3 AM
    retention: 3,
    autoStart: true,
    language: 'es',
    lastBackup: null,
    lastResult: null,
  }
});

let tray = null;
let mainWindow = null;
let discovery = null;
let backupManager = null;
let scheduler = null;
let api = null;

// ── Create main window ──
function createWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 700,
    height: 550,
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

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── System tray ──
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    icon = icon.resize({ width: 16, height: 16 });
  } catch (e) {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('HomePiNAS Backup');
  updateTrayMenu();

  tray.on('double-click', () => {
    createWindow();
  });
}

function updateTrayMenu(status = null) {
  const nasAddr = store.get('nasAddress');
  const lastBackup = store.get('lastBackup');
  const lastResult = store.get('lastResult');

  let statusText = 'Sin configurar';
  if (nasAddr) {
    if (status === 'running') {
      statusText = '⏳ Backup en progreso...';
    } else if (lastResult === 'success') {
      statusText = `✅ Último: ${formatDate(lastBackup)}`;
    } else if (lastResult === 'error') {
      statusText = '❌ Último backup falló';
    } else {
      statusText = `Conectado a ${nasAddr}`;
    }
  }

  const contextMenu = Menu.buildFromTemplate([
    { label: 'HomePiNAS Backup', enabled: false, icon: null },
    { type: 'separator' },
    { label: statusText, enabled: false },
    { type: 'separator' },
    {
      label: 'Hacer backup ahora',
      click: () => runBackupNow(),
      enabled: !!nasAddr && status !== 'running',
    },
    {
      label: 'Abrir configuración',
      click: () => createWindow(),
    },
    {
      label: 'Abrir dashboard NAS',
      click: () => {
        if (nasAddr) shell.openExternal(`https://${nasAddr}:${store.get('nasPort')}`);
      },
      enabled: !!nasAddr,
    },
    { type: 'separator' },
    {
      label: 'Iniciar con Windows',
      type: 'checkbox',
      checked: store.get('autoStart'),
      click: (item) => {
        store.set('autoStart', item.checked);
        app.setLoginItemSettings({ openAtLogin: item.checked });
      }
    },
    { type: 'separator' },
    { label: 'Salir', click: () => { app.isQuitting = true; app.quit(); } }
  ]);

  tray.setContextMenu(contextMenu);
}

function formatDate(isoStr) {
  if (!isoStr) return 'nunca';
  const d = new Date(isoStr);
  return d.toLocaleDateString('es-ES') + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

// ── Backup execution ──
async function runBackupNow() {
  const nasAddr = store.get('nasAddress');
  const nasPort = store.get('nasPort');
  if (!nasAddr) {
    notify('Error', 'No hay NAS configurado');
    return;
  }

  updateTrayMenu('running');
  notify('Backup iniciado', 'Creando copia de seguridad...');

  try {
    const result = await backupManager.runBackup({
      nasAddress: nasAddr,
      nasPort,
      username: store.get('username'),
      sessionId: store.get('sessionId'),
      deviceId: store.get('deviceId'),
      backupType: store.get('backupType'),
      backupPaths: store.get('backupPaths'),
    });

    store.set('lastBackup', new Date().toISOString());
    store.set('lastResult', 'success');
    updateTrayMenu();
    notify('✅ Backup completado', `Copia de seguridad guardada en el NAS`);

    // Report to NAS
    try {
      await api.reportBackupResult(store.get('deviceId'), 'success', result);
    } catch (e) {}

  } catch (err) {
    store.set('lastResult', 'error');
    updateTrayMenu();
    notify('❌ Backup fallido', err.message);

    try {
      await api.reportBackupResult(store.get('deviceId'), 'error', { error: err.message });
    } catch (e) {}
  }
}

function notify(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png') }).show();
  }
}

// ── IPC Handlers ──
function setupIPC() {
  // Get current config
  ipcMain.handle('get-config', () => {
    return {
      nasAddress: store.get('nasAddress'),
      nasPort: store.get('nasPort'),
      username: store.get('username'),
      deviceId: store.get('deviceId'),
      deviceName: store.get('deviceName'),
      backupType: store.get('backupType'),
      backupPaths: store.get('backupPaths'),
      schedule: store.get('schedule'),
      retention: store.get('retention'),
      lastBackup: store.get('lastBackup'),
      lastResult: store.get('lastResult'),
      autoStart: store.get('autoStart'),
      platform: process.platform,
    };
  });

  // Discover NAS
  ipcMain.handle('discover-nas', async () => {
    try {
      const results = await discovery.discover();
      return { success: true, results };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Test connection
  ipcMain.handle('test-connection', async (_, { address, port }) => {
    try {
      const info = await api.testConnection(address, port);
      return { success: true, info };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Login to NAS
  ipcMain.handle('login', async (_, { address, port, username, password }) => {
    try {
      const session = await api.login(address, port, username, password);
      store.set('nasAddress', address);
      store.set('nasPort', port);
      store.set('username', username);
      store.set('sessionId', session.sessionId);
      return { success: true, session };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Register device on NAS
  ipcMain.handle('register-device', async (_, { name, backupType, paths }) => {
    try {
      const os = require('os');
      const deviceInfo = {
        name: name || os.hostname(),
        ip: getLocalIP(),
        os: process.platform === 'win32' ? 'windows' : 'macos',
        type: backupType,
        paths: paths || [],
        agent: true,
      };

      const result = await api.registerDevice(
        store.get('nasAddress'),
        store.get('nasPort'),
        store.get('sessionId'),
        deviceInfo
      );

      store.set('deviceId', result.id);
      store.set('deviceName', name || os.hostname());
      store.set('backupType', backupType);
      if (paths) store.set('backupPaths', paths);

      return { success: true, device: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Save settings
  ipcMain.handle('save-settings', (_, settings) => {
    if (settings.schedule) store.set('schedule', settings.schedule);
    if (settings.retention) store.set('retention', settings.retention);
    if (settings.backupType) store.set('backupType', settings.backupType);
    if (settings.backupPaths) store.set('backupPaths', settings.backupPaths);
    if (settings.autoStart !== undefined) {
      store.set('autoStart', settings.autoStart);
      app.setLoginItemSettings({ openAtLogin: settings.autoStart });
    }

    // Restart scheduler with new settings
    scheduler.restart(store.get('schedule'));
    updateTrayMenu();

    return { success: true };
  });

  // Run backup now
  ipcMain.handle('run-backup', async () => {
    await runBackupNow();
    return { success: true };
  });

  // Get disks (for file backup path selection)
  ipcMain.handle('get-drives', () => {
    return backupManager.getDrives();
  });

  // Disconnect
  ipcMain.handle('disconnect', () => {
    store.set('nasAddress', '');
    store.set('sessionId', '');
    store.set('deviceId', '');
    scheduler.stop();
    updateTrayMenu();
    return { success: true };
  });
}

function getLocalIP() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '0.0.0.0';
}

// ── App lifecycle ──
app.on('ready', () => {
  discovery = new NASDiscovery();
  backupManager = new BackupManager();
  api = new NASApi();
  scheduler = new Scheduler(() => runBackupNow());

  setupIPC();
  createTray();

  // Auto-start scheduler if configured
  const nasAddr = store.get('nasAddress');
  if (nasAddr) {
    scheduler.start(store.get('schedule'));
  }

  // Set login item
  app.setLoginItemSettings({ openAtLogin: store.get('autoStart') });

  // Show window on first run (no NAS configured)
  if (!nasAddr) {
    createWindow();
  }
});

app.on('window-all-closed', (e) => {
  // Don't quit, stay in tray
  e.preventDefault?.();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('activate', () => {
  createWindow();
});
