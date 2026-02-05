const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { scanNetwork } = require('./scanner');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 600,
    minWidth: 400,
    minHeight: 500,
    resizable: true,
    frame: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../assets/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  
  // Quitar menú en producción
  if (!process.argv.includes('--dev')) {
    mainWindow.setMenu(null);
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handlers
ipcMain.handle('scan-network', async () => {
  return await scanNetwork();
});

ipcMain.handle('open-nas', (event, url) => {
  shell.openExternal(url);
});
