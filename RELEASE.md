# AirController Final Release Runbook

This runbook describes everything required to ship production artifacts for desktop and Android.

## 1) Versioning and tags

1. Update versions:
   - `desktop/package.json` → `version`
   - `android/app/build.gradle.kts` → `versionCode`, `versionName`
2. Commit changes.
3. Create release tag:
   - `v<version>` (example: `v1.0.0`)

Tag pushes automatically trigger the GitHub Release publish workflow.

## 2) Desktop release prerequisites (Windows)

### Required for full controller mode

Place this file before packaging:

- `desktop/build/prereqs/ViGEmBus_Setup_x64.exe`

If missing, setup still installs app but skips automatic driver setup.

### Optional CI auto-download

In manual workflow runs (`workflow_dispatch`), pass:

- `vigem_installer_url` (optional)

If provided, workflow downloads the installer into `desktop/build/prereqs/`.

### Strict mode (optional)

In manual workflow runs, set:

- `require_vigem_installer = true`

This makes desktop preflight fail if `ViGEmBus_Setup_x64.exe` is missing.

For tag-triggered releases (`push` on `v*`), strict mode is always enabled.

## 3) Android release prerequisites

Set GitHub secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_SIGNING_STORE_PASSWORD`
- `ANDROID_SIGNING_KEY_ALIAS`
- `ANDROID_SIGNING_KEY_PASSWORD`

`ANDROID_KEYSTORE_BASE64` is your release keystore file encoded with base64.

For local builds, copy `.env.example` to `.env` and fill the same values.

### No Google Play developer account (website distribution)

If you distribute from your own website, a Play Console account is **not required**.

Use one of these options:

- **CI website APK path (recommended quick path):** run `.github/workflows/release-android-website.yml`
  - Produces `android/app/build/outputs/apk/release/*.apk`
  - Does not require Android signing secrets in GitHub
- **Local self-signed path:** generate your own keystore and provide the same env vars used above

Notes:

- Android users must enable sideloading (`Install unknown apps`) for the browser/file manager used to install.
- Keep the same signing key for all future updates, or installs will fail as "incompatible signature".

## 4) Local release commands

### Desktop

From `desktop/`:

- `npm ci`
- `npm run release:verify`
- `npm run release:win`

Artifacts:

- `desktop/dist/*setup.exe`
- `desktop/dist/win-unpacked/`

### Android

From `android/` with JDK 17+ configured:

- `./gradlew :app:assembleRelease :app:bundleRelease -PrequireReleaseSigning=true --console=plain`

Artifacts:

- `android/app/build/outputs/apk/release/*.apk`
- `android/app/build/outputs/bundle/release/*.aab`

Website-only APK command (no Play account required):

- `./gradlew :app:assembleRelease --console=plain`

Website APK artifact:

- `android/app/build/outputs/apk/release/*.apk`

## 5) GitHub Actions workflows

- `.github/workflows/release-github.yml`
  - Trigger: `push` on `v*` tags.
  - Calls desktop + Android reusable workflows.
  - Publishes downloadable assets to the GitHub Release page:
    - Windows setup `.exe`
    - Android `.apk`
    - Android `.aab`
- `.github/workflows/release-desktop.yml`
  - Reusable/manual desktop build workflow.
  - Builds and uploads Windows setup/unpacked artifacts.
  - Enforces desktop preflight checks.
- `.github/workflows/release-android.yml`
  - Reusable/manual Android signed build workflow.
  - Builds signed Android release APK + AAB.
  - Fails fast if signing secrets are missing.
- `.github/workflows/release-android-website.yml`
  - Manual/reusable APK workflow for website sideload distribution.
  - No Play developer account or GitHub signing secrets required.

## 6) Final QA checklist

- Desktop pairing via QR and manual code both pass.
- Multi-controller pairing and slot assignment verified (P1..P4).
- ViGEm bridge status is `enabled` on Windows.
- Installer runs ViGEm driver setup and logs success.
- Android connects and streams inputs without disconnect loops.
- Release artifacts generated and attached to release.

## 7) Go/No-Go criteria

Go only if:

- Desktop `release:verify` passes.
- Desktop Windows setup `.exe` is generated.
- Android signed APK and AAB are generated.
- QA checklist passes on target devices.
