const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('airController', {
  getState: () => ipcRenderer.invoke('server:get-state'),
  startServer: () => ipcRenderer.invoke('server:start'),
  stopServer: () => ipcRenderer.invoke('server:stop'),
  generateQrDataUrl: (content) => ipcRenderer.invoke('qr:to-data-url', content),
  pairRefresh: () => ipcRenderer.invoke('pair:refresh'),
  onServerState: (handler) => ipcRenderer.on('server:state', (_, payload) => handler(payload)),
  onControllersUpdate: (handler) => ipcRenderer.on('controllers:update', (_, payload) => handler(payload)),
  onServerLog: (handler) => ipcRenderer.on('server:log', (_, payload) => handler(payload)),
  onServerError: (handler) => ipcRenderer.on('server:error', (_, payload) => handler(payload))
});
