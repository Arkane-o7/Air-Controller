# AirController Desktop Host

Electron + React host application that runs on your laptop/PC and accepts Android controller connections via WebSocket.

## What it does now

- Runs a WebSocket host on port `8765`
- Generates a 6-digit pairing code
- Generates QR deep-link:
  - `aircontroller://connect?ip=<IP>&port=8765&code=<CODE>`
- Publishes `_aircontroller._tcp` via mDNS for phone discovery
- Accepts up to 4 simultaneous controller clients
- Shows connected controller slots and input activity
- Supports runtime layout switch (`xbox`, `simple`, `custom`)
- Forwards controller input to virtual Xbox gamepads on Windows via ViGEm

## Quick start

1. Install dependencies
	- `npm install`
2. Run in development mode
	- `npm run dev`
3. Open Android app and connect via:
	- QR scanner, or
	- 6-digit code + network discovery

## Build installers

- Windows: `npm run build:win`

## Project structure (desktop)

- `src/main/` → Electron main process + host server
- `src/preload/` → secure renderer bridge
- `src/renderer/` → React dashboard UI
- `src/shared/` → protocol and shared types

## What each part does (detailed)

### `src/main/index.ts`

- Bootstraps Electron app lifecycle.
- Starts `HostServer` when app is ready.
- Registers IPC endpoints used by renderer:
	- `host:get-state`
	- `host:regenerate-code`
	- `host:set-layout`
- Pushes live host state updates to renderer (`host:state`).

### `src/main/hostServer.ts`

- Owns networking and pairing orchestration.
- Runs WebSocket server on `8765`.
- Handles protocol lifecycle:
	- accept socket
	- require `pair` message
	- validate 6-digit code
	- assign controller slot `P1..P4`
	- stream control input
- Generates deep link and QR payload for mobile onboarding.
- Publishes mDNS service `_aircontroller._tcp` for LAN discovery.
- Maintains state snapshots (controllers, events, setup diagnostics).

### `src/main/vigemBridge.ts`

- Encapsulates virtual controller passthrough.
- Windows only:
	- loads `vigemclient`
	- connects to ViGEm bus
	- creates one virtual Xbox controller per connected slot
	- maps protocol input to axis/button state
- Non-Windows:
	- safe no-op mode
	- keeps pairing and telemetry working without passthrough

### `src/preload/index.ts`

- Exposes a minimal, typed API to renderer (`window.aircontroller`).
- Keeps Electron security boundaries intact (no broad Node access in renderer).

### `src/renderer/src/App.tsx`

- Shows operator dashboard:
	- pairing code
	- QR deep-link
	- endpoint details
	- virtual gamepad backend status
	- setup diagnostics (required/optional checks)
	- connected controller slots
	- event stream
- Allows layout switching and pairing code regeneration.

### `src/shared/protocol.ts`

- Single source of truth for wire and state typing:
	- message contracts
	- host snapshot types
	- bridge API types
- Keeps main/preload/renderer in sync.

### `build/installer.nsh`

- Custom NSIS install hook for Windows setup.
- Detects bundled ViGEm installer and executes it during app installation.
- Reports non-zero installer exit code to user with a warning.

## Notes

- Windows requires the ViGEm bus driver for virtual controller output.
- On macOS/Linux, pairing and telemetry still work, but gamepad passthrough is intentionally disabled.
- For auto driver install in Windows setup, include:
	- `build/prereqs/ViGEmBus_Setup_x64.exe`
- Final shipping process is documented in:
  - `../RELEASE.md`
