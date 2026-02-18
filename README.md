# AIR Controller

Turn your phone into a game controller for your laptop/PC.

AIR Controller supports two connection methods:
- `LAN (Same Wi-Fi)` for lowest latency
- `Public Relay (Cloud)` for remote play across different networks

It can output controller input as:
- Virtual `Xbox 360` controller
- Virtual `DualShock 4` controller
- Keyboard input fallback

## What You Get

- Web host dashboard (`/host`) with session code + QR
- Web/mobile controller client (`/controller`)
- Desktop app (Windows/Linux) with built-in host + bridge controls
- Mobile app (Android/iOS via Expo project)
- Profile editor for custom button mapping
- Cloud relay deploy blueprint for Render (`render.yaml`)

## Architecture

Phone app/browser sends input -> AIR server (LAN or cloud relay) -> Host + Bridge receive events -> Bridge injects virtual gamepad/keyboard into OS.

## Requirements

### Core

- Node.js `20+`
- npm `9+`

### Virtual gamepad bridge (Xbox/DS4)

- Python `3.10+` (auto-venv setup is supported)

Windows:
- Install `ViGEmBus` driver (required by `vgamepad`)

Linux:
- Enable input modules:

```bash
sudo modprobe uinput
sudo modprobe uhid
```

- Ensure your user can access `/dev/uinput`

### Mobile build (optional)

- Expo/EAS account if building installable APK/IPA yourself

## Quick Start (LAN, No Cloud)

1. Install and run server:

```bash
npm install
npm run dev
```

2. On your laptop/PC, open:
- Host dashboard: `http://localhost:3000/host`

3. In Host, keep mode as `LAN (Same Wi-Fi)`.

4. On your phone (same Wi-Fi), open controller:
- `http://<your-pc-lan-ip>:3000/controller`
- Or scan the QR from Host

5. Enter/join the 6-character session code.

6. Start a bridge (for game input on PC):

```bash
npm run bridge:install
npm run bridge:virtual -- --server http://localhost:3000 --code ABC123 --device xbox
```

Use `--device ds4` for DualShock 4.

## Quick Start (Public Relay on Render)

Use this if phone and PC are on different networks.

1. Deploy this repo to Render via Blueprint (`render.yaml`).
2. Set env var in Render service:

```bash
AIR_PUBLIC_RELAY_ORIGIN=https://<your-render-domain>
```

3. Open host page on relay:
- `https://<your-render-domain>/host`

4. In Host, select `Public Relay (Cloud)`.

5. Join from phone using generated link/QR.

6. Run bridge on your PC against relay URL:

```bash
npm run bridge:virtual -- --server https://<your-render-domain> --code ABC123 --device xbox
```

## Deploy Relay to Render (Detailed)

This repo contains `/render.yaml` for one-click setup.

1. Push repo to GitHub.
2. In Render: `New` -> `Blueprint`.
3. Select this repo and deploy.
4. After first deploy, copy service URL.
5. Add env var in Render service settings:
   - `AIR_PUBLIC_RELAY_ORIGIN=https://<your-render-domain>`
6. Redeploy once.
7. Confirm health endpoint:
   - `https://<your-render-domain>/healthz` should return `ok`

## Using Downloadable Software (Releases)

From GitHub Releases, download:
- Windows: `*.exe` installer
- Linux: `*.AppImage`
- Android: `AIR-Controller-android-release.apk`

Notes:
- `*.blockmap` is updater metadata, not a user installer.
- Source code archives are just code, not runnable app binaries.

### Desktop app flow

1. Install/run desktop app.
2. Click `Open Host Dashboard`.
3. Create a session on Host and share code/QR.
4. In desktop app bridge panel:
   - Enter session code
   - Choose `Virtual Xbox 360`, `Virtual DualShock 4`, or `Keyboard bridge`
   - Keep server URL as local for LAN, or use relay URL for cloud
5. Click `Start Bridge`.

### Android app flow

1. Install APK.
2. Enter Desktop/Relay URL in app.
3. Tap `Open Controller`.
4. Join session code from Host.

## Run Everything From Source

## 1) Root web app

```bash
npm install
npm run dev
```

Open:
- `http://localhost:3000/` (landing)
- `http://localhost:3000/host`
- `http://localhost:3000/controller`

## 2) Desktop app (dev)

```bash
cd desktop-app
npm install
npm run dev
```

Or from repo root:

```bash
npm run desktop:dev
```

### Build desktop installers

Windows:

```bash
npm run desktop:build:win
```

Linux:

```bash
npm run desktop:build:linux
```

Output: `desktop-app/dist`

## 3) Mobile app (dev)

```bash
cd mobile-app
npm install
npm run start
```

Or from repo root:

```bash
npm run mobile:dev
```

### Build installable mobile binaries (EAS)

Android:

```bash
npm run mobile:build:android
```

iOS:

```bash
npm run mobile:build:ios
```

## Bridge Modes

## Virtual gamepad bridge (Xbox/DS4)

First-time setup:

```bash
npm run bridge:install
```

Xbox:

```bash
npm run bridge:virtual -- --server <SERVER_URL> --code <SESSION_CODE> --device xbox
```

DualShock 4:

```bash
npm run bridge:virtual -- --server <SERVER_URL> --code <SESSION_CODE> --device ds4
```

Dry-run test (no injection):

```bash
npm run bridge:virtual -- --server <SERVER_URL> --code <SESSION_CODE> --device xbox --dry-run
```

Useful launcher flags:
- `--setup-only`
- `--no-auto-setup`

## Keyboard bridge

```bash
npm run bridge:keyboard -- --server <SERVER_URL> --code <SESSION_CODE>
```

Useful flags:
- `--profile <id>` (lock to mapping profile)
- `--name <label>`
- `--dry-run`

## Environment Variables

Server:
- `PORT` (default: `3000`)
- `AIR_PUBLIC_RELAY_ORIGIN` (optional relay default shown in Host)

Bridge (keyboard/virtual):
- `AIR_CONTROLLER_SERVER`
- `AIR_CONTROLLER_CODE`
- `AIR_CONTROLLER_PROFILE`
- `AIR_CONTROLLER_BRIDGE_NAME`
- `AIR_CONTROLLER_DRY_RUN` (`1` for true)
- `AIR_CONTROLLER_VIRTUAL_DEVICE` (`xbox` or `ds4`, virtual bridge)

## Security Notes

- No authentication is enabled right now.
- Session code is the only gate.
- For public relay deployments:
  - use HTTPS
  - do not expose private/internal services
  - rotate sessions frequently

## Troubleshooting

### Phone app shows "Unable to load script" (React Native red screen)

That usually means a debug build is running without Metro.

Fix:
- Use release APK from GitHub Releases, or
- Start Metro in mobile-app project for debug builds:

```bash
cd mobile-app
npx expo start
```

### Virtual bridge fails to initialize

Windows:
- Install/reinstall ViGEmBus and reboot

Linux:
- Ensure `uinput` loaded and accessible:

```bash
sudo modprobe uinput
ls -l /dev/uinput
```

### Release has only source code assets

The release asset workflow may still be running.
Check Actions for `Build Release Assets` and wait for completion.

## Project Layout

- `server.js` - root Express + Socket.IO server
- `public/host.html` - host dashboard + profile editor + LAN/Relay mode selector
- `public/controller.html` - phone controller UI
- `bridge/` - keyboard + virtual bridge launchers
- `config/profiles.json` - profiles/layout catalog
- `desktop-app/` - Electron desktop app
- `mobile-app/` - Expo mobile app
- `render.yaml` - Render Blueprint for cloud relay deployment

## License

MIT
