const path = require('path');
const os = require('os');
const fs = require('fs');
const { app, BrowserWindow, ipcMain } = require('electron');
const { fork } = require('child_process');
const QRCode = require('qrcode');

let mainWindow;
let serverProcess = null;

const state = {
  serverRunning: false,
  serverSupported: process.platform === 'win32',
  platform: process.platform,
  allowHttpFallback: process.env.ALLOW_HTTP_FALLBACK === '1',
  tlsReady: hasTlsCertificates(),
  localIp: getLocalIP(),
  port: parseInt(process.env.PORT || '7200', 10),
  pairCode: generatePairCode(),
  activeControllers: 0,
  controllers: []
};

function getTransportProtocol() {
  if (state.tlsReady) return 'https';
  if (state.allowHttpFallback) return 'http';
  return 'https';
}

function getJoinUrl() {
  return `${getTransportProtocol()}://${state.localIp}:${state.port}`;
}

function getPairJoinUrl() {
  const url = new URL(getJoinUrl());
  url.searchParams.set('pair', state.pairCode);
  return url.toString();
}

function getPublicState() {
  return {
    ...state,
    transport: getTransportProtocol(),
    joinUrl: getJoinUrl(),
    pairJoinUrl: getPairJoinUrl()
  };
}

function hasTlsCertificates() {
  const sslDir = path.join(__dirname, '..', 'ssl');
  const keyPath = path.join(sslDir, 'key.pem');
  const certPath = path.join(sslDir, 'cert.pem');
  return fs.existsSync(keyPath) && fs.existsSync(certPath);
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }

  return '127.0.0.1';
}

function generatePairCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function sendToRenderer(channel, payload) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 700,
    title: 'AirController',
    backgroundColor: '#eaf1fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function startServer() {
  if (!state.serverSupported) {
    sendToRenderer('server:error', `Backend server is Windows-only (current platform: ${state.platform}).`);
    sendToRenderer('server:log', '[aircontroller] Start blocked: ViGEm backend requires Windows.');
    return getPublicState();
  }

  if (!state.tlsReady && !state.allowHttpFallback) {
    sendToRenderer('server:error', 'TLS certificates are missing. Add ssl/key.pem and ssl/cert.pem or enable ALLOW_HTTP_FALLBACK=1 for development only.');
    sendToRenderer('server:log', '[aircontroller] Start blocked: secure transport required but certificates are missing.');
    return getPublicState();
  }

  if (serverProcess) {
    return getPublicState();
  }

  state.activeControllers = 0;
  state.controllers = [];
  sendToRenderer('controllers:update', {
    activeControllers: state.activeControllers,
    controllers: state.controllers
  });

  const serverEntry = path.join(__dirname, '..', 'start.js');
  const serverCwd = path.join(__dirname, '..');

  serverProcess = fork(serverEntry, [], {
    cwd: serverCwd,
    execPath: process.execPath,
    silent: true,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      ALLOW_HTTP: !state.tlsReady && state.allowHttpFallback ? '1' : '0',
      PAIR_CODE: String(state.pairCode),
      PORT: String(state.port)
    }
  });

  state.serverRunning = true;
  sendToRenderer('server:state', getPublicState());
  sendToRenderer('server:log', `[aircontroller] Starting server at ${getJoinUrl()}`);

  if (serverProcess.stdout) {
    serverProcess.stdout.on('data', (data) => {
      sendToRenderer('server:log', data.toString().trim());
    });
  }

  if (serverProcess.stderr) {
    serverProcess.stderr.on('data', (data) => {
      sendToRenderer('server:error', data.toString().trim());
    });
  }

  serverProcess.on('message', (payload) => {
    if (!payload || payload.type !== 'telemetry') return;
    state.activeControllers = Number(payload.activeControllers || 0);
    state.controllers = Array.isArray(payload.controllers) ? payload.controllers : [];
    sendToRenderer('controllers:update', {
      activeControllers: state.activeControllers,
      controllers: state.controllers
    });
    sendToRenderer('server:state', getPublicState());
  });

  serverProcess.on('error', (err) => {
    sendToRenderer('server:error', err.message);
  });

  serverProcess.on('close', (code) => {
    sendToRenderer('server:log', `[aircontroller] Server exited (code: ${code ?? 'unknown'})`);
    serverProcess = null;
    state.serverRunning = false;
    state.activeControllers = 0;
    state.controllers = [];
    sendToRenderer('controllers:update', {
      activeControllers: state.activeControllers,
      controllers: state.controllers
    });
    sendToRenderer('server:state', getPublicState());
  });

  return getPublicState();
}

function stopServer() {
  if (!serverProcess) {
    state.serverRunning = false;
    return getPublicState();
  }

  sendToRenderer('server:log', '[aircontroller] Stopping server...');
  const proc = serverProcess;
  proc.kill('SIGTERM');

  setTimeout(() => {
    if (serverProcess) {
      sendToRenderer('server:log', '[aircontroller] Force stopping server...');
      serverProcess.kill('SIGKILL');
    }
  }, 1800);

  return getPublicState();
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle('server:get-state', () => getPublicState());
  ipcMain.handle('server:start', () => startServer());
  ipcMain.handle('server:stop', () => stopServer());
  ipcMain.handle('qr:to-data-url', async (_, content) => {
    const text = String(content || getPairJoinUrl());
    try {
      const dataUrl = await QRCode.toDataURL(text, {
        errorCorrectionLevel: 'H',
        margin: 4,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

      return { ok: true, dataUrl };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle('pair:refresh', () => {
    state.pairCode = generatePairCode();
    sendToRenderer('server:state', getPublicState());
    return getPublicState();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
