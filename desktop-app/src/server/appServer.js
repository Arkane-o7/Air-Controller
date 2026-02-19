const path = require("path");
const http = require("http");
const os = require("os");
const express = require("express");
const { Server } = require("socket.io");
const {
  getClientProfiles,
  getGameProfile,
  getLayout,
  getProfileEditorPayload,
  resolveSessionConfig,
  setCatalogPath,
  upsertGameProfile,
  deleteGameProfile,
} = require("./profiles");

function createAirServer(options = {}) {
  const host = options.host || "0.0.0.0";
  const port = Number(options.port || 0);
  const publicDir = options.publicDir || path.join(__dirname, "public");
  if (options.catalogPath) {
    setCatalogPath(options.catalogPath);
  }

  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);

  const sessions = new Map();

  function createSessionCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";

    for (let i = 0; i < 6; i += 1) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }

    return sessions.has(code) ? createSessionCode() : code;
  }

  function normalizeCode(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
  }

  function parsePlayerIndex(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    const integer = Math.floor(parsed);
    if (integer < 1 || integer > 64) {
      return null;
    }

    return integer;
  }

  function reserveControllerPlayerIndex(session, requestedPlayer) {
    const used = new Set();

    session.controllers.forEach((entry) => {
      if (entry?.playerIndex) {
        used.add(entry.playerIndex);
      }
    });

    const requestedIndex = parsePlayerIndex(requestedPlayer);
    if (requestedIndex && !used.has(requestedIndex)) {
      return requestedIndex;
    }

    for (let candidate = 1; candidate <= 64; candidate += 1) {
      if (!used.has(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  function resolveBridgePlayerIndex(value) {
    return parsePlayerIndex(value) || 1;
  }

  function buildConfigPayload(code, config) {
    return {
      code,
      config,
      profile: getGameProfile(config.gameProfileId),
      layout: getLayout(config.layoutId),
    };
  }

  function emitConfigUpdate(code, config) {
    io.to(`session:${code}`).emit("session:config-updated", buildConfigPayload(code, config));
  }

  function refreshSessions(activeProfileId = null) {
    sessions.forEach((session, code) => {
      const resolved = resolveSessionConfig(session.config || {});
      const configChanged =
        resolved.gameProfileId !== session.config.gameProfileId ||
        resolved.layoutId !== session.config.layoutId;

      session.config = resolved;

      const shouldEmit =
        configChanged ||
        !activeProfileId ||
        resolved.gameProfileId === activeProfileId;

      if (shouldEmit) {
        emitConfigUpdate(code, resolved);
      }
    });
  }

  function closeSession(code, reason) {
    const normalizedCode = normalizeCode(code);
    const session = sessions.get(normalizedCode);

    if (!session) {
      return;
    }

    io.to(`session:${normalizedCode}`).emit("session:closed", {
      code: normalizedCode,
      reason,
    });

    sessions.delete(normalizedCode);
  }

  function getSessionFromSocket(socket) {
    const code = normalizeCode(socket.data.sessionCode);
    return {
      code,
      session: sessions.get(code),
    };
  }

  function maybeCleanupStaleSession(code, session) {
    if (
      session &&
      session.controllers.size === 0 &&
      session.bridges.size === 0 &&
      Date.now() - session.createdAt > 1000 * 60 * 20
    ) {
      sessions.delete(code);
    }
  }

  function emitControllerDisconnected(session, socket, fallbackPlayerIndex = null) {
    const controllerState = session.controllers.get(socket.id) || null;
    session.controllers.delete(socket.id);
    io.to(session.hostSocketId).emit("session:controller-disconnected", {
      controllerId: socket.id,
      playerIndex: controllerState?.playerIndex || fallbackPlayerIndex || null,
      count: session.controllers.size,
    });
  }

  function emitBridgeDisconnected(session, socket, fallbackName = "Bridge", fallbackPlayerIndex = 1) {
    const bridgeState = session.bridges.get(socket.id) || null;
    session.bridges.delete(socket.id);
    io.to(session.hostSocketId).emit("session:bridge-disconnected", {
      bridgeId: socket.id,
      name: bridgeState?.name || fallbackName || "Bridge",
      playerIndex: bridgeState?.playerIndex || fallbackPlayerIndex || 1,
      count: session.bridges.size,
    });
  }

  function detachSocketFromPreviousSession(socket, nextRole, nextCode) {
    const previousRole = socket.data.role;
    const previousCode = normalizeCode(socket.data.sessionCode);

    if (!previousRole || !previousCode) {
      return;
    }

    if (previousRole === nextRole && previousCode === nextCode) {
      return;
    }

    const previousSession = sessions.get(previousCode);

    if (previousRole === "host") {
      closeSession(previousCode, "host_reassigned");
    } else if (previousRole === "controller" && previousSession) {
      emitControllerDisconnected(previousSession, socket, socket.data.playerIndex || null);
      maybeCleanupStaleSession(previousCode, previousSession);
    } else if (previousRole === "bridge" && previousSession) {
      emitBridgeDisconnected(
        previousSession,
        socket,
        socket.data.bridgeName || "Bridge",
        socket.data.playerIndex || 1
      );
      maybeCleanupStaleSession(previousCode, previousSession);
    }

    socket.leave(`session:${previousCode}`);
    delete socket.data.role;
    delete socket.data.sessionCode;
    delete socket.data.playerIndex;
    delete socket.data.bridgeName;
  }

  function listLanOrigins(portValue) {
    const origins = new Set();
    const interfaces = os.networkInterfaces();

    Object.values(interfaces).forEach((group) => {
      (group || []).forEach((entry) => {
        if (!entry || entry.internal || entry.family !== "IPv4") {
          return;
        }

        origins.add(`http://${entry.address}:${portValue}`);
      });
    });

    return Array.from(origins);
  }

  function resolveRequestOrigin(req, fallbackPort) {
    const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
    const protocol = forwardedProto || req.protocol || "http";
    const hostHeader = req.get("host") || `localhost:${fallbackPort}`;
    return `${protocol}://${hostHeader}`.replace(/\/+$/, "");
  }

  app.use(express.static(publicDir));
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  app.get("/host", (_req, res) => {
    res.sendFile(path.join(publicDir, "host.html"));
  });

  app.get("/controller", (_req, res) => {
    res.sendFile(path.join(publicDir, "controller.html"));
  });

  app.get("/api/profiles", (_req, res) => {
    res.json(getClientProfiles());
  });

  app.get("/api/profiles/editor", (_req, res) => {
    res.json(getProfileEditorPayload());
  });

  app.get("/api/network", (req, res) => {
    const requestPort = Number(req.socket?.localPort || port || 3000);
    const serverOrigin = resolveRequestOrigin(req, requestPort);
    const lanOrigins = listLanOrigins(requestPort);
    const relayDefaultOrigin = String(options.relayDefaultOrigin || process.env.AIR_PUBLIC_RELAY_ORIGIN || "")
      .trim()
      .replace(/\/+$/, "");

    let recommendedLanOrigin = serverOrigin;
    const hostLabel = (req.hostname || "").toLowerCase();
    const isLoopbackHost =
      hostLabel === "localhost" || hostLabel === "127.0.0.1" || hostLabel === "::1";

    if (isLoopbackHost && lanOrigins.length > 0) {
      recommendedLanOrigin = lanOrigins[0];
    }

    res.json({
      serverOrigin,
      lanOrigins,
      recommendedLanOrigin,
      relayDefaultOrigin,
    });
  });

  app.post("/api/profiles/game", (req, res) => {
    try {
      const profile = upsertGameProfile(req.body?.profile || {}, "create");
      res.json({ ok: true, profile, profiles: getClientProfiles() });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message || "PROFILE_CREATE_FAILED" });
    }
  });

  app.put("/api/profiles/game/:id", (req, res) => {
    try {
      const profile = upsertGameProfile(
        {
          ...(req.body?.profile || {}),
          id: req.params.id,
        },
        "update"
      );

      refreshSessions(profile.id);
      res.json({ ok: true, profile, profiles: getClientProfiles() });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message || "PROFILE_UPDATE_FAILED" });
    }
  });

  app.delete("/api/profiles/game/:id", (req, res) => {
    try {
      deleteGameProfile(req.params.id);
      refreshSessions(null);
      res.json({ ok: true, profiles: getClientProfiles() });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message || "PROFILE_DELETE_FAILED" });
    }
  });

  io.on("connection", (socket) => {
    socket.on("host:create-session", (payload = {}, ack = () => {}) => {
      detachSocketFromPreviousSession(socket, "host", "");

      const code = createSessionCode();
      const config = resolveSessionConfig(payload.config || payload);

      sessions.set(code, {
        hostSocketId: socket.id,
        controllers: new Map(),
        bridges: new Map(),
        createdAt: Date.now(),
        config,
      });

      socket.join(`session:${code}`);
      socket.data.role = "host";
      socket.data.sessionCode = code;

      ack({ ok: true, ...buildConfigPayload(code, config) });
    });

    socket.on("host:update-config", (payload = {}, ack = () => {}) => {
      const { code, session } = getSessionFromSocket(socket);

      if (!session || socket.data.role !== "host") {
        ack({ ok: false, error: "SESSION_NOT_FOUND" });
        return;
      }

      session.config = resolveSessionConfig(payload.config || payload);

      emitConfigUpdate(code, session.config);

      ack({
        ok: true,
        ...buildConfigPayload(code, session.config),
      });
    });

    socket.on("controller:join-session", (payload = {}, ack = () => {}) => {
      const code = normalizeCode(payload.code);
      const session = sessions.get(code);

      if (!session) {
        ack({ ok: false, error: "SESSION_NOT_FOUND" });
        return;
      }

      detachSocketFromPreviousSession(socket, "controller", code);

      const playerIndex = reserveControllerPlayerIndex(session, payload.player);
      if (!playerIndex) {
        ack({ ok: false, error: "CONTROLLER_SLOTS_FULL", maxControllers: 64 });
        return;
      }

      session.controllers.set(socket.id, {
        playerIndex,
        joinedAt: Date.now(),
      });
      socket.join(`session:${code}`);
      socket.data.role = "controller";
      socket.data.sessionCode = code;
      socket.data.playerIndex = playerIndex;

      io.to(session.hostSocketId).emit("session:controller-connected", {
        controllerId: socket.id,
        playerIndex,
        count: session.controllers.size,
      });

      ack({ ok: true, playerIndex, ...buildConfigPayload(code, session.config) });
    });

    socket.on("bridge:join-session", (payload = {}, ack = () => {}) => {
      const code = normalizeCode(payload.code);
      const session = sessions.get(code);

      if (!session) {
        ack({ ok: false, error: "SESSION_NOT_FOUND" });
        return;
      }

      detachSocketFromPreviousSession(socket, "bridge", code);

      const playerIndex = resolveBridgePlayerIndex(payload.player);
      const bridgeName = String(payload.name || "Bridge").slice(0, 40);

      session.bridges.set(socket.id, {
        name: bridgeName,
        playerIndex,
        joinedAt: Date.now(),
      });
      socket.join(`session:${code}`);
      socket.data.role = "bridge";
      socket.data.sessionCode = code;
      socket.data.bridgeName = bridgeName;
      socket.data.playerIndex = playerIndex;

      io.to(session.hostSocketId).emit("session:bridge-connected", {
        bridgeId: socket.id,
        name: bridgeName,
        playerIndex,
        count: session.bridges.size,
      });

      ack({ ok: true, playerIndex, ...buildConfigPayload(code, session.config) });
    });

    socket.on("controller:input", (payload = {}) => {
      const { session } = getSessionFromSocket(socket);

      if (!session || socket.data.role !== "controller") {
        return;
      }

      const controllerState = session.controllers.get(socket.id);
      if (!controllerState) {
        return;
      }

      const event = {
        controllerId: socket.id,
        playerIndex: controllerState.playerIndex || 1,
        at: Date.now(),
        payload,
      };

      io.to(session.hostSocketId).emit("session:input", event);

      let matchedBridgeCount = 0;
      session.bridges.forEach((bridgeState, bridgeId) => {
        if ((bridgeState?.playerIndex || 1) !== event.playerIndex) {
          return;
        }

        matchedBridgeCount += 1;
        io.to(bridgeId).emit("session:input", event);
      });

      if (matchedBridgeCount === 0 && session.controllers.size === 1 && session.bridges.size === 1) {
        const onlyBridgeId = session.bridges.keys().next().value;
        if (onlyBridgeId) {
          io.to(onlyBridgeId).emit("session:input", event);
        }
      }
    });

    socket.on("disconnect", () => {
      const { code, session } = getSessionFromSocket(socket);

      if (!session) {
        return;
      }

      if (socket.data.role === "host") {
        closeSession(code, "host_disconnected");
        return;
      }

      if (socket.data.role === "controller") {
        emitControllerDisconnected(session, socket, socket.data.playerIndex || null);
      }

      if (socket.data.role === "bridge") {
        emitBridgeDisconnected(
          session,
          socket,
          socket.data.bridgeName || "Bridge",
          socket.data.playerIndex || 1
        );
      }

      maybeCleanupStaleSession(code, session);
    });
  });

  async function start() {
    await new Promise((resolve) => {
      httpServer.listen(port, host, resolve);
    });

    const address = httpServer.address();
    const actualPort = typeof address === "string" ? port : address.port;

    return {
      port: actualPort,
      host,
      close: async () => {
        await new Promise((resolve) => io.close(() => resolve()));
        await new Promise((resolve) => httpServer.close(() => resolve()));
      },
    };
  }

  return {
    start,
  };
}

module.exports = {
  createAirServer,
};
