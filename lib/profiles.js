const fs = require("fs");
const path = require("path");

const catalogPath = path.join(__dirname, "..", "config", "profiles.json");

const PROFILE_INPUTS = [
  "up",
  "down",
  "left",
  "right",
  "a",
  "b",
  "x",
  "y",
  "lb",
  "rb",
  "lt",
  "rt",
  "start",
  "select",
  "ls",
  "rs",
];

const PROFILE_INPUT_DEFINITIONS = [
  { id: "up", label: "D-Pad Up" },
  { id: "down", label: "D-Pad Down" },
  { id: "left", label: "D-Pad Left" },
  { id: "right", label: "D-Pad Right" },
  { id: "a", label: "Face A" },
  { id: "b", label: "Face B" },
  { id: "x", label: "Face X" },
  { id: "y", label: "Face Y" },
  { id: "lb", label: "Left Bumper" },
  { id: "rb", label: "Right Bumper" },
  { id: "lt", label: "Left Trigger" },
  { id: "rt", label: "Right Trigger" },
  { id: "start", label: "Start" },
  { id: "select", label: "Select/Back" },
  { id: "ls", label: "Left Stick Click (L3)" },
  { id: "rs", label: "Right Stick Click (R3)" },
];

const KEYBOARD_TOKEN_OPTIONS = [
  "",
  "up",
  "down",
  "left",
  "right",
  "space",
  "enter",
  "escape",
  "tab",
  "left_shift",
  "right_shift",
  "left_control",
  "right_control",
  "left_alt",
  "right_alt",
  "q",
  "w",
  "e",
  "r",
  "t",
  "y",
  "u",
  "i",
  "o",
  "p",
  "a",
  "s",
  "d",
  "f",
  "g",
  "h",
  "j",
  "k",
  "l",
  "z",
  "x",
  "c",
  "v",
  "b",
  "n",
  "m",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "0",
];

const VIRTUAL_ACTION_OPTIONS = [
  "",
  "south",
  "east",
  "west",
  "north",
  "lb",
  "rb",
  "lt",
  "rt",
  "start",
  "back",
  "ls",
  "rs",
  "dpad_up",
  "dpad_down",
  "dpad_left",
  "dpad_right",
];

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 42);
}

function normalizeText(value, fallback = "") {
  const result = String(value || "").trim();
  return result || fallback;
}

function normalizeKeyboardToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

function normalizeVirtualAction(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

function normalizeTokenList(candidate) {
  if (!candidate) {
    return [];
  }

  const source = Array.isArray(candidate) ? candidate : [candidate];
  const tokens = [];

  source.forEach((value) => {
    const token = normalizeKeyboardToken(value);
    if (token && !tokens.includes(token)) {
      tokens.push(token);
    }
  });

  return tokens;
}

function normalizeActionList(candidate) {
  if (!candidate) {
    return [];
  }

  const source = Array.isArray(candidate) ? candidate : [candidate];
  const actions = [];

  source.forEach((value) => {
    const action = normalizeVirtualAction(value);
    if (action && !actions.includes(action)) {
      actions.push(action);
    }
  });

  return actions;
}

function sanitizeKeyboardMap(candidate = {}) {
  const map = {};

  PROFILE_INPUTS.forEach((inputId) => {
    const tokens = normalizeTokenList(candidate[inputId]);

    if (tokens.length === 1) {
      map[inputId] = tokens[0];
    } else if (tokens.length > 1) {
      map[inputId] = tokens;
    }
  });

  return map;
}

function sanitizeVirtualMap(candidate = {}) {
  const map = {};

  PROFILE_INPUTS.forEach((inputId) => {
    const actions = normalizeActionList(candidate[inputId]);

    if (actions.length > 0) {
      map[inputId] = actions;
    }
  });

  return map;
}

function sanitizeLayout(layout = {}, fallbackId) {
  const id = normalizeId(layout.id || fallbackId || "layout");

  const panelOrderRaw = Array.isArray(layout.panelOrder) ? layout.panelOrder : ["stick", "action"];
  const panelOrder = [];
  panelOrderRaw.forEach((entry) => {
    const key = String(entry || "").trim().toLowerCase();
    if ((key === "stick" || key === "action") && !panelOrder.includes(key)) {
      panelOrder.push(key);
    }
  });

  if (!panelOrder.includes("stick")) {
    panelOrder.push("stick");
  }

  if (!panelOrder.includes("action")) {
    panelOrder.push("action");
  }

  const buttonGridRaw = Array.isArray(layout.buttonGrid) ? layout.buttonGrid : ["x", "y", "a", "b"];
  const buttonGrid = [];
  buttonGridRaw.forEach((entry) => {
    const key = String(entry || "").trim().toLowerCase();
    if (["a", "b", "x", "y"].includes(key) && !buttonGrid.includes(key)) {
      buttonGrid.push(key);
    }
  });

  ["x", "y", "a", "b"].forEach((idValue) => {
    if (!buttonGrid.includes(idValue)) {
      buttonGrid.push(idValue);
    }
  });

  const safeButtonLabels = {
    a: normalizeText(layout.buttonLabels?.a, "A"),
    b: normalizeText(layout.buttonLabels?.b, "B"),
    x: normalizeText(layout.buttonLabels?.x, "X"),
    y: normalizeText(layout.buttonLabels?.y, "Y"),
  };

  const safeDpadLabels = {
    up: normalizeText(layout.dpadLabels?.up, "UP"),
    down: normalizeText(layout.dpadLabels?.down, "DN"),
    left: normalizeText(layout.dpadLabels?.left, "LT"),
    right: normalizeText(layout.dpadLabels?.right, "RT"),
  };

  const safeUtilityLabels = {
    lb: normalizeText(layout.utilityLabels?.lb, "LB"),
    rb: normalizeText(layout.utilityLabels?.rb, "RB"),
    lt: normalizeText(layout.utilityLabels?.lt, "LT"),
    rt: normalizeText(layout.utilityLabels?.rt, "RT"),
    start: normalizeText(layout.utilityLabels?.start, "START"),
    select: normalizeText(layout.utilityLabels?.select, "SELECT"),
    ls: normalizeText(layout.utilityLabels?.ls, "L3"),
    rs: normalizeText(layout.utilityLabels?.rs, "R3"),
  };

  return {
    id,
    name: normalizeText(layout.name, id.toUpperCase()),
    description: normalizeText(layout.description, "Custom layout"),
    panelOrder,
    buttonGrid,
    buttonLabels: safeButtonLabels,
    dpadLabels: safeDpadLabels,
    utilityLabels: safeUtilityLabels,
  };
}

function sanitizeGameProfile(profile = {}, fallbackId) {
  const id = normalizeId(profile.id || fallbackId || "profile");

  return {
    id,
    name: normalizeText(profile.name, id.toUpperCase()),
    description: normalizeText(profile.description, "Custom profile"),
    keyboardMap: sanitizeKeyboardMap(profile.keyboardMap || {}),
    virtualMap: sanitizeVirtualMap(profile.virtualMap || {}),
  };
}

function sanitizeCatalog(raw = {}) {
  const sourceProfiles = Array.isArray(raw.gameProfiles) ? raw.gameProfiles : [];
  const sourceLayouts = Array.isArray(raw.layouts) ? raw.layouts : [];

  const gameProfiles = [];
  const seenProfileIds = new Set();

  sourceProfiles.forEach((profile, index) => {
    const sanitized = sanitizeGameProfile(profile, `profile_${index + 1}`);

    if (!sanitized.id || seenProfileIds.has(sanitized.id)) {
      return;
    }

    seenProfileIds.add(sanitized.id);
    gameProfiles.push(sanitized);
  });

  if (gameProfiles.length === 0) {
    gameProfiles.push(
      sanitizeGameProfile(
        {
          id: "platformer",
          name: "Platformer",
          description: "Default profile",
          keyboardMap: {
            left: "left",
            right: "right",
            up: "up",
            down: "down",
            a: "space",
            b: "left_shift",
            x: "z",
            y: "x",
          },
          virtualMap: {
            left: ["dpad_left"],
            right: ["dpad_right"],
            up: ["dpad_up"],
            down: ["dpad_down"],
            a: ["south"],
            b: ["east"],
            x: ["west"],
            y: ["north"],
          },
        },
        "platformer"
      )
    );
  }

  const layouts = [];
  const seenLayoutIds = new Set();

  sourceLayouts.forEach((layout, index) => {
    const sanitized = sanitizeLayout(layout, `layout_${index + 1}`);

    if (!sanitized.id || seenLayoutIds.has(sanitized.id)) {
      return;
    }

    seenLayoutIds.add(sanitized.id);
    layouts.push(sanitized);
  });

  if (layouts.length === 0) {
    layouts.push(
      sanitizeLayout(
        {
          id: "balanced",
          name: "Balanced",
          description: "Default layout",
          panelOrder: ["stick", "action"],
          buttonGrid: ["x", "y", "a", "b"],
        },
        "balanced"
      )
    );
  }

  const defaultGameProfileId = normalizeId(raw.defaults?.gameProfileId);
  const defaultLayoutId = normalizeId(raw.defaults?.layoutId);

  const gameProfileIds = new Set(gameProfiles.map((entry) => entry.id));
  const layoutIds = new Set(layouts.map((entry) => entry.id));

  return {
    defaults: {
      gameProfileId: gameProfileIds.has(defaultGameProfileId) ? defaultGameProfileId : gameProfiles[0].id,
      layoutId: layoutIds.has(defaultLayoutId) ? defaultLayoutId : layouts[0].id,
    },
    gameProfiles,
    layouts,
  };
}

function readCatalogFromDisk() {
  try {
    const raw = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    return sanitizeCatalog(raw);
  } catch (error) {
    return sanitizeCatalog({});
  }
}

let catalog = readCatalogFromDisk();

function persistCatalog() {
  const serialized = JSON.stringify(catalog, null, 2);
  fs.writeFileSync(catalogPath, `${serialized}\n`, "utf8");
}

function getCatalogSnapshot() {
  return deepClone(catalog);
}

function buildProfileMap() {
  return new Map(catalog.gameProfiles.map((profile) => [profile.id, profile]));
}

function buildLayoutMap() {
  return new Map(catalog.layouts.map((layout) => [layout.id, layout]));
}

function resolveGameProfileId(value) {
  const id = normalizeId(value);
  const profileMap = buildProfileMap();
  return profileMap.has(id) ? id : catalog.defaults.gameProfileId;
}

function resolveLayoutId(value) {
  const id = normalizeId(value);
  const layoutMap = buildLayoutMap();
  return layoutMap.has(id) ? id : catalog.defaults.layoutId;
}

function resolveSessionConfig(candidate = {}) {
  return {
    gameProfileId: resolveGameProfileId(candidate.gameProfileId),
    layoutId: resolveLayoutId(candidate.layoutId),
  };
}

function getGameProfile(profileId) {
  const resolvedId = resolveGameProfileId(profileId);
  const profile = buildProfileMap().get(resolvedId);
  return profile ? deepClone(profile) : null;
}

function getLayout(layoutId) {
  const resolvedId = resolveLayoutId(layoutId);
  const layout = buildLayoutMap().get(resolvedId);
  return layout ? deepClone(layout) : null;
}

function getClientProfiles() {
  return {
    defaults: deepClone(catalog.defaults),
    gameProfiles: catalog.gameProfiles.map(({ id, name, description }) => ({
      id,
      name,
      description,
    })),
    layouts: catalog.layouts.map(({ id, name, description, panelOrder, buttonGrid, buttonLabels, dpadLabels, utilityLabels }) => ({
      id,
      name,
      description,
      panelOrder: deepClone(panelOrder),
      buttonGrid: deepClone(buttonGrid),
      buttonLabels: deepClone(buttonLabels),
      dpadLabels: deepClone(dpadLabels),
      utilityLabels: deepClone(utilityLabels),
    })),
  };
}

function getEditorOptions() {
  return {
    inputs: deepClone(PROFILE_INPUT_DEFINITIONS),
    keyboardTokens: deepClone(KEYBOARD_TOKEN_OPTIONS),
    virtualActions: deepClone(VIRTUAL_ACTION_OPTIONS),
  };
}

function getProfileEditorPayload() {
  return {
    catalog: getCatalogSnapshot(),
    options: getEditorOptions(),
  };
}

function upsertGameProfile(rawProfile = {}, mode = "update") {
  const sanitized = sanitizeGameProfile(rawProfile, rawProfile.id || "profile");

  if (!sanitized.id) {
    throw new Error("INVALID_PROFILE_ID");
  }

  const existingIndex = catalog.gameProfiles.findIndex((entry) => entry.id === sanitized.id);

  if (mode === "create" && existingIndex >= 0) {
    throw new Error("PROFILE_EXISTS");
  }

  if (mode === "update" && existingIndex < 0) {
    throw new Error("PROFILE_NOT_FOUND");
  }

  if (existingIndex >= 0) {
    catalog.gameProfiles[existingIndex] = sanitized;
  } else {
    catalog.gameProfiles.push(sanitized);
  }

  catalog = sanitizeCatalog(catalog);
  persistCatalog();

  return deepClone(sanitized);
}

function deleteGameProfile(profileId) {
  const id = normalizeId(profileId);

  const existingIndex = catalog.gameProfiles.findIndex((entry) => entry.id === id);

  if (existingIndex < 0) {
    throw new Error("PROFILE_NOT_FOUND");
  }

  if (catalog.gameProfiles.length === 1) {
    throw new Error("LAST_PROFILE");
  }

  catalog.gameProfiles.splice(existingIndex, 1);

  if (!catalog.gameProfiles.some((profile) => profile.id === catalog.defaults.gameProfileId)) {
    catalog.defaults.gameProfileId = catalog.gameProfiles[0].id;
  }

  catalog = sanitizeCatalog(catalog);
  persistCatalog();

  return getCatalogSnapshot();
}

module.exports = {
  PROFILE_INPUTS,
  getCatalogSnapshot,
  getClientProfiles,
  getEditorOptions,
  getGameProfile,
  getLayout,
  getProfileEditorPayload,
  resolveGameProfileId,
  resolveLayoutId,
  resolveSessionConfig,
  upsertGameProfile,
  deleteGameProfile,
};
