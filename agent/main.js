/**
 * HomePiNAS Backup Agent - Electron Main Process
 * Instalar → auto-descubre NAS → se anuncia → espera aprobación → backups automáticos
 */

// Accept self-signed certificates (NAS uses self-signed HTTPS on local network)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

// File logger — writes to %LOCALAPPDATA%\HomePiNAS\agent.log
const logDir = path.join(process.env.LOCALAPPDATA || process.env.HOME || '.', 'HomePiNAS');
try { fs.mkdirSync(logDir, { recursive: true }); } catch(e) {}
const logFile = path.join(logDir, 'agent.log');
const _origLog = console.log;
const _origErr = console.error;
const _origWarn = console.warn;
function fileLog(level, ...args) {
  const line = `${new Date().toISOString()} [${level}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}\n`;
  try { fs.appendFileSync(logFile, line); } catch(e) {}
}
console.log = (...args) => { _origLog(...args); fileLog('INFO', ...args); };
console.error = (...args) => { _origErr(...args); fileLog('ERROR', ...args); };
console.warn = (...args) => { _origWarn(...args); fileLog('WARN', ...args); };
const { NASDiscovery } = require('./src/discovery');
const { BackupManager } = require('./src/backup');
const { NASApi } = require('./src/api');
const { Scheduler } = require('./src/scheduler');

// ── CLI Mode ──
// Usage: HomePiNAS Backup.exe --backup  (run backup and exit)
//        HomePiNAS Backup.exe --status  (show status and exit)
const cliArgs = process.argv.slice(1);
const CLI_MODE = cliArgs.includes('--backup') || cliArgs.includes('--status');

// Single instance lock (skip for CLI status queries)
if (!cliArgs.includes('--status')) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    if (CLI_MODE) {
      console.log('Another instance is already running');
      process.exit(1);
    }
    app.quit();
  }
} else {
  // For --status, don't need single instance lock
}

const store = new Store({
  encryptionKey: 'homepinas-agent-store-v2',
  defaults: {
    nasAddress: '',
    nasPort: 443,
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
let scheduler = null;

// ── Create main window ──
function createWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 500,
    height: 400,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    // Auto-resize to fit content
    mainWindow.webContents.executeJavaScript(`
      new Promise(r => setTimeout(() => {
        const body = document.body;
        r({ width: Math.ceil(body.scrollWidth), height: Math.ceil(body.scrollHeight) });
      }, 100))
    `).then(size => {
      if (size && size.height > 0) {
        mainWindow.setContentSize(Math.max(500, size.width), Math.min(600, size.height + 10));
      }
    }).catch(() => {});
    mainWindow.show();
  });

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
    { label: 'Abrir dashboard NAS', click: () => {
      if (nasAddr) {
        const url = `https://${nasAddr}:${store.get('nasPort')}`;
        try {
          const parsed = new URL(url);
          if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
            shell.openExternal(url);
          }
        } catch (e) { console.error('Invalid NAS URL:', e.message); }
      }
    }, enabled: !!nasAddr },
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
    const result = await api.agentPoll(nasAddr, store.get('nasPort'), agentToken, {
      version: app.getVersion(),
      hostname: require('os').hostname(),
    });

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

      // Update scheduler with current schedule (skip if NAS just triggered a backup)
      if (result.action !== 'backup' && result.config && result.config.schedule) {
        scheduler.start(result.config.schedule);
      }

      updateTrayMenu();
      sendToRenderer('status-update', { status: 'approved', config: result.config });
    }
  } catch (err) {
    console.error('[Poll] Error:', err.message);
  }
}

// ── Backup execution ──
async function runBackupNow() {
  if (backupManager.running) return;

  store.set('lastResult', 'running');
  store.set('lastError', '');
  updateTrayMenu(true);
  sendToRenderer('status-update', { lastResult: 'running' });
  notify('Backup iniciado', 'Creando copia de seguridad...');
  sendToRenderer('backup-progress', { phase: 'starting', percent: 0, detail: 'Iniciando backup...' });

  // Poll progress from BackupManager every 2 seconds
  const progressInterval = setInterval(() => {
    const p = backupManager.progress;
    if (p) {
      sendToRenderer('backup-progress', p);
      tray.setToolTip(`HomePiNAS Backup — ${p.phase} ${p.percent}%`);
    }
  }, 2000);

  const startTime = Date.now();
  const config = {
    nasAddress: store.get('nasAddress'),
    nasPort: store.get('nasPort'),
    backupType: store.get('backupType'),
    backupPaths: store.get('backupPaths'),
    sambaShare: store.get('sambaShare'),
    sambaUser: store.get('sambaUser'),
    sambaPass: store.get('sambaPass'),
  };
  console.log('[Backup] Config:', JSON.stringify({ ...config, sambaPass: config.sambaPass ? '***' : '(empty)' }));
  try {
    await backupManager.runBackup(config);

    const duration = Math.round((Date.now() - startTime) / 1000);
    store.set('lastBackup', new Date().toISOString());
    store.set('lastResult', 'success');
    notify('✅ Backup completado', 'Copia de seguridad guardada en el NAS');

    // Report to NAS (include log)
    try {
      await api.agentReport(store.get('nasAddress'), store.get('nasPort'), store.get('agentToken'), { status: 'success', duration, log: backupManager.logContent });
      console.log('[Backup] Report sent to NAS: success');
    } catch(e) {
      console.error('[Backup] Failed to report success to NAS:', e.message);
    }

  } catch (err) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    store.set('lastResult', 'error');
    store.set('lastError', err.message.substring(0, 2000));
    console.error('[Backup] Error:', err.message);
    notify('❌ Backup fallido', err.message.substring(0, 200));

    // Read full agent.log for better diagnostics
    let fullLog = '';
    try { fullLog = fs.readFileSync(path.join(logDir, 'agent.log'), 'utf-8').slice(-50000); } catch(e) {}
    const log = err.backupLog || backupManager.logContent || fullLog;
    try {
      await api.agentReport(store.get('nasAddress'), store.get('nasPort'), store.get('agentToken'), {
        status: 'error', duration,
        error: err.message.substring(0, 2000),
        log: log.slice(-50000),
        agentVersion: app.getVersion(),
        hostname: require('os').hostname(),
      });
      console.log('[Backup] Error report sent to NAS (with full logs)');
    } catch(e) {
      console.error('[Backup] Failed to report error to NAS:', e.message);
    }
  }

  clearInterval(progressInterval);
  sendToRenderer('backup-progress', null);
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
  ipcMain.handle('get-version', () => app.getVersion());

  ipcMain.handle('resize-to-fit', async () => {
    if (!mainWindow) return;
    try {
      const size = await mainWindow.webContents.executeJavaScript(`
        ({ width: Math.ceil(document.body.scrollWidth), height: Math.ceil(document.body.scrollHeight) })
      `);
      if (size && size.height > 0) {
        mainWindow.setContentSize(Math.max(500, size.width), Math.min(700, size.height + 10));
      }
    } catch(e) {}
  });

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
  ipcMain.handle('connect-nas', async (_, { address, port, username, password }) => {
    try {
      const parsedPort = port || 443;
      if (parsedPort < 1 || parsedPort > 65535) {
        return { success: false, error: 'Puerto inválido (debe ser entre 1 y 65535)' };
      }

      // Authenticate with NAS dashboard credentials
      await api.authenticate(address, parsedPort, username, password);

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

      const result = await api.agentRegister(address, parsedPort, {
        hostname: os.hostname(),
        ip: getLocalIP(),
        os: process.platform,
        mac,
      });

      store.set('nasAddress', address);
      store.set('nasPort', parsedPort);
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
    try {
      await runBackupNow();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('disconnect', () => {
    disconnect();
    return { success: true };
  });

  ipcMain.handle('open-log-file', () => {
    const logPath = path.join(logDir, 'agent.log');
    if (fs.existsSync(logPath)) shell.openPath(logPath);
    else shell.openPath(logDir);
  });

  ipcMain.handle('open-log-folder', () => {
    shell.openPath(logDir);
  });

  ipcMain.handle('get-last-error', () => {
    return store.get('lastError') || null;
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
app.on('ready', async () => {
  discovery = new NASDiscovery();
  backupManager = new BackupManager();
  api = new NASApi();
  scheduler = new Scheduler(() => runBackupNow());

  // ── CLI: --status ──
  if (cliArgs.includes('--status')) {
    const status = {
      version: app.getVersion(),
      nasAddress: store.get('nasAddress') || 'not configured',
      nasPort: store.get('nasPort'),
      status: store.get('status'),
      lastBackup: store.get('lastBackup') || 'never',
      lastResult: store.get('lastResult') || 'none',
      lastError: store.get('lastError') || null,
      backupType: store.get('backupType'),
      schedule: store.get('schedule'),
      deviceName: store.get('deviceName') || require('os').hostname(),
    };
    console.log(JSON.stringify(status, null, 2));
    app.quit();
    return;
  }

  // ── CLI: --backup ──
  if (cliArgs.includes('--backup')) {
    if (!store.get('agentToken')) {
      console.error('Agent not registered with NAS. Run the GUI first to set up.');
      app.exit(1);
      return;
    }
    console.log('Starting backup in CLI mode...');
    try {
      await runBackupNow();
      console.log('Backup completed successfully');
      app.exit(0);
    } catch (err) {
      console.error('Backup failed:', err.message);
      app.exit(1);
    }
    return;
  }

  // ── Normal GUI mode ──
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
app.on('window-all-closed', () => { /* Keep running in tray */ });
app.on('before-quit', () => { app.isQuitting = true; });
app.on('activate', () => createWindow());
