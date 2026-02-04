const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  discoverNAS: () => ipcRenderer.invoke('discover-nas'),
  testConnection: (data) => ipcRenderer.invoke('test-connection', data),
  login: (data) => ipcRenderer.invoke('login', data),
  registerDevice: (data) => ipcRenderer.invoke('register-device', data),
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
  runBackup: () => ipcRenderer.invoke('run-backup'),
  getDrives: () => ipcRenderer.invoke('get-drives'),
  disconnect: () => ipcRenderer.invoke('disconnect'),
});
