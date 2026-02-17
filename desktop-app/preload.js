const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("airDesktop", {
  getState: () => ipcRenderer.invoke("desktop:get-state"),
  openHostWindow: () => ipcRenderer.invoke("desktop:open-host-window"),
  openUrl: (url) => ipcRenderer.invoke("desktop:open-url", url),
  installVirtualBridge: () => ipcRenderer.invoke("bridge:install-virtual"),
  startBridge: (options) => ipcRenderer.invoke("bridge:start", options),
  stopBridge: () => ipcRenderer.invoke("bridge:stop"),
  onBridgeEvent: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("bridge:event", wrapped);

    return () => {
      ipcRenderer.removeListener("bridge:event", wrapped);
    };
  },
});
