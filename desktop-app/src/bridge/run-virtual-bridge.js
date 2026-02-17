#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const scriptPath = path.join(__dirname, "virtual-gamepad-bridge.py");
const requirementsPath = path.join(__dirname, "requirements.txt");
const venvDir = path.join(rootDir, ".air-bridge-venv");
const isWindows = process.platform === "win32";

const launcherArgs = process.argv.slice(2);
let setupOnly = false;
let noAutoSetup = false;
const passthroughArgs = [];

launcherArgs.forEach((arg) => {
  if (arg === "--setup-only") {
    setupOnly = true;
    return;
  }

  if (arg === "--no-auto-setup") {
    noAutoSetup = true;
    return;
  }

  passthroughArgs.push(arg);
});

const pythonCandidates = isWindows
  ? [
      { cmd: "py", prefix: ["-3"] },
      { cmd: "python", prefix: [] },
      { cmd: "python3", prefix: [] },
    ]
  : [
      { cmd: "python3", prefix: [] },
      { cmd: "python", prefix: [] },
    ];

function findSystemPython() {
  for (const candidate of pythonCandidates) {
    const probe = spawnSync(candidate.cmd, [...candidate.prefix, "--version"], {
      stdio: "ignore",
    });

    if (!probe.error && probe.status === 0) {
      return candidate;
    }
  }

  return null;
}

function runOrThrow(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${cmd} exited with code ${result.status}`);
  }
}

function ensureVenv(systemPython) {
  const venvPython = isWindows
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");

  if (!fs.existsSync(venvPython)) {
    console.log(`[bridge:virtual] Creating local Python environment at ${venvDir}`);
    runOrThrow(systemPython.cmd, [...systemPython.prefix, "-m", "venv", venvDir]);
  }

  return venvPython;
}

function ensureRequirementsInstalled(venvPython) {
  const stampPath = path.join(venvDir, ".requirements-installed");

  const requirementsMtime = fs.statSync(requirementsPath).mtimeMs;
  const stampMtime = fs.existsSync(stampPath) ? fs.statSync(stampPath).mtimeMs : 0;

  if (stampMtime >= requirementsMtime) {
    return;
  }

  console.log("[bridge:virtual] Installing Python bridge dependencies...");
  runOrThrow(venvPython, ["-m", "pip", "install", "-r", requirementsPath]);
  fs.writeFileSync(stampPath, `${new Date().toISOString()}\n`, "utf8");
}

function runBridge(venvPython) {
  const args = [scriptPath, ...passthroughArgs];
  const child = spawn(venvPython, args, {
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(`Failed to start virtual bridge: ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code || 0);
  });
}

function main() {
  const systemPython = findSystemPython();

  if (!systemPython) {
    console.error("Unable to find a Python 3 runtime. Install Python 3 and retry.");
    process.exit(1);
  }

  const venvPython = ensureVenv(systemPython);

  if (!noAutoSetup) {
    ensureRequirementsInstalled(venvPython);
  }

  if (setupOnly) {
    console.log("[bridge:virtual] Setup complete.");
    process.exit(0);
  }

  runBridge(venvPython);
}

try {
  main();
} catch (error) {
  console.error(`[bridge:virtual] ${error.message}`);
  process.exit(1);
}
