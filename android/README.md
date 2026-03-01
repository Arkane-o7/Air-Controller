# AirController Android App

Android client app that connects to the desktop host and sends controller inputs over WebSocket.

## Build prerequisites

- Android Studio (latest stable)
- **JDK 17+** (required by modern Android Gradle Plugin)
- Android SDK platform 35 and matching build-tools

## Reproducible build setup

This project now includes Gradle wrapper files:

- `gradlew`
- `gradlew.bat`
- `gradle/wrapper/gradle-wrapper.jar`
- `gradle/wrapper/gradle-wrapper.properties`

So you can build without a globally installed Gradle.

## Build commands

From `android/`:

- macOS/Linux: `./gradlew :app:assembleDebug --console=plain`
- Windows: `gradlew.bat :app:assembleDebug --console=plain`

## If build fails with Java/JDK errors

Typical error: `No Java compiler found`.

That means Java runtime is present but a full JDK is not configured.
Set `JAVA_HOME` to JDK 17+ and retry.

## What each Android part does

### `settings.gradle.kts`

- Defines project name and included modules (`:app`).
- Configures plugin repositories and dependency repositories.

### `build.gradle.kts` (top-level)

- Declares Android/Kotlin plugins via version catalog aliases.
- Keeps plugin versions centralized and consistent.

### `gradle/libs.versions.toml`

- Version catalog for plugin and dependency versions.
- Single source of truth for versions across modules.

### `app/build.gradle.kts`

- Android app module config:
  - namespace/applicationId
  - SDK targets
  - build types
  - Compose enablement
- Declares app dependencies (Compose, Nav, OkHttp, CameraX, ML Kit, etc.).

### `app/src/main/AndroidManifest.xml`

- Requests required permissions (network, camera, wake lock).
- Registers launch activity and deep-link intent filter:
  - `aircontroller://connect?...`

### `network/ConnectionParams.kt`

- Holds host connection params (`ip`, `port`, `code`).
- Parses deep-link URI payload into strongly typed params.

### `network/DiscoveryService.kt`

- Uses Android NSD (mDNS) to discover desktop host on LAN.
- Resolves service to IP/port and returns connect params.

### `network/WsClient.kt`

- Handles WebSocket lifecycle with desktop host.
- Sends `pair`, input messages (`button/stick/trigger/dpad`), and keepalive responses.
- Emits connection state for UI navigation and status text.

### `ui/MainActivity.kt`

- Entry point and Compose navigation host.
- Wires connection flow screens and transitions to controller screen after pairing.

### `ui/ConnectScreen.kt`

- First screen with two connection choices:
  - Scan QR
  - Enter 6-digit code

### `ui/ScanQrScreen.kt`

- CameraX + ML Kit QR scanner flow.
- Accepts deep-link and parses connection params.

### `ui/EnterCodeScreen.kt`

- Manual code entry flow.
- Runs LAN discovery and combines discovered host with entered pairing code.

### `ui/ControllerScreen.kt`

- Renders interactive virtual controller UI.
- Sends real-time control input events via `WsClient`.

### `controller/ControllerViewModel.kt`

- Adapts UI interactions to network send methods.
- Tracks server-assigned controller id + layout selection.

### `controller/LayoutDefinition.kt`

- Defines available visual/controller layouts (`xbox`, `simple`, `custom`).
- Maps server layout wire values to local layout model.

### `controller/components/*`

- Reusable Compose control widgets:
  - joystick
  - d-pad
  - game buttons
  - trigger sliders

## Runtime flow summary

1. Desktop host displays code + QR.
2. Android scans QR or discovers host + enters code.
3. Android opens WebSocket and sends `pair`.
4. Desktop replies `welcome` with controller slot + layout.
5. Android streams controller input messages continuously.

## Release process

### Website release (no Google Play developer account)

If users will download from your website, you do **not** need a Play Console developer account.

Fast path:

- Build release APK: `./gradlew :app:assembleRelease --console=plain`
- Output: `app/build/outputs/apk/release/*.apk`

Install notes for users:

- They must enable `Install unknown apps` for the browser/file manager used to install.
- APK updates must be signed with the same key each time.

CI option:

- Run `.github/workflows/release-android-website.yml` to generate uploadable APK artifacts without signing secrets.

For production shipping steps (desktop + Android), see:

- `../RELEASE.md`
