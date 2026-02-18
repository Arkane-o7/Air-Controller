# AIR Controller

Realtime phone-to-PC controller system inspired by VirtualGamePad.

## Included now

- Web host + mobile controller flow (session code based)
- Full control payload (D-pad, face buttons, triggers, bumpers, start/select, sticks, L3/R3)
- Host profile editor (no auth, saved to profile catalog)
- Keyboard bridge fallback
- Virtual gamepad bridge for Windows/Linux:
  - Xbox 360 emulation
  - DualShock 4 emulation
- Desktop app scaffold (Electron) for host + bridge control
- Mobile app scaffold (Expo) for installable phone client

## 1) Web mode (current root app)

```bash
npm install
npm run dev
```

Open:

- Host: `http://localhost:3000/host`
- Phone controller: `http://<host-lan-ip>:3000/controller`

### Connection methods in Host UI

Host page now supports two modes:

- `LAN (Same Wi-Fi)`: phone and PC stay on the same local network. Use this for lowest latency.
- `Public Relay (Cloud)`: phone can connect from any network using a public URL.

Host reads `/api/network` for defaults and can preload relay URL from:

```bash
AIR_PUBLIC_RELAY_ORIGIN=https://your-public-domain.example.com
```

Bridge commands shown on host now use the currently selected mode URL.

### Deploy Public Relay on Render

This repo includes `/render.yaml` for a Render Web Service deploy.

1. Push this repo to GitHub.
2. In Render: `New` -> `Blueprint`.
3. Select this repo and apply the blueprint.
4. After first deploy, copy your service URL (example: `https://air-controller-relay.onrender.com`).
5. In Render service env vars, set:
   - `AIR_PUBLIC_RELAY_ORIGIN=https://<your-render-domain>`
6. Redeploy once after setting the env var.

Then use in host:

- Open `/host`
- Select `Public Relay (Cloud)`
- Ensure relay URL is your Render URL
- Share generated join link / QR

Bridge example against relay:

```bash
npm run bridge:virtual -- --server https://<your-render-domain> --code ABC123 --device xbox
```

### Virtual bridge from CLI

First-time setup:

```bash
npm run bridge:install
```

Xbox 360 bridge:

```bash
npm run bridge:virtual -- --server http://localhost:3000 --code ABC123 --device xbox
```

DualShock 4 bridge:

```bash
npm run bridge:virtual -- --server http://localhost:3000 --code ABC123 --device ds4
```

Keyboard bridge:

```bash
npm run bridge:keyboard -- --server http://localhost:3000 --code ABC123
```

## 2) Desktop app (downloadable PC app)

Desktop app lives in `desktop-app` and embeds the AIR server + bridge launcher.
It includes the same LAN/Public Relay selector on `/host`.

### Run desktop app (dev)

```bash
cd desktop-app
npm install
npm run dev
```

Or from repo root:

```bash
npm run desktop:dev
```

### Build installers

Windows installer (NSIS):

```bash
cd desktop-app
npm run build:win
```

Linux package (AppImage):

```bash
cd desktop-app
npm run build:linux
```

Build output: `desktop-app/dist`

## 3) Mobile app (downloadable phone app)

Mobile app lives in `mobile-app` (Expo + WebView wrapper for `/controller`).

### Run mobile app in development

```bash
cd mobile-app
npm install
npm run start
```

Or from repo root:

```bash
npm run mobile:dev
```

### Build installable binaries (EAS)

Requirements:

- Expo account + EAS CLI (`npm i -g eas-cli`)
- Login once with `eas login`

Android build:

```bash
cd mobile-app
npm run build:android
```

iOS build:

```bash
cd mobile-app
npm run build:ios
```

## Bridge prerequisites (virtual gamepad)

### Windows

- Install ViGEmBus driver (required by `vgamepad`).

### Linux

```bash
sudo modprobe uinput
sudo modprobe uhid
```

- Ensure the bridge user can access `/dev/uinput`.

## Project structure

- `server.js`: root Express + Socket.IO broker
- `config/profiles.json`: root profile catalog
- `public/host.html`: host dashboard + profile editor
- `public/controller.html`: mobile control surface
- `bridge/`: root CLI bridge scripts
- `desktop-app/`: Electron app for PC distribution
- `mobile-app/`: Expo app for phone distribution
