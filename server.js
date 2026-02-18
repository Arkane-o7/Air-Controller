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
  upsertGameProfile,
  deleteGameProfile,
} = require("./lib/profiles");

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

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

function listLanOrigins(port) {
  const origins = new Set();
  const interfaces = os.networkInterfaces();

  Object.values(interfaces).forEach((group) => {
    (group || []).forEach((entry) => {
      if (!entry || entry.internal || entry.family !== "IPv4") {
        return;
      }

      origins.add(`http://${entry.address}:${port}`);
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

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/host", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "host.html"));
});

app.get("/controller", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "controller.html"));
});

app.get("/api/profiles", (_req, res) => {
  res.json(getClientProfiles());
});

app.get("/api/profiles/editor", (_req, res) => {
  res.json(getProfileEditorPayload());
});

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

app.get("/api/network", (req, res) => {
  const requestPort = Number(req.socket?.localPort || PORT || 3000);
  const serverOrigin = resolveRequestOrigin(req, requestPort);
  const lanOrigins = listLanOrigins(requestPort);
  const relayDefaultOrigin = String(process.env.AIR_PUBLIC_RELAY_ORIGIN || "")
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

server.listen(PORT, () => {
  console.log(`AIR Controller running on http://localhost:${PORT}`);
});
