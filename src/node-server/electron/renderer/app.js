const els = {
  ipChip: document.getElementById('ipChip'),
  joinUrl: document.getElementById('joinUrl'),
  pairCode: document.getElementById('pairCode'),
  refreshCodeBtn: document.getElementById('refreshCodeBtn'),
  statusPill: document.getElementById('statusPill'),
  serverToggleBtn: document.getElementById('serverToggleBtn'),
  copyUrlBtn: document.getElementById('copyUrlBtn'),
  serverUrl: document.getElementById('serverUrl'),
  serverStateText: document.getElementById('serverStateText'),
  clearLogsBtn: document.getElementById('clearLogsBtn'),
  logPanel: document.getElementById('logPanel'),
  qrCanvas: document.getElementById('qrCanvas'),
  controllerCount: document.getElementById('controllerCount'),
  controllersList: document.getElementById('controllersList')
};

let appState = {
  serverRunning: false,
  localIp: '127.0.0.1',
  port: 7200,
  joinUrl: 'https://127.0.0.1:7200',
  pairJoinUrl: 'https://127.0.0.1:7200?pair=000000',
  pairCode: '------',
  activeControllers: 0,
  controllers: []
};

function renderControllers() {
  const controllers = Array.isArray(appState.controllers) ? appState.controllers : [];
  const active = Number(appState.activeControllers || 0);

  els.controllerCount.textContent = `${active} active`;

  if (controllers.length === 0) {
    els.controllersList.innerHTML = '<div class="controller-empty">Waiting for players...</div>';
    return;
  }

  const rows = controllers
    .map((controller) => {
      const slot = controller.slot ? `P${controller.slot}` : 'P?';
      const status = String(controller.status || 'connected');
      const statusClass = status === 'active' ? 'active' : (status === 'paired' ? 'paired' : '');
      const label = controller.userAgent || 'Unknown Device';
      const addr = controller.address || 'unknown';

      return `
        <div class="controller-row">
          <div class="controller-slot">${slot}</div>
          <div class="controller-main">
            <div class="controller-title">${label}</div>
            <div class="controller-sub">${addr}</div>
          </div>
          <span class="controller-status ${statusClass}">${status.toUpperCase()}</span>
        </div>
      `;
    })
    .join('');

  els.controllersList.innerHTML = rows;
}

function addLog(line) {
  if (!line) return;
  const timestamp = new Date().toLocaleTimeString();
  els.logPanel.textContent += `\n[${timestamp}] ${line}`;
  els.logPanel.scrollTop = els.logPanel.scrollHeight;
}

function applyState(state) {
  if (!state) return;

  appState = {
    ...appState,
    ...state
  };

  els.ipChip.textContent = appState.localIp;
  els.joinUrl.textContent = appState.joinUrl;
  els.serverUrl.textContent = appState.joinUrl;
  els.serverStateText.textContent = appState.serverRunning ? 'running' : 'stopped';

  if (appState.serverSupported === false) {
    els.statusPill.textContent = 'Unsupported';
    els.statusPill.classList.remove('running');
    els.statusPill.classList.add('error');
    els.serverToggleBtn.textContent = 'Windows Only';
    els.serverToggleBtn.classList.remove('stop');
    els.serverToggleBtn.disabled = true;
    els.serverStateText.textContent = `unsupported on ${appState.platform}`;
    els.joinUrl.textContent = 'N/A on this OS';
    els.serverUrl.textContent = 'N/A on this OS';
    return;
  }

  els.serverToggleBtn.disabled = false;

  if (appState.serverRunning) {
    els.statusPill.textContent = 'Running';
    els.statusPill.classList.add('running');
    els.statusPill.classList.remove('error');
    els.serverToggleBtn.textContent = 'Stop Server';
    els.serverToggleBtn.classList.add('stop');
  } else {
    els.statusPill.textContent = 'Stopped';
    els.statusPill.classList.remove('running', 'error');
    els.serverToggleBtn.textContent = 'Start Server';
    els.serverToggleBtn.classList.remove('stop');
  }

  if (appState.pairCode) {
    els.pairCode.textContent = appState.pairCode;
    drawQrCode(appState.pairJoinUrl || appState.joinUrl || appState.pairCode);
  }

  renderControllers();
}

async function drawQrCode(content) {
  const fallbackContent = content || appState.pairJoinUrl || appState.joinUrl || 'https://127.0.0.1:7200';

  const qrResult = await window.airController.generateQrDataUrl(fallbackContent);
  const ctx = els.qrCanvas.getContext('2d');
  ctx.clearRect(0, 0, els.qrCanvas.width, els.qrCanvas.height);

  if (!qrResult || !qrResult.ok || !qrResult.dataUrl) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, els.qrCanvas.width, els.qrCanvas.height);
    ctx.fillStyle = '#111';
    ctx.font = '14px sans-serif';
    ctx.fillText('QR render failed', 44, els.qrCanvas.height / 2);
    addLog(`[error] QR render failed: ${qrResult && qrResult.error ? qrResult.error : 'Unknown error'}`);
    return;
  }

  const image = new Image();
  image.onload = () => {
    ctx.drawImage(image, 0, 0, els.qrCanvas.width, els.qrCanvas.height);
  };
  image.onerror = () => {
    addLog('[error] Failed to load generated QR image.');
  };
  image.src = qrResult.dataUrl;
}

async function refreshPairCode() {
  const data = await window.airController.pairRefresh();
  applyState(data);
  addLog('Pair code refreshed.');
}

async function toggleServer() {
  if (appState.serverSupported === false) {
    addLog('Server is unavailable on this platform. Use Windows host for ViGEm backend.');
    return;
  }

  if (appState.serverRunning) {
    await window.airController.stopServer();
  } else {
    await window.airController.startServer();
  }
}

async function init() {
  const initial = await window.airController.getState();
  applyState(initial);

  window.airController.onServerState((state) => {
    applyState(state);
  });

  window.airController.onControllersUpdate((payload) => {
    appState.activeControllers = Number(payload && payload.activeControllers ? payload.activeControllers : 0);
    appState.controllers = Array.isArray(payload && payload.controllers) ? payload.controllers : [];
    renderControllers();
  });

  window.airController.onServerLog((line) => {
    addLog(line);
  });

  window.airController.onServerError((line) => {
    els.statusPill.classList.add('error');
    addLog(`[error] ${line}`);
  });

  els.serverToggleBtn.addEventListener('click', toggleServer);
  els.refreshCodeBtn.addEventListener('click', refreshPairCode);
  els.copyUrlBtn.addEventListener('click', async () => {
    const urlToCopy = appState.pairJoinUrl || appState.joinUrl;
    await navigator.clipboard.writeText(urlToCopy);
    addLog(`Copied URL: ${urlToCopy}`);
  });
  els.clearLogsBtn.addEventListener('click', () => {
    els.logPanel.textContent = '[aircontroller] Logs cleared.';
  });

  drawQrCode(appState.pairJoinUrl || appState.joinUrl || appState.pairCode);
}

init();
