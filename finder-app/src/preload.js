const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('finder', {
  scanNetwork: () => ipcRenderer.invoke('scan-network'),
  openNAS: (url) => ipcRenderer.invoke('open-nas', url)
});
