#!/usr/bin/env node

const { spawn } = require("child_process");
const { io } = require("socket.io-client");
const { createAirServer } = require("../desktop-app/src/server/appServer");

function onceEvent(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);

    const onEvent = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };

    socket.once(event, onEvent);
  });
}

function emitAck(socket, event, payload, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timeout waiting for ack ${event}`));
    }, timeoutMs);

    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectClient(baseUrl) {
  const socket = io(baseUrl, {
    transports: ["websocket"],
    reconnection: false,
  });

  return onceEvent(socket, "connect", 5000).then(() => socket);
}

async function runSessionSwitchSuite(baseUrl) {
  const sockets = [];
  const track = (socket) => {
    sockets.push(socket);
    return socket;
  };

  try {
    const hostOne = track(await connectClient(baseUrl));
    const hostTwo = track(await connectClient(baseUrl));

    const hostOneSession = await emitAck(hostOne, "host:create-session", {});
    const hostTwoSession = await emitAck(hostTwo, "host:create-session", {});

    if (!hostOneSession?.ok || !hostTwoSession?.ok) {
      throw new Error("failed to create sessions");
    }

    const sessionA = hostOneSession.code;
    const sessionB = hostTwoSession.code;

    const bridge = track(await connectClient(baseUrl));
    const bridgeDisconnectedEvents = [];
    hostOne.on("session:bridge-disconnected", (event) => {
      bridgeDisconnectedEvents.push(event);
    });

    const bridgeA = await emitAck(bridge, "bridge:join-session", {
      code: sessionA,
      name: "Regression Bridge",
      player: 1,
    });
    const bridgeB = await emitAck(bridge, "bridge:join-session", {
      code: sessionB,
      name: "Regression Bridge",
      player: 1,
    });

    if (!bridgeA?.ok || !bridgeB?.ok) {
      throw new Error("bridge failed to join sessions");
    }

    await delay(150);
    if (bridgeDisconnectedEvents.length !== 1) {
      throw new Error("bridge switch did not emit disconnect to old host");
    }

    const bridgeInputs = [];
    bridge.on("session:input", (event) => {
      bridgeInputs.push(event?.payload?.event || "");
    });

    const oldController = track(await connectClient(baseUrl));
    const newController = track(await connectClient(baseUrl));

    await emitAck(oldController, "controller:join-session", { code: sessionA, player: 1 });
    await emitAck(newController, "controller:join-session", { code: sessionB, player: 1 });

    oldController.emit("controller:input", { event: "old-session-input" });
    newController.emit("controller:input", { event: "new-session-input" });
    await delay(250);

    if (bridgeInputs.includes("old-session-input")) {
      throw new Error("bridge still received input from old session after switch");
    }
    if (!bridgeInputs.includes("new-session-input")) {
      throw new Error("bridge did not receive input from current session");
    }

    const roamingController = track(await connectClient(baseUrl));
    const controllerDisconnectedEvents = [];
    hostOne.on("session:controller-disconnected", (event) => {
      controllerDisconnectedEvents.push(event);
    });

    await emitAck(roamingController, "controller:join-session", { code: sessionA, player: 2 });
    await emitAck(roamingController, "controller:join-session", { code: sessionB, player: 2 });
    await delay(150);

    if (controllerDisconnectedEvents.length < 1) {
      throw new Error("controller switch did not emit disconnect to old host");
    }

    const configUpdates = [];
    roamingController.on("session:config-updated", (event) => {
      configUpdates.push(event?.config?.gameProfileId || "");
    });

    await emitAck(hostOne, "host:update-config", {
      config: { gameProfileId: "racing", layoutId: "balanced" },
    });
    await delay(100);
    await emitAck(hostTwo, "host:update-config", {
      config: { gameProfileId: "arena", layoutId: "balanced" },
    });
    await delay(200);

    if (configUpdates.includes("racing")) {
      throw new Error("controller still received config updates from old session");
    }
    if (!configUpdates.includes("arena")) {
      throw new Error("controller did not receive config updates from current session");
    }
  } finally {
    sockets.forEach((socket) => {
      try {
        socket.disconnect();
      } catch (_error) {
        // no-op
      }
    });
  }
}

async function runRootServerSuite() {
  const port = 39231;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: ["ignore", "ignore", "ignore"],
  });

  try {
    await delay(900);
    await runSessionSwitchSuite(`http://127.0.0.1:${port}`);
  } finally {
    try {
      child.kill("SIGTERM");
    } catch (_error) {
      // no-op
    }
  }
}

async function runDesktopServerSuite() {
  const server = createAirServer({
    host: "127.0.0.1",
    port: 0,
  });
  const handle = await server.start();

  try {
    await runSessionSwitchSuite(`http://127.0.0.1:${handle.port}`);
  } finally {
    await handle.close();
  }
}

async function main() {
  await runRootServerSuite();
  await runDesktopServerSuite();
  process.stdout.write("session-membership-regression: ok\n");
}

main().catch((error) => {
  process.stderr.write(`${error.message || String(error)}\n`);
  process.exit(1);
});
