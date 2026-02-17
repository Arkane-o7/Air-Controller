const path = require("path");
const http = require("http");
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
      const previous = getSessionFromSocket(socket);

      if (socket.data.role === "host" && previous.session) {
        closeSession(previous.code, "host_new_session");
      }

      const code = createSessionCode();
      const config = resolveSessionConfig(payload.config || payload);

      sessions.set(code, {
        hostSocketId: socket.id,
        controllers: new Set(),
        bridges: new Set(),
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

      session.controllers.add(socket.id);
      socket.join(`session:${code}`);
      socket.data.role = "controller";
      socket.data.sessionCode = code;

      io.to(session.hostSocketId).emit("session:controller-connected", {
        controllerId: socket.id,
        count: session.controllers.size,
      });

      ack({ ok: true, ...buildConfigPayload(code, session.config) });
    });

    socket.on("bridge:join-session", (payload = {}, ack = () => {}) => {
      const code = normalizeCode(payload.code);
      const session = sessions.get(code);

      if (!session) {
        ack({ ok: false, error: "SESSION_NOT_FOUND" });
        return;
      }

      session.bridges.add(socket.id);
      socket.join(`session:${code}`);
      socket.data.role = "bridge";
      socket.data.sessionCode = code;
      socket.data.bridgeName = String(payload.name || "Bridge").slice(0, 40);

      io.to(session.hostSocketId).emit("session:bridge-connected", {
        bridgeId: socket.id,
        name: socket.data.bridgeName,
        count: session.bridges.size,
      });

      ack({ ok: true, ...buildConfigPayload(code, session.config) });
    });

    socket.on("controller:input", (payload = {}) => {
      const { session } = getSessionFromSocket(socket);

      if (!session || socket.data.role !== "controller") {
        return;
      }

      const event = {
        controllerId: socket.id,
        at: Date.now(),
        payload,
      };

      io.to(session.hostSocketId).emit("session:input", event);

      session.bridges.forEach((bridgeId) => {
        io.to(bridgeId).emit("session:input", event);
      });
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
        session.controllers.delete(socket.id);
        io.to(session.hostSocketId).emit("session:controller-disconnected", {
          controllerId: socket.id,
          count: session.controllers.size,
        });
      }

      if (socket.data.role === "bridge") {
        session.bridges.delete(socket.id);
        io.to(session.hostSocketId).emit("session:bridge-disconnected", {
          bridgeId: socket.id,
          name: socket.data.bridgeName || "Bridge",
          count: session.bridges.size,
        });
      }

      if (
        session.controllers.size === 0 &&
        session.bridges.size === 0 &&
        Date.now() - session.createdAt > 1000 * 60 * 20
      ) {
        sessions.delete(code);
      }
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
