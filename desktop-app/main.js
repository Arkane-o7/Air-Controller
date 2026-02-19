const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { io: createSocketClient } = require("socket.io-client");
const { createAirServer } = require("./src/server/appServer");

const SOURCE_ROOT = path.join(__dirname, "src");
const SOURCE_BRIDGE_DIR = path.join(SOURCE_ROOT, "bridge");
const SOURCE_SERVER_DIR = path.join(SOURCE_ROOT, "server");
const SOURCE_CONFIG_DIR = path.join(SOURCE_ROOT, "config");
const SOURCE_PUBLIC_DIR = path.join(SOURCE_SERVER_DIR, "public");
const VIGEM_RELEASE_URL = "https://github.com/nefarius/ViGEmBus/releases/latest";

let mainWindow = null;
let hostWindow = null;
let serverHandle = null;
let runtimeDir = "";
let runtimeBridgeDir = "";
let runtimeConfigPath = "";
let bridgeIdCounter = 1;
const bridgeInstances = new Map();
let bridgeLogBuffer = [];
let installVirtualBridgeInFlight = null;
let dependencySetupInFlight = null;
let shuttingDown = false;
let networkState = {
  port: 0,
  localOrigin: "",
  localHostUrl: "",
  localControllerUrl: "",
  lanControllerUrls: [],
};
let virtualBridgeCheckInFlight = null;
let desktopHostSocket = null;
let desktopHostSocketInFlight = null;
let sessionCreateInFlight = null;
let sessionConfigUpdateInFlight = null;

function buildInitialVirtualBridgeCheckState() {
  if (process.platform === "darwin") {
    return {
      platform: process.platform,
      status: "unsupported",
      checkedAt: 0,
      message: "Virtual gamepad bridge is not supported on macOS. Use keyboard bridge or dry-run.",
      requirementsReady: false,
      devices: { xbox: false, ds4: false },
    };
  }

  if (process.platform === "win32" || process.platform === "linux") {
    return {
      platform: process.platform,
      status: "unknown",
      checkedAt: 0,
      message: "Virtual bridge not verified yet.",
      requirementsReady: false,
      devices: { xbox: false, ds4: false },
    };
  }

  return {
    platform: process.platform,
    status: "not_required",
    checkedAt: 0,
    message: "Virtual bridge preflight is not required on this platform.",
    requirementsReady: true,
    devices: { xbox: true, ds4: true },
  };
}

let virtualBridgeCheckState = buildInitialVirtualBridgeCheckState();
let dependencySetupState = {
  status: "idle",
  startedAt: 0,
  finishedAt: 0,
  auto: false,
  requiresRestart: false,
  message: "Setup not started.",
  lastError: "",
};

function buildInitialDesktopSessionState() {
  return {
    status: "idle",
    hostConnected: false,
    code: "",
    config: null,
    controllerCount: 0,
    bridgeCount: 0,
    joinUrl: "",
    joinUrls: [],
    lastError: "",
    updatedAt: 0,
  };
}

let desktopSessionState = buildInitialDesktopSessionState();

function normalizeSessionCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

function buildJoinUrl(baseControllerUrl, code) {
  const normalizedCode = normalizeSessionCode(code);
  if (!normalizedCode || !baseControllerUrl) {
    return "";
  }

  const separator = baseControllerUrl.includes("?") ? "&" : "?";
  return `${baseControllerUrl}${separator}code=${encodeURIComponent(normalizedCode)}`;
}

function buildSessionJoinUrls(code) {
  const normalizedCode = normalizeSessionCode(code);
  if (!normalizedCode) {
    return [];
  }

  const joinUrls = [];
  const pushUnique = (url) => {
    if (!url || joinUrls.includes(url)) {
      return;
    }
    joinUrls.push(url);
  };

  networkState.lanControllerUrls.forEach((lanUrl) => {
    pushUnique(buildJoinUrl(lanUrl, normalizedCode));
  });

  pushUnique(buildJoinUrl(networkState.localControllerUrl, normalizedCode));
  return joinUrls;
}

function setDesktopSessionState(nextState = {}) {
  const merged = {
    ...desktopSessionState,
    ...nextState,
  };

  const code = normalizeSessionCode(merged.code);
  const joinUrls = buildSessionJoinUrls(code);

  desktopSessionState = {
    ...merged,
    code,
    joinUrls,
    joinUrl: joinUrls[0] || "",
    updatedAt: Date.now(),
  };
}

function emitDesktopEvent(event) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("desktop:event", event);
  }
}

function emitSessionStateEvent(reason) {
  emitDesktopEvent({
    type: "session",
    reason: reason || "",
    session: desktopSessionState,
    at: Date.now(),
  });
}

function emitSocketAck(socket, eventName, payload = {}, timeoutMs = 10000) {
  return new Promise((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ ok: false, error: "ACK_TIMEOUT" });
    }, timeoutMs);

    try {
      socket.emit(eventName, payload, (response = {}) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(response);
      });
    } catch (error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: error.message || "EMIT_FAILED" });
    }
  });
}

async function connectDesktopHostSocket() {
  if (desktopHostSocket && desktopHostSocket.connected) {
    return desktopHostSocket;
  }

  if (desktopHostSocket) {
    if (!desktopHostSocketInFlight) {
      desktopHostSocketInFlight = new Promise((resolve, reject) => {
        let settled = false;

        const finishResolve = () => {
          if (settled) {
            return;
          }
          settled = true;
          resolve(desktopHostSocket);
        };

        const finishReject = (error) => {
          if (settled) {
            return;
          }
          settled = true;
          reject(error);
        };

        const timeout = setTimeout(() => {
          finishReject(new Error("Timed out reconnecting session host channel."));
        }, 10000);

        desktopHostSocket.once("connect", () => {
          clearTimeout(timeout);
          finishResolve();
        });

        desktopHostSocket.once("connect_error", (error) => {
          clearTimeout(timeout);
          finishReject(error || new Error("Failed reconnecting session host channel."));
        });

        try {
          desktopHostSocket.connect();
        } catch (error) {
          clearTimeout(timeout);
          finishReject(error);
        }
      }).finally(() => {
        desktopHostSocketInFlight = null;
      });
    }

    return desktopHostSocketInFlight;
  }

  if (desktopHostSocketInFlight) {
    return desktopHostSocketInFlight;
  }

  setDesktopSessionState({
    status: "connecting",
    hostConnected: false,
    lastError: "",
  });
  emitSessionStateEvent("connecting");

  desktopHostSocketInFlight = new Promise((resolve, reject) => {
    const socket = createSocketClient(networkState.localOrigin, {
      transports: ["websocket", "polling"],
      reconnection: true,
      timeout: 8000,
    });

    let settled = false;

    const resolveOnce = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(socket);
    };

    const rejectOnce = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    socket.on("connect", () => {
      desktopHostSocket = socket;
      setDesktopSessionState({
        hostConnected: true,
        status: desktopSessionState.code ? desktopSessionState.status : "connecting",
        lastError: "",
      });
      appendBridgeLog("status", "session: host channel connected");
      emitSessionStateEvent("connected");
      resolveOnce();

      ensureDesktopSession({ forceNew: false, reason: "socket-connected" }).catch((error) => {
        appendBridgeLog("error", `session: ${error.message || "failed to recover session"}`);
      });
    });

    socket.on("connect_error", (error) => {
      const message = error?.message || "Unable to connect session host channel.";
      setDesktopSessionState({
        status: "error",
        hostConnected: false,
        code: "",
        config: null,
        controllerCount: 0,
        bridgeCount: 0,
        lastError: message,
      });
      emitSessionStateEvent("connect_error");
      appendBridgeLog("error", `session: ${message}`);
      rejectOnce(new Error(message));
    });

    socket.on("disconnect", (reason) => {
      setDesktopSessionState({
        status: "connecting",
        hostConnected: false,
        code: "",
        config: null,
        controllerCount: 0,
        bridgeCount: 0,
        lastError: `Disconnected (${reason || "unknown"})`,
      });
      emitSessionStateEvent("disconnected");
      appendBridgeLog("status", `session: host channel disconnected (${reason || "unknown"})`);
    });

    socket.on("session:controller-connected", (info = {}) => {
      const nextCount = Number.isFinite(Number(info.count))
        ? Number(info.count)
        : desktopSessionState.controllerCount + 1;
      setDesktopSessionState({ controllerCount: Math.max(0, nextCount) });
      emitSessionStateEvent("controller_connected");
      appendBridgeLog("status", `session: controller connected P${info.playerIndex || "?"}`);
    });

    socket.on("session:controller-disconnected", (info = {}) => {
      const nextCount = Number.isFinite(Number(info.count))
        ? Number(info.count)
        : Math.max(0, desktopSessionState.controllerCount - 1);
      setDesktopSessionState({ controllerCount: Math.max(0, nextCount) });
      emitSessionStateEvent("controller_disconnected");
      appendBridgeLog("status", `session: controller disconnected P${info.playerIndex || "?"}`);
    });

    socket.on("session:bridge-connected", (info = {}) => {
      const nextCount = Number.isFinite(Number(info.count))
        ? Number(info.count)
        : desktopSessionState.bridgeCount + 1;
      setDesktopSessionState({ bridgeCount: Math.max(0, nextCount) });
      emitSessionStateEvent("bridge_connected");
      appendBridgeLog("status", `session: bridge connected P${info.playerIndex || "?"}`);
    });

    socket.on("session:bridge-disconnected", (info = {}) => {
      const nextCount = Number.isFinite(Number(info.count))
        ? Number(info.count)
        : Math.max(0, desktopSessionState.bridgeCount - 1);
      setDesktopSessionState({ bridgeCount: Math.max(0, nextCount) });
      emitSessionStateEvent("bridge_disconnected");
      appendBridgeLog("status", `session: bridge disconnected P${info.playerIndex || "?"}`);
    });

    socket.on("session:config-updated", (payload = {}) => {
      const normalizedCode = normalizeSessionCode(payload.code || desktopSessionState.code);
      setDesktopSessionState({
        status: normalizedCode ? "ready" : desktopSessionState.status,
        code: normalizedCode,
        config: payload.config || desktopSessionState.config || null,
      });
      emitSessionStateEvent("config_updated");
    });

    socket.on("session:closed", (payload = {}) => {
      const reason = payload.reason || "closed";
      appendBridgeLog("status", `session: closed (${reason})`);
      setDesktopSessionState({
        status: "connecting",
        code: "",
        config: null,
        controllerCount: 0,
        bridgeCount: 0,
        lastError: "",
      });
      emitSessionStateEvent("closed");

      ensureDesktopSession({ forceNew: true, reason: "session_closed" }).catch((error) => {
        appendBridgeLog("error", `session: failed to recreate after close (${error.message})`);
      });
    });
  }).finally(() => {
    desktopHostSocketInFlight = null;
  });

  return desktopHostSocketInFlight;
}

async function ensureDesktopSession(options = {}) {
  const forceNew = Boolean(options.forceNew);
  const reason = String(options.reason || (forceNew ? "manual" : "auto"));

  if (!forceNew && desktopSessionState.code.length === 6 && desktopSessionState.status === "ready") {
    return { ok: true, session: desktopSessionState };
  }

  if (sessionCreateInFlight) {
    const inFlightResult = await sessionCreateInFlight;
    if (!forceNew) {
      return inFlightResult;
    }
  }

  await connectDesktopHostSocket();

  if (!desktopHostSocket || !desktopHostSocket.connected) {
    const message = "Session host channel is offline.";
    setDesktopSessionState({
      status: "error",
      lastError: message,
    });
    emitSessionStateEvent("offline");
    return { ok: false, error: message, session: desktopSessionState };
  }

  if (sessionCreateInFlight && !forceNew) {
    return sessionCreateInFlight;
  }

  const createPromise = (async () => {
    setDesktopSessionState({
      status: "creating",
      lastError: "",
      controllerCount: forceNew ? 0 : desktopSessionState.controllerCount,
      bridgeCount: forceNew ? 0 : desktopSessionState.bridgeCount,
    });
    emitSessionStateEvent("creating");

    const response = await emitSocketAck(
      desktopHostSocket,
      "host:create-session",
      { config: options.config || desktopSessionState.config || {} },
      10000
    );

    if (!response?.ok) {
      const message = response?.error || "SESSION_CREATE_FAILED";
      setDesktopSessionState({
        status: "error",
        code: "",
        config: null,
        controllerCount: 0,
        bridgeCount: 0,
        lastError: message,
      });
      emitSessionStateEvent("create_failed");
      appendBridgeLog("error", `session: create failed (${message})`);
      return { ok: false, error: message, session: desktopSessionState };
    }

    setDesktopSessionState({
      status: "ready",
      code: response.code || "",
      config: response.config || desktopSessionState.config || null,
      controllerCount: 0,
      bridgeCount: 0,
      lastError: "",
    });
    emitSessionStateEvent("ready");
    appendBridgeLog("status", `session: ready ${desktopSessionState.code} (${reason})`);
    return { ok: true, session: desktopSessionState };
  })();

  sessionCreateInFlight = createPromise;
  try {
    return await createPromise;
  } finally {
    if (sessionCreateInFlight === createPromise) {
      sessionCreateInFlight = null;
    }
  }
}

async function updateDesktopSessionConfig(config = {}) {
  if (sessionConfigUpdateInFlight) {
    return sessionConfigUpdateInFlight;
  }

  sessionConfigUpdateInFlight = (async () => {
    const ensured = await ensureDesktopSession({
      forceNew: false,
      reason: "config_update",
    });

    if (!ensured.ok) {
      return ensured;
    }

    if (!desktopHostSocket || !desktopHostSocket.connected) {
      const message = "Session host channel is offline.";
      setDesktopSessionState({
        status: "error",
        lastError: message,
      });
      emitSessionStateEvent("config_update_offline");
      return { ok: false, error: message, session: desktopSessionState };
    }

    const response = await emitSocketAck(
      desktopHostSocket,
      "host:update-config",
      { config: config || {} },
      10000
    );

    if (!response?.ok) {
      const message = response?.error || "SESSION_CONFIG_UPDATE_FAILED";
      setDesktopSessionState({
        lastError: message,
      });
      emitSessionStateEvent("config_update_failed");
      appendBridgeLog("error", `session: config update failed (${message})`);
      return { ok: false, error: message, session: desktopSessionState };
    }

    setDesktopSessionState({
      status: "ready",
      code: response.code || desktopSessionState.code,
      config: response.config || desktopSessionState.config || null,
      lastError: "",
    });
    emitSessionStateEvent("config_updated");
    appendBridgeLog("status", "session: config updated");
    return { ok: true, session: desktopSessionState };
  })();

  try {
    return await sessionConfigUpdateInFlight;
  } finally {
    sessionConfigUpdateInFlight = null;
  }
}

function copyFile(sourcePath, targetPath, overwrite = true) {
  if (!overwrite && fs.existsSync(targetPath)) {
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function prepareRuntimeAssets() {
  runtimeDir = path.join(app.getPath("userData"), "runtime");
  runtimeBridgeDir = path.join(runtimeDir, "bridge");
  runtimeConfigPath = path.join(runtimeDir, "config", "profiles.json");

  const runtimeServerProfilesPath = path.join(runtimeDir, "server", "profiles.js");

  fs.mkdirSync(runtimeBridgeDir, { recursive: true });

  copyFile(path.join(SOURCE_BRIDGE_DIR, "keyboard-bridge.js"), path.join(runtimeBridgeDir, "keyboard-bridge.js"));
  copyFile(path.join(SOURCE_BRIDGE_DIR, "run-virtual-bridge.js"), path.join(runtimeBridgeDir, "run-virtual-bridge.js"));
  copyFile(path.join(SOURCE_BRIDGE_DIR, "virtual-gamepad-bridge.py"), path.join(runtimeBridgeDir, "virtual-gamepad-bridge.py"));
  copyFile(path.join(SOURCE_BRIDGE_DIR, "requirements.txt"), path.join(runtimeBridgeDir, "requirements.txt"));

  copyFile(path.join(SOURCE_SERVER_DIR, "profiles.js"), runtimeServerProfilesPath);

  if (!fs.existsSync(runtimeConfigPath)) {
    copyFile(path.join(SOURCE_CONFIG_DIR, "profiles.json"), runtimeConfigPath, false);
  }
}

function getLanControllerUrls(port) {
  const entries = os.networkInterfaces();
  const urls = new Set();

  Object.values(entries).forEach((group) => {
    (group || []).forEach((entry) => {
      if (!entry || entry.internal || entry.family !== "IPv4") {
        return;
      }

      urls.add(`http://${entry.address}:${port}/controller`);
    });
  });

  return Array.from(urls);
}

function appendBridgeLog(type, message, bridgeId = null) {
  const event = {
    at: Date.now(),
    type,
    message: String(message || ""),
    bridgeId: bridgeId ? String(bridgeId) : null,
  };

  bridgeLogBuffer.push(event);
  if (bridgeLogBuffer.length > 300) {
    bridgeLogBuffer = bridgeLogBuffer.slice(-300);
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("bridge:event", event);
  }
}

function appendBridgeChunk(type, chunk, bridgeId = null) {
  String(chunk || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .forEach((line) => appendBridgeLog(type, line, bridgeId));
}

function getVenvPythonPath() {
  const venvDir = path.join(runtimeDir, ".air-bridge-venv");
  if (process.platform === "win32") {
    return path.join(venvDir, "Scripts", "python.exe");
  }

  return path.join(venvDir, "bin", "python");
}

function runCommandCapture(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.once("error", (error) => {
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr,
        error: error.message || "Command failed to start.",
      });
    });

    child.once("exit", (code) => {
      resolve({
        ok: code === 0,
        code: Number.isInteger(code) ? code : null,
        stdout,
        stderr,
        error: null,
      });
    });
  });
}

async function probeViGEmDriverInstalled() {
  if (process.platform !== "win32") {
    return { ok: true, installed: false, detail: "not_windows" };
  }

  const result = await runCommandCapture("pnputil", ["/enum-drivers"], {
    cwd: runtimeDir,
    env: process.env,
  });

  const output = `${result.stdout || ""}\n${result.stderr || ""}`.toLowerCase();
  if (!result.ok && !output) {
    return {
      ok: false,
      installed: false,
      detail: result.error || "pnputil_unavailable",
    };
  }

  return {
    ok: true,
    installed: output.includes("vigembus"),
    detail: "ok",
  };
}

async function installViGEmDriverWindows() {
  if (process.platform !== "win32") {
    return { ok: false, error: "NOT_WINDOWS" };
  }

  const wingetProbe = await runCommandCapture("winget", ["--version"], {
    cwd: runtimeDir,
    env: process.env,
  });

  if (!wingetProbe.ok) {
    return {
      ok: false,
      error: "WINGET_NOT_AVAILABLE",
      message: "winget is not available on this machine.",
    };
  }

  const psScript = [
    "$ErrorActionPreference = 'Stop'",
    "try {",
    "  $proc = Start-Process -FilePath 'winget' -Verb RunAs -ArgumentList @(",
    "    'install',",
    "    '--id', 'Nefarius.ViGEmBus',",
    "    '--exact',",
    "    '--accept-package-agreements',",
    "    '--accept-source-agreements',",
    "    '--silent'",
    "  ) -PassThru -Wait",
    "  exit $proc.ExitCode",
    "} catch {",
    "  Write-Error $_.Exception.Message",
    "  exit 1",
    "}",
  ].join("\n");

  const run = await runCommandCapture(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript],
    {
      cwd: runtimeDir,
      env: process.env,
    }
  );

  const combined = `${run.stdout || ""}\n${run.stderr || ""}`.trim();
  const normalized = combined.toLowerCase();

  const alreadyInstalled =
    normalized.includes("already installed") ||
    normalized.includes("no available upgrade") ||
    normalized.includes("no applicable upgrade");

  const successWithRestart = run.code === 3010 || run.code === 1641;
  if (run.ok || alreadyInstalled || successWithRestart) {
    return {
      ok: true,
      output: combined,
      requiresRestart: successWithRestart,
      method: "winget",
    };
  }

  return {
    ok: false,
    output: combined,
    code: run.code,
    error: run.error || "VIGEM_INSTALL_FAILED",
    method: "winget",
  };
}

async function runDependencySetup(options = {}) {
  if (dependencySetupInFlight) {
    return dependencySetupInFlight;
  }

  dependencySetupInFlight = (async () => {
    const allowDriverInstall = options.allowDriverInstall !== false;
    const auto = Boolean(options.auto);
    const openManualFallback = options.openManualFallback === true;

    setDependencySetupState({
      status: "running",
      startedAt: Date.now(),
      finishedAt: 0,
      auto,
      requiresRestart: false,
      message: "Installing Python bridge runtime and dependencies...",
      lastError: "",
    });
    appendBridgeLog("status", "setup: installing bridge runtime dependencies");

    const runtimeSetup = await installVirtualBridge();
    if (!runtimeSetup.ok) {
      const message = runtimeSetup.error || "Bridge runtime setup failed.";
      setDependencySetupState({
        status: "failed",
        finishedAt: Date.now(),
        message,
        lastError: message,
      });
      appendBridgeLog("error", `setup: ${message}`);
      return { ok: false, stage: "runtime", error: message };
    }

    setDependencySetupState({
      message: "Checking virtual device readiness...",
    });
    appendBridgeLog("status", "setup: validating virtual bridge readiness");

    let check = await checkVirtualBridgeReadiness({
      force: true,
      autoSetup: false,
    });

    if (check.status === "ready" || check.status === "not_required") {
      const message = "All required runtime dependencies are ready.";
      setDependencySetupState({
        status: "success",
        finishedAt: Date.now(),
        message,
      });
      appendBridgeLog("status", `setup: ${message}`);
      return { ok: true, stage: "complete", check };
    }

    if (process.platform !== "win32") {
      const message = check.message || "Virtual bridge is not ready.";
      setDependencySetupState({
        status: "failed",
        finishedAt: Date.now(),
        message,
        lastError: message,
      });
      appendBridgeLog("error", `setup: ${message}`);
      return { ok: false, stage: "preflight", error: message, check };
    }

    if (!allowDriverInstall) {
      const message = "Virtual driver missing. Run one-click setup with driver install enabled.";
      setDependencySetupState({
        status: "failed",
        finishedAt: Date.now(),
        message,
        lastError: message,
      });
      appendBridgeLog("error", `setup: ${message}`);
      return { ok: false, stage: "driver", error: message, check };
    }

    setDependencySetupState({
      message: "Installing ViGEmBus driver (Windows may show UAC prompt)...",
    });
    appendBridgeLog("status", "setup: attempting ViGEmBus driver install (UAC prompt expected)");

    const driverInstall = await installViGEmDriverWindows();
    if (!driverInstall.ok) {
      const message =
        driverInstall.message ||
        "Failed to install ViGEmBus automatically. Install it manually and retry setup.";
      setDependencySetupState({
        status: "failed",
        finishedAt: Date.now(),
        message,
        lastError: message,
      });
      appendBridgeLog("error", `setup: ${message}`);

      if (openManualFallback) {
        await shell.openExternal(VIGEM_RELEASE_URL);
      }

      return {
        ok: false,
        stage: "driver_install",
        error: message,
        manualUrl: VIGEM_RELEASE_URL,
        driverInstall,
      };
    }

    check = await checkVirtualBridgeReadiness({
      force: true,
      autoSetup: false,
    });

    if (check.status === "ready") {
      const message = "Windows driver and runtime are ready.";
      setDependencySetupState({
        status: "success",
        finishedAt: Date.now(),
        message,
        requiresRestart: Boolean(driverInstall.requiresRestart),
      });
      appendBridgeLog("status", `setup: ${message}`);
      return {
        ok: true,
        stage: "complete",
        check,
        requiresRestart: Boolean(driverInstall.requiresRestart),
      };
    }

    const needsRestart = Boolean(driverInstall.requiresRestart);
    if (needsRestart) {
      const message = "Driver installed but Windows restart is required before virtual gamepad is available.";
      setDependencySetupState({
        status: "pending_restart",
        finishedAt: Date.now(),
        message,
        requiresRestart: true,
        lastError: "",
      });
      appendBridgeLog("status", `setup: ${message}`);
      return {
        ok: false,
        stage: "restart_required",
        error: message,
        requiresRestart: true,
        check,
      };
    }

    const message = check.message || "Virtual driver still not ready after installation attempt.";
    setDependencySetupState({
      status: "failed",
      finishedAt: Date.now(),
      message,
      lastError: message,
    });
    appendBridgeLog("error", `setup: ${message}`);
    return { ok: false, stage: "post_install_check", error: message, check };
  })();

  try {
    return await dependencySetupInFlight;
  } finally {
    dependencySetupInFlight = null;
  }
}

async function probeVirtualDevice(pythonPath, device) {
  const constructorName = device === "ds4" ? "VDS4Gamepad" : "VX360Gamepad";
  const script = [
    "import vgamepad as vg",
    `ctor = getattr(vg, "${constructorName}", None)`,
    "if ctor is None:",
    `    raise RuntimeError("vgamepad.${constructorName} missing")`,
    "pad = ctor()",
    "pad.reset()",
    "pad.update()",
    "print('ok')",
  ].join("\n");

  const result = await runCommandCapture(pythonPath, ["-c", script], {
    cwd: runtimeDir,
    env: process.env,
  });

  if (result.ok) {
    return { ok: true, error: "" };
  }

  const message = String(result.stderr || result.stdout || result.error || "unknown error")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-2)
    .join(" | ");

  return { ok: false, error: message || "probe failed" };
}

function setVirtualBridgeCheckState(nextState) {
  virtualBridgeCheckState = {
    ...virtualBridgeCheckState,
    ...nextState,
    devices: {
      ...virtualBridgeCheckState.devices,
      ...(nextState.devices || {}),
    },
  };
}

function setDependencySetupState(nextState) {
  dependencySetupState = {
    ...dependencySetupState,
    ...nextState,
  };
}

function parsePlayerIndex(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }

  const integer = Math.floor(parsed);
  if (integer < 1 || integer > 64) {
    return 1;
  }

  return integer;
}

function listBridgeStates() {
  return Array.from(bridgeInstances.values()).map((instance) => ({
    id: instance.id,
    type: instance.type,
    playerIndex: instance.playerIndex,
    startedAt: instance.startedAt,
    pid: instance.pid,
  }));
}

function summarizeBridgeState(bridges) {
  if (!bridges || bridges.length === 0) {
    return {
      running: false,
      type: "",
      startedAt: 0,
      logs: bridgeLogBuffer,
    };
  }

  const first = bridges[0];
  const earliest = bridges.reduce((min, entry) => Math.min(min, entry.startedAt || Date.now()), Date.now());

  return {
    running: true,
    type: bridges.length === 1 ? first.type : `multiple (${bridges.length})`,
    startedAt: earliest,
    logs: bridgeLogBuffer,
  };
}

function terminateBridgeChild(active) {
  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };

    active.once("exit", finish);

    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(active.pid), "/T", "/F"], {
        windowsHide: true,
      });

      killer.once("exit", () => {
        setTimeout(finish, 250);
      });

      killer.once("error", () => {
        try {
          active.kill("SIGTERM");
        } catch (_error) {
          // no-op
        }
        setTimeout(finish, 700);
      });

      return;
    }

    try {
      if (active.pid) {
        process.kill(-active.pid, "SIGTERM");
      } else {
        active.kill("SIGTERM");
      }
    } catch (_error) {
      try {
        active.kill("SIGTERM");
      } catch (_innerError) {
        // no-op
      }
    }

    setTimeout(() => {
      if (settled) {
        return;
      }

      try {
        if (active.pid) {
          process.kill(-active.pid, "SIGKILL");
        }
      } catch (_error) {
        try {
          active.kill("SIGKILL");
        } catch (_innerError) {
          // no-op
        }
      }

      setTimeout(finish, 250);
    }, 1500);
  });
}

async function killBridgeProcess(bridgeId = null) {
  if (bridgeId !== null && bridgeId !== undefined) {
    const key = String(bridgeId);
    const instance = bridgeInstances.get(key);
    if (!instance) {
      return;
    }

    bridgeInstances.delete(key);
    await terminateBridgeChild(instance.process);
    return;
  }

  const activeInstances = Array.from(bridgeInstances.values());
  bridgeInstances.clear();

  if (activeInstances.length === 0) {
    return;
  }

  await Promise.all(activeInstances.map((instance) => terminateBridgeChild(instance.process)));
}

function spawnBridge(commandArgs, typeLabel, playerIndex) {
  return new Promise((resolve) => {
    const bridgeId = `b${bridgeIdCounter}`;
    bridgeIdCounter += 1;

    const child = spawn(process.execPath, commandArgs, {
      cwd: runtimeDir,
      env: {
        ...process.env,
        AIR_CONTROLLER_BRIDGE_HOME: runtimeDir,
        ELECTRON_RUN_AS_NODE: "1",
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const instance = {
      id: bridgeId,
      type: typeLabel,
      playerIndex,
      startedAt: Date.now(),
      pid: child.pid || null,
      process: child,
    };

    bridgeInstances.set(bridgeId, instance);

    appendBridgeLog("status", `${typeLabel} bridge starting (P${playerIndex})...`, bridgeId);

    child.stdout.on("data", (chunk) => {
      appendBridgeChunk("stdout", chunk.toString("utf8"), bridgeId);
    });

    child.stderr.on("data", (chunk) => {
      appendBridgeChunk("stderr", chunk.toString("utf8"), bridgeId);
    });

    child.on("error", (error) => {
      appendBridgeLog("error", error.message || "Bridge failed to start.", bridgeId);
      const current = bridgeInstances.get(bridgeId);
      if (current && current.process === child) {
        bridgeInstances.delete(bridgeId);
      }
    });

    child.on("exit", (code, signal) => {
      appendBridgeLog(
        "status",
        `bridge stopped (${signal ? `signal ${signal}` : `exit ${String(code || 0)}`})`,
        bridgeId
      );
      const current = bridgeInstances.get(bridgeId);
      if (current && current.process === child) {
        bridgeInstances.delete(bridgeId);
      }
    });

    resolve({
      ok: true,
      bridgeId,
      bridge: {
        id: bridgeId,
        type: typeLabel,
        playerIndex,
        startedAt: instance.startedAt,
        pid: instance.pid,
      },
    });
  });
}

async function installVirtualBridge() {
  if (installVirtualBridgeInFlight) {
    return installVirtualBridgeInFlight;
  }

  installVirtualBridgeInFlight = new Promise((resolve) => {
    const setup = spawn(process.execPath, [path.join(runtimeBridgeDir, "run-virtual-bridge.js"), "--setup-only"], {
      cwd: runtimeDir,
      env: {
        ...process.env,
        AIR_CONTROLLER_BRIDGE_HOME: runtimeDir,
        ELECTRON_RUN_AS_NODE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let output = "";

    setup.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      output += text;
      appendBridgeChunk("stdout", text);
    });

    setup.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      output += text;
      appendBridgeChunk("stderr", text);
    });

    setup.on("error", (error) => {
      resolve({ ok: false, error: error.message || "Failed to run bridge setup.", output });
    });

    setup.on("exit", (code) => {
      if (code === 0) {
        resolve({ ok: true, output });
        return;
      }

      resolve({ ok: false, error: `Bridge setup failed with exit code ${code}.`, output });
    });
  });

  try {
    return await installVirtualBridgeInFlight;
  } finally {
    installVirtualBridgeInFlight = null;
  }
}

async function checkVirtualBridgeReadiness(options = {}) {
  const force = Boolean(options.force);
  const autoSetup = options.autoSetup !== false;

  if (process.platform === "darwin") {
    setVirtualBridgeCheckState({
      status: "unsupported",
      checkedAt: Date.now(),
      message: "Virtual gamepad bridge is not supported on macOS. Use keyboard bridge or dry-run.",
      requirementsReady: false,
      devices: { xbox: false, ds4: false },
    });
    return virtualBridgeCheckState;
  }

  if (process.platform !== "win32" && process.platform !== "linux") {
    setVirtualBridgeCheckState({
      status: "not_required",
      checkedAt: Date.now(),
      message: "Virtual bridge preflight is not required on this platform.",
      requirementsReady: true,
      devices: { xbox: true, ds4: true },
    });
    return virtualBridgeCheckState;
  }

  if (!force && virtualBridgeCheckInFlight) {
    return virtualBridgeCheckInFlight;
  }

  if (!force && virtualBridgeCheckState.status === "ready") {
    return virtualBridgeCheckState;
  }

  virtualBridgeCheckInFlight = (async () => {
    setVirtualBridgeCheckState({
      status: "checking",
      checkedAt: Date.now(),
      message: "Checking Python runtime, bridge dependencies, and virtual device driver...",
      requirementsReady: false,
      devices: { xbox: false, ds4: false },
    });

    appendBridgeLog("status", "virtual preflight: checking runtime and driver");

    if (autoSetup) {
      const setup = await installVirtualBridge();
      if (!setup.ok) {
        const setupError = setup.error || "Bridge setup failed.";
        setVirtualBridgeCheckState({
          status: "failed",
          checkedAt: Date.now(),
          message: `Runtime setup failed: ${setupError}`,
          requirementsReady: false,
          devices: { xbox: false, ds4: false },
        });
        appendBridgeLog("error", `virtual preflight failed: ${setupError}`);
        return virtualBridgeCheckState;
      }
    }

    const pythonPath = getVenvPythonPath();
    if (!fs.existsSync(pythonPath)) {
      setVirtualBridgeCheckState({
        status: "failed",
        checkedAt: Date.now(),
        message: "Python runtime not found in local bridge environment.",
        requirementsReady: false,
        devices: { xbox: false, ds4: false },
      });
      appendBridgeLog("error", "virtual preflight failed: local Python runtime missing");
      return virtualBridgeCheckState;
    }

    const [xboxProbe, ds4Probe] = await Promise.all([
      probeVirtualDevice(pythonPath, "xbox"),
      probeVirtualDevice(pythonPath, "ds4"),
    ]);

    const devices = {
      xbox: xboxProbe.ok,
      ds4: ds4Probe.ok,
    };
    const atLeastOneDeviceReady = devices.xbox || devices.ds4;

    if (!atLeastOneDeviceReady) {
      const platformHint =
        process.platform === "win32"
          ? "Install/repair ViGEmBus driver."
          : "Ensure uinput/uhid modules are loaded and /dev/uinput is accessible.";
      const reason = [`Xbox: ${xboxProbe.error}`, `DS4: ${ds4Probe.error}`]
        .filter(Boolean)
        .join(" | ");

      setVirtualBridgeCheckState({
        status: "failed",
        checkedAt: Date.now(),
        message: `No virtual gamepad available. ${platformHint} ${reason}`,
        requirementsReady: true,
        devices,
      });
      appendBridgeLog("error", "virtual preflight failed: no supported virtual device available");
      return virtualBridgeCheckState;
    }

    const supportedDevices = [];
    if (devices.xbox) {
      supportedDevices.push("Xbox");
    }
    if (devices.ds4) {
      supportedDevices.push("DS4");
    }

    setVirtualBridgeCheckState({
      status: "ready",
      checkedAt: Date.now(),
      message: `Virtual bridge ready (${supportedDevices.join(", ")} validated).`,
      requirementsReady: true,
      devices,
    });

    appendBridgeLog("status", `virtual preflight: ready (${supportedDevices.join(", ")})`);
    return virtualBridgeCheckState;
  })();

  try {
    return await virtualBridgeCheckInFlight;
  } finally {
    virtualBridgeCheckInFlight = null;
  }
}

function createHostWindow() {
  if (hostWindow && !hostWindow.isDestroyed()) {
    hostWindow.focus();
    return;
  }

  hostWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: "#0a1524",
  });

  hostWindow.on("closed", () => {
    hostWindow = null;
  });

  hostWindow.loadURL(networkState.localHostUrl);
}

async function startServer() {
  const serverController = createAirServer({
    host: "0.0.0.0",
    port: 0,
    publicDir: SOURCE_PUBLIC_DIR,
    catalogPath: runtimeConfigPath,
  });

  serverHandle = await serverController.start();
  const port = Number(serverHandle.port);
  const localOrigin = `http://127.0.0.1:${port}`;

  networkState = {
    port,
    localOrigin,
    localHostUrl: `${localOrigin}/host`,
    localControllerUrl: `${localOrigin}/controller`,
    lanControllerUrls: getLanControllerUrls(port),
  };

  setDesktopSessionState({ code: desktopSessionState.code });
  emitSessionStateEvent("network_updated");
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 860,
    minWidth: 980,
    minHeight: 720,
    backgroundColor: "#090f18",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, "src", "renderer", "index.html"));
}

ipcMain.handle("desktop:get-state", async () => {
  const bridges = listBridgeStates();

  return {
    ok: true,
    ...networkState,
    bridge: summarizeBridgeState(bridges),
    bridges,
    session: desktopSessionState,
    virtualBridgeCheck: virtualBridgeCheckState,
    dependencySetup: dependencySetupState,
  };
});

ipcMain.handle("desktop:open-host-window", async () => {
  createHostWindow();
  return { ok: true };
});

ipcMain.handle("desktop:open-url", async (_event, url) => {
  if (!url) {
    return { ok: false, error: "URL_REQUIRED" };
  }

  await shell.openExternal(String(url));
  return { ok: true };
});

ipcMain.handle("desktop:open-game-controllers", async () => {
  if (process.platform !== "win32") {
    return { ok: false, error: "NOT_SUPPORTED", message: "joy.cpl is only available on Windows." };
  }

  return new Promise((resolve) => {
    const child = spawn("control.exe", ["joy.cpl"], {
      windowsHide: true,
      detached: true,
      stdio: "ignore",
    });

    child.once("error", (error) => {
      resolve({
        ok: false,
        error: "OPEN_FAILED",
        message: error.message || "Failed to open Game Controllers panel.",
      });
    });

    child.unref();
    resolve({ ok: true });
  });
});

ipcMain.handle("session:get", async () => {
  return {
    ok: true,
    session: desktopSessionState,
  };
});

ipcMain.handle("session:new", async (_event, options = {}) => {
  const result = await ensureDesktopSession({
    forceNew: true,
    reason: String(options.reason || "manual"),
    config: options.config || desktopSessionState.config || {},
  });

  return {
    ...result,
    session: desktopSessionState,
  };
});

ipcMain.handle("session:update-config", async (_event, options = {}) => {
  const result = await updateDesktopSessionConfig(options.config || {});
  return {
    ...result,
    session: desktopSessionState,
  };
});

ipcMain.handle("bridge:install-virtual", async () => {
  const setup = await installVirtualBridge();
  if (!setup.ok) {
    return setup;
  }

  const check = await checkVirtualBridgeReadiness({ force: true, autoSetup: false });
  return {
    ok: true,
    output: setup.output,
    check,
  };
});

ipcMain.handle("bridge:check-virtual", async (_event, options = {}) => {
  const check = await checkVirtualBridgeReadiness({
    force: Boolean(options.force),
    autoSetup: options.autoSetup !== false,
  });

  return {
    ok: check.status === "ready" || check.status === "not_required",
    check,
  };
});

ipcMain.handle("bridge:setup-all", async (_event, options = {}) => {
  const result = await runDependencySetup({
    force: Boolean(options.force),
    auto: Boolean(options.auto),
    allowDriverInstall: options.allowDriverInstall !== false,
    openManualFallback: Boolean(options.openManualFallback),
  });

  return {
    ...result,
    setup: dependencySetupState,
    check: virtualBridgeCheckState,
  };
});

ipcMain.handle("bridge:start", async (_event, options = {}) => {
  if (dependencySetupInFlight) {
    await dependencySetupInFlight;
  }

  let code = String(options.code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);

  if (code.length !== 6) {
    code = normalizeSessionCode(desktopSessionState.code);
  }

  if (code.length !== 6) {
    const ensured = await ensureDesktopSession({
      forceNew: false,
      reason: "bridge_start",
    });

    if (!ensured.ok) {
      return {
        ok: false,
        error: ensured.error || "SESSION_UNAVAILABLE",
        session: desktopSessionState,
      };
    }

    code = normalizeSessionCode(ensured.session?.code);
  }

  if (code.length !== 6) {
    return { ok: false, error: "SESSION_CODE_MUST_BE_6_CHARS", session: desktopSessionState };
  }

  const serverUrl = String(options.serverUrl || networkState.localOrigin || "").trim();
  if (!serverUrl) {
    return { ok: false, error: "SERVER_URL_REQUIRED" };
  }

  const kind = String(options.type || "virtual").toLowerCase();
  const playerIndex = parsePlayerIndex(options.player);
  const autoDependencySetup = options.autoDependencySetup !== false;

  if (kind === "keyboard") {
    const args = [
      path.join(runtimeBridgeDir, "keyboard-bridge.js"),
      "--server",
      serverUrl,
      "--code",
      code,
      "--player",
      String(playerIndex),
      "--name",
      `Desktop Keyboard Bridge P${playerIndex}`,
    ];

    if (options.dryRun) {
      args.push("--dry-run");
    }

    return spawnBridge(args, "keyboard", playerIndex);
  }

  const device = String(options.device || "xbox").toLowerCase() === "ds4" ? "ds4" : "xbox";

  if (!options.dryRun) {
    if (process.platform === "darwin") {
      return {
        ok: false,
        error: "Virtual gamepad bridge is not supported on macOS. Use keyboard bridge or dry-run.",
      };
    }

    if (process.platform === "win32" && autoDependencySetup) {
      const readyNow =
        virtualBridgeCheckState.status === "ready" && Boolean(virtualBridgeCheckState.devices?.[device]);

      if (!readyNow) {
        appendBridgeLog("status", `bridge:start: auto-running one-click setup for ${device.toUpperCase()} mode`);
        const setup = await runDependencySetup({
          force: true,
          auto: false,
          allowDriverInstall: true,
          openManualFallback: true,
        });

        if (!setup.ok) {
          return {
            ok: false,
            error: setup.error || "Dependency setup failed.",
            stage: setup.stage || "setup",
            requiresRestart: Boolean(setup.requiresRestart),
            setup,
            preflight: virtualBridgeCheckState,
          };
        }
      }
    }

    if (process.platform === "win32" || process.platform === "linux") {
      const check = await checkVirtualBridgeReadiness({
        force: process.platform === "win32" && autoDependencySetup,
        autoSetup: !(process.platform === "win32" && autoDependencySetup),
      });
      if (check.status !== "ready" || !check.devices?.[device]) {
        return {
          ok: false,
          error: check.message || "Virtual bridge preflight failed.",
          preflight: check,
        };
      }
    }
  }

  const args = [
    path.join(runtimeBridgeDir, "run-virtual-bridge.js"),
    "--server",
    serverUrl,
    "--code",
    code,
    "--device",
    device,
    "--player",
    String(playerIndex),
    "--name",
    `Desktop Virtual Bridge P${playerIndex}`,
  ];

  if (options.dryRun) {
    args.push("--dry-run");
  }

  return spawnBridge(args, `virtual-${device}`, playerIndex);
});

ipcMain.handle("bridge:stop", async (_event, options = {}) => {
  await killBridgeProcess(options.bridgeId || null);
  return { ok: true };
});

app.whenReady().then(async () => {
  try {
    prepareRuntimeAssets();
    await startServer();
    await ensureDesktopSession({
      forceNew: true,
      reason: "app_start",
    }).catch((error) => {
      appendBridgeLog("error", `session: failed to initialize (${error.message || "unknown"})`);
    });
    createMainWindow();
    runDependencySetup({
      auto: true,
      force: false,
      allowDriverInstall: process.platform === "win32",
      openManualFallback: false,
    }).catch((error) => {
      appendBridgeLog("error", `virtual preflight failed: ${error.message}`);
    });
  } catch (error) {
    dialog.showErrorBox("AIR Controller", error.message || "Failed to start desktop app.");
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async (event) => {
  if (shuttingDown) {
    return;
  }

  event.preventDefault();
  shuttingDown = true;

  try {
    await killBridgeProcess();
    if (desktopHostSocket) {
      try {
        desktopHostSocket.disconnect();
      } catch (_error) {
        // no-op
      }
      desktopHostSocket = null;
    }

    if (serverHandle && typeof serverHandle.close === "function") {
      await serverHandle.close();
      serverHandle = null;
    }
  } catch (_error) {
    // no-op
  }

  app.exit(0);
});
