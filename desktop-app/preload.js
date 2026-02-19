const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("airDesktop", {
  getState: () => ipcRenderer.invoke("desktop:get-state"),
  openHostWindow: () => ipcRenderer.invoke("desktop:open-host-window"),
  openUrl: (url) => ipcRenderer.invoke("desktop:open-url", url),
  runDependencySetup: (options) => ipcRenderer.invoke("bridge:setup-all", options || {}),
  installVirtualBridge: () => ipcRenderer.invoke("bridge:install-virtual"),
  checkVirtualBridge: (options) => ipcRenderer.invoke("bridge:check-virtual", options || {}),
  startBridge: (options) => ipcRenderer.invoke("bridge:start", options),
  stopBridge: (options) => ipcRenderer.invoke("bridge:stop", options || {}),
  onBridgeEvent: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("bridge:event", wrapped);

    return () => {
      ipcRenderer.removeListener("bridge:event", wrapped);
    };
  },
});
