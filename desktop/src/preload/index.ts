import { contextBridge, ipcRenderer } from 'electron'

import type { AirControllerBridgeApi, HostState, LayoutType } from '../shared/protocol'

const api: AirControllerBridgeApi = {
  getState: (): Promise<HostState> => ipcRenderer.invoke('host:get-state'),
  regenerateCode: (): Promise<HostState> => ipcRenderer.invoke('host:regenerate-code'),
  setLayout: (layout: LayoutType): Promise<HostState> => ipcRenderer.invoke('host:set-layout', layout),
  onState: (listener: (state: HostState) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: HostState) => listener(state)
    ipcRenderer.on('host:state', wrapped)
    return () => ipcRenderer.removeListener('host:state', wrapped)
  }
}

contextBridge.exposeInMainWorld('aircontroller', api)
