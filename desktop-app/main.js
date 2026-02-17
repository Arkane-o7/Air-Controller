const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { createAirServer } = require("./src/server/appServer");

const SOURCE_ROOT = path.join(__dirname, "src");
const SOURCE_BRIDGE_DIR = path.join(SOURCE_ROOT, "bridge");
const SOURCE_SERVER_DIR = path.join(SOURCE_ROOT, "server");
const SOURCE_CONFIG_DIR = path.join(SOURCE_ROOT, "config");
const SOURCE_PUBLIC_DIR = path.join(SOURCE_SERVER_DIR, "public");

let mainWindow = null;
let hostWindow = null;
let serverHandle = null;
let runtimeDir = "";
let runtimeBridgeDir = "";
let runtimeConfigPath = "";
let bridgeProcess = null;
let bridgeType = "";
let bridgeStartedAt = 0;
let bridgeLogBuffer = [];
let shuttingDown = false;
let networkState = {
  port: 0,
  localOrigin: "",
  localHostUrl: "",
  localControllerUrl: "",
  lanControllerUrls: [],
};

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

function appendBridgeLog(type, message) {
  const event = {
    at: Date.now(),
    type,
    message: String(message || ""),
  };

  bridgeLogBuffer.push(event);
  if (bridgeLogBuffer.length > 300) {
    bridgeLogBuffer = bridgeLogBuffer.slice(-300);
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("bridge:event", event);
  }
}

function appendBridgeChunk(type, chunk) {
  String(chunk || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .forEach((line) => appendBridgeLog(type, line));
}

function killBridgeProcess() {
  if (!bridgeProcess) {
    return Promise.resolve();
  }

  const active = bridgeProcess;
  bridgeProcess = null;

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

function spawnBridge(commandArgs, typeLabel) {
  return new Promise((resolve) => {
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

    bridgeProcess = child;
    bridgeType = typeLabel;
    bridgeStartedAt = Date.now();

    appendBridgeLog("status", `${typeLabel} bridge starting...`);

    child.stdout.on("data", (chunk) => {
      appendBridgeChunk("stdout", chunk.toString("utf8"));
    });

    child.stderr.on("data", (chunk) => {
      appendBridgeChunk("stderr", chunk.toString("utf8"));
    });

    child.on("error", (error) => {
      appendBridgeLog("error", error.message || "Bridge failed to start.");
      bridgeProcess = null;
      bridgeType = "";
    });

    child.on("exit", (code, signal) => {
      appendBridgeLog(
        "status",
        `bridge stopped (${signal ? `signal ${signal}` : `exit ${String(code || 0)}`})`
      );
      bridgeProcess = null;
      bridgeType = "";
      bridgeStartedAt = 0;
    });

    resolve({ ok: true });
  });
}

async function installVirtualBridge() {
  return new Promise((resolve) => {
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
  return {
    ok: true,
    ...networkState,
    bridge: {
      running: Boolean(bridgeProcess),
      type: bridgeType,
      startedAt: bridgeStartedAt,
      logs: bridgeLogBuffer,
    },
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

ipcMain.handle("bridge:install-virtual", async () => {
  return installVirtualBridge();
});

ipcMain.handle("bridge:start", async (_event, options = {}) => {
  const code = String(options.code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);

  if (code.length !== 6) {
    return { ok: false, error: "SESSION_CODE_MUST_BE_6_CHARS" };
  }

  if (bridgeProcess) {
    return { ok: false, error: "BRIDGE_ALREADY_RUNNING" };
  }

  const serverUrl = String(options.serverUrl || networkState.localOrigin || "").trim();
  if (!serverUrl) {
    return { ok: false, error: "SERVER_URL_REQUIRED" };
  }

  const kind = String(options.type || "virtual").toLowerCase();

  if (kind === "keyboard") {
    const args = [
      path.join(runtimeBridgeDir, "keyboard-bridge.js"),
      "--server",
      serverUrl,
      "--code",
      code,
      "--name",
      "Desktop Keyboard Bridge",
    ];

    if (options.dryRun) {
      args.push("--dry-run");
    }

    return spawnBridge(args, "keyboard");
  }

  const device = String(options.device || "xbox").toLowerCase() === "ds4" ? "ds4" : "xbox";
  const args = [
    path.join(runtimeBridgeDir, "run-virtual-bridge.js"),
    "--server",
    serverUrl,
    "--code",
    code,
    "--device",
    device,
  ];

  if (options.dryRun) {
    args.push("--dry-run");
  }

  return spawnBridge(args, `virtual-${device}`);
});

ipcMain.handle("bridge:stop", async () => {
  await killBridgeProcess();
  return { ok: true };
});

app.whenReady().then(async () => {
  try {
    prepareRuntimeAssets();
    await startServer();
    createMainWindow();
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
    if (serverHandle && typeof serverHandle.close === "function") {
      await serverHandle.close();
      serverHandle = null;
    }
  } catch (_error) {
    // no-op
  }

  app.exit(0);
});
