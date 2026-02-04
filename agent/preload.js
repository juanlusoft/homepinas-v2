const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getStatus: () => ipcRenderer.invoke('get-status'),
  discoverNAS: () => ipcRenderer.invoke('discover-nas'),
  connectNAS: (opts) => ipcRenderer.invoke('connect-nas', opts),
  runBackup: () => ipcRenderer.invoke('run-backup'),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  onStatusUpdate: (cb) => ipcRenderer.on('status-update', (_, data) => cb(data)),
});
