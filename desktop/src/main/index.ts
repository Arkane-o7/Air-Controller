import { join } from 'node:path'

import { app, BrowserWindow, ipcMain } from 'electron'

import { HostServer } from './hostServer'
import type { HostState, LayoutType } from '../shared/protocol'

const host = new HostServer()

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 980,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'AirController Host'
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function pushState(state: HostState): void {
  mainWindow?.webContents.send('host:state', state)
}

function registerIpc(): void {
  ipcMain.handle('host:get-state', () => host.getState())
  ipcMain.handle('host:regenerate-code', async () => {
    await host.regeneratePairingCode()
    return host.getState()
  })
  ipcMain.handle('host:set-layout', (_event, layout: LayoutType) => {
    host.setLayout(layout)
    return host.getState()
  })
}

app.whenReady().then(async () => {
  registerIpc()
  host.on('state', pushState)
  await host.start()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async (event) => {
  event.preventDefault()
  await host.stop()
  app.exit(0)
})
