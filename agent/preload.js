const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  discoverNAS: () => ipcRenderer.invoke('discover-nas'),
  connectNAS: (opts) => ipcRenderer.invoke('connect-nas', opts),
  runBackup: () => ipcRenderer.invoke('run-backup'),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  resizeToFit: () => ipcRenderer.invoke('resize-to-fit'),
  onStatusUpdate: (cb) => ipcRenderer.on('status-update', (_, data) => cb(data)),
});
