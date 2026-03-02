# Install AirController on Windows

This guide explains how end users install and run the Windows host app.

## What gets installed

- **AirController desktop app** (Electron)
- **ViGEmBus driver** (required for virtual Xbox controller emulation)

## Prerequisites

- Windows 10/11 (x64)
- Admin rights (required by driver installer)
- Phone and PC on the same network

## 1) Download installer

Download the latest setup artifact from Releases:

- `AirController-<version>-x64.exe`

(Portable build may also be available, but the setup `.exe` is recommended.)

## 2) Run setup

1. Double-click the installer.
2. Choose installation directory.
3. Finish install.

The installer attempts to run bundled **ViGEmBus** setup silently.

## 3) If ViGEm did not install automatically

If setup shows a driver warning or controls do not work:

1. Download ViGEmBus manually from the official release page.
2. Install it.
3. Restart AirController.

## 4) Launch AirController

Open AirController from Start Menu or Desktop shortcut.

In the app:

1. Click **Start Server**.
2. Confirm server status becomes **Running**.
3. Confirm QR + pair code are visible.

## 5) Connect phone controller

1. Open phone camera and scan the QR.
2. Or open copied Pair Join URL manually on phone.
3. Wait for dashboard to show connected player slot.

## 6) Start playing

Once connected, game input from phone is bridged to the virtual Xbox controller.

---

## Troubleshooting

### "Start blocked: secure transport required"

The app requires TLS certificates unless dev fallback is enabled.

Expected cert files:

- `src/node-server/ssl/key.pem`
- `src/node-server/ssl/cert.pem`

For development only, fallback can be enabled with:

- `ALLOW_HTTP_FALLBACK=1`

### Phone connects but controller not active

- Verify ViGEmBus is installed.
- Verify pairing code is valid.
- Verify phone and PC are on same LAN.
- Verify firewall allows AirController traffic.

### QR scans but page won’t load

- Confirm server is running.
- Confirm displayed IP is reachable from phone.
- Retry using copied Pair Join URL directly in browser.

---

## Notes for release builds

- Keep SSL bypass disabled in production Android build.
- Build Windows artifacts on Windows host for full driver compatibility.
- Include ViGEm installer in:
  - `src/node-server/electron/resources/vigem/ViGEmBus_Setup.exe`
