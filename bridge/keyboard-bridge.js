#!/usr/bin/env node

const { io } = require("socket.io-client");
const { keyboard, Key } = require("@nut-tree-fork/nut-js");
const { getGameProfile } = require("../lib/profiles");

keyboard.config.autoDelayMs = 0;

const KEY_TOKEN_MAP = {
  left: Key.Left,
  right: Key.Right,
  up: Key.Up,
  down: Key.Down,
  space: Key.Space,
  enter: Key.Enter,
  escape: Key.Escape,
  tab: Key.Tab,
  left_shift: Key.LeftShift,
  right_shift: Key.RightShift,
  left_control: Key.LeftControl,
  right_control: Key.RightControl,
  left_alt: Key.LeftAlt,
  right_alt: Key.RightAlt,
};

for (let i = 65; i <= 90; i += 1) {
  const char = String.fromCharCode(i);
  KEY_TOKEN_MAP[char.toLowerCase()] = Key[char];
}

function parseArgs(argv) {
  const options = {
    server: process.env.AIR_CONTROLLER_SERVER || "http://localhost:3000",
    code: process.env.AIR_CONTROLLER_CODE || "",
    profile: process.env.AIR_CONTROLLER_PROFILE || "",
    name: process.env.AIR_CONTROLLER_BRIDGE_NAME || "Keyboard Bridge",
    dryRun: process.env.AIR_CONTROLLER_DRY_RUN === "1",
    help: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];

    if (current === "--help" || current === "-h") {
      options.help = true;
      continue;
    }

    if (current === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (current === "--server") {
      options.server = argv[i + 1] || options.server;
      i += 1;
      continue;
    }

    if (current === "--code") {
      options.code = argv[i + 1] || options.code;
      i += 1;
      continue;
    }

    if (current === "--profile") {
      options.profile = argv[i + 1] || options.profile;
      i += 1;
      continue;
    }

    if (current === "--name") {
      options.name = argv[i + 1] || options.name;
      i += 1;
      continue;
    }
  }

  options.code = String(options.code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);

  return options;
}

function printUsage() {
  console.log("Usage: npm run bridge -- --code <SESSION_CODE> [options]");
  console.log("");
  console.log("Options:");
  console.log("  --server <url>      AIR Controller server URL (default: http://localhost:3000)");
  console.log("  --profile <id>      Lock to a game profile ID (platformer, racing, arena)");
  console.log("  --name <label>      Bridge label shown on host dashboard");
  console.log("  --dry-run           Print key transitions without injecting OS keys");
  console.log("  -h, --help          Show this help message");
}

function resolveKeyToken(token) {
  const normalized = String(token || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");

  return {
    token: normalized,
    key: KEY_TOKEN_MAP[normalized],
  };
}

function normalizeMapping(mapping = {}) {
  const normalized = {};

  Object.entries(mapping || {}).forEach(([buttonName, value]) => {
    const list = Array.isArray(value) ? value : [value];
    const tokens = list
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter((entry) => entry.length > 0);

    if (tokens.length === 1) {
      normalized[buttonName] = tokens[0];
    } else if (tokens.length > 1) {
      normalized[buttonName] = tokens;
    }
  });

  return normalized;
}

const options = parseArgs(process.argv);

if (options.help || !options.code) {
  printUsage();
  process.exit(options.help ? 0 : 1);
}

let activeProfile = getGameProfile(options.profile || "platformer") || {
  id: "platformer",
  name: "Platformer",
  mapping: {},
};
let profileLocked = Boolean(options.profile);
let pressedTokens = new Set();
let actionQueue = Promise.resolve();

function profileSummary(profile) {
  return `${profile.name || profile.id} (${profile.id})`;
}

function setActiveProfile(profileId, source, profilePayload = null) {
  const fallbackProfile = getGameProfile(profileId || "platformer") || activeProfile;
  const fallbackMap = fallbackProfile.keyboardMap || fallbackProfile.mapping || {};
  const payloadMap = profilePayload?.keyboardMap || profilePayload?.mapping || {};
  const next = {
    id: profilePayload?.id || fallbackProfile.id,
    name: profilePayload?.name || fallbackProfile.name,
    mapping: normalizeMapping(payloadMap || fallbackMap),
  };

  const changed = !activeProfile || activeProfile.id !== next.id;
  activeProfile = next;

  if (changed) {
    console.log(`[bridge] profile -> ${profileSummary(activeProfile)} via ${source}`);
  }
}

async function pressToken(token) {
  const { key } = resolveKeyToken(token);
  if (!key) {
    return;
  }

  if (options.dryRun) {
    console.log(`[dry-run] key down ${token}`);
    return;
  }

  await keyboard.pressKey(key);
}

async function releaseToken(token) {
  const { key } = resolveKeyToken(token);
  if (!key) {
    return;
  }

  if (options.dryRun) {
    console.log(`[dry-run] key up ${token}`);
    return;
  }

  await keyboard.releaseKey(key);
}

async function releaseAllPressedKeys() {
  const tokens = Array.from(pressedTokens);

  for (const token of tokens) {
    await releaseToken(token);
    pressedTokens.delete(token);
  }
}

function desiredTokensFromPayload(payload = {}) {
  const buttons = payload.buttons || {};
  const desired = new Set();

  Object.entries(buttons).forEach(([buttonName, isPressed]) => {
    if (!isPressed) {
      return;
    }

    const mapping = activeProfile.mapping[buttonName];

    if (!mapping) {
      return;
    }

    const mappedTokens = Array.isArray(mapping) ? mapping : [mapping];

    mappedTokens.forEach((token) => {
      const { token: resolvedToken, key } = resolveKeyToken(token);

      if (resolvedToken && key) {
        desired.add(resolvedToken);
      }
    });
  });

  return desired;
}

function queueKeySync(payload) {
  actionQueue = actionQueue
    .then(async () => {
      const desired = desiredTokensFromPayload(payload);

      for (const token of Array.from(pressedTokens)) {
        if (!desired.has(token)) {
          await releaseToken(token);
          pressedTokens.delete(token);
        }
      }

      for (const token of Array.from(desired)) {
        if (!pressedTokens.has(token)) {
          await pressToken(token);
          pressedTokens.add(token);
        }
      }
    })
    .catch((error) => {
      console.error(`[bridge] key sync failed: ${error.message}`);
    });
}

const socket = io(options.server, {
  transports: ["websocket", "polling"],
  reconnection: true,
});

console.log(`[bridge] server: ${options.server}`);
console.log(`[bridge] session: ${options.code}`);
console.log(`[bridge] mode: ${options.dryRun ? "dry-run" : "keyboard injection"}`);

socket.on("connect", () => {
  socket.emit(
    "bridge:join-session",
    {
      code: options.code,
      name: options.name,
    },
    (res) => {
      if (!res?.ok) {
        console.error(`[bridge] failed to join session: ${res?.error || "unknown error"}`);
        process.exit(1);
      }

      if (!profileLocked && res?.config?.gameProfileId) {
        setActiveProfile(res.config.gameProfileId, "session config", res.profile);
      } else {
        setActiveProfile(activeProfile.id, profileLocked ? "cli override" : "default", res.profile);
      }

      console.log("[bridge] connected and listening for controller input");
    }
  );
});

socket.on("session:input", ({ payload }) => {
  queueKeySync(payload || {});
});

socket.on("session:config-updated", ({ config, profile }) => {
  if (profileLocked || !config?.gameProfileId) {
    return;
  }

  setActiveProfile(config.gameProfileId, "host update", profile);
});

socket.on("session:closed", async () => {
  console.log("[bridge] session closed by host");
  await releaseAllPressedKeys();
  process.exit(0);
});

socket.on("disconnect", async () => {
  console.log("[bridge] disconnected, releasing pressed keys");
  await releaseAllPressedKeys();
});

async function shutdown(signal) {
  console.log(`[bridge] ${signal} received, releasing keys and exiting`);
  socket.disconnect();
  await releaseAllPressedKeys();
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
