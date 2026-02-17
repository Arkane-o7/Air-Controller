# Monorepo Import Status

This repository now contains the full VirtualGamePad codebase split previously across multiple repos:

- Website/docs: repository root (`README.md`, `FAQ.md`, `assets/`, etc.)
- Android app client: `VirtualGamePad-Mobile/`
- PC server app (Windows/Linux): `VirtualGamePad-PC/`
- Shared protocol/data-exchange module: `VGP_Data_Exchange/`

## Included Dependencies

The following upstream submodule dependencies are vendored in-tree so the repo is self-contained:

- `VirtualGamePad-Mobile/VGP_Data_Exchange/`
- `VirtualGamePad-PC/VGP_Data_Exchange/`
- `VirtualGamePad-PC/third-party-libs/QR-Code-generator/`
- `VirtualGamePad-PC/doxygen-awesome-css/`

Nested `.git` directories from imported repos were removed from the workspace so the root repository can track all source files directly.

## Local Validation (macOS)

- Confirmed all major components and vendored dependencies are present.
- Website build completed successfully with `bundle exec jekyll build`.
- Android build completed successfully with `./gradlew assembleDebug`.
- PC server build is intentionally skipped on macOS because upstream CMake supports Linux/Windows only.

Use these scripts:

```bash
./scripts/validate_workspace.sh
./scripts/sync_data_exchange.sh
./scripts/build_website.sh
./scripts/build_android.sh
./scripts/build_pc.sh
# or all-in-one:
./scripts/build_all.sh
```

`scripts/sync_data_exchange.sh` keeps the shared protocol code in sync from `VGP_Data_Exchange/` into the mobile and PC module copies.

## CI Validation (Monorepo Root)

Root-level GitHub workflows now validate each surface in this monorepo:

- Website: `.github/workflows/website.yml`
- Android app: `.github/workflows/android.yml`
- PC server (Linux + Windows matrix): `.github/workflows/pc-server.yml`

## Toolchain Notes

- Website scripts prefer Homebrew Ruby when present.
- Android scripts prefer Homebrew OpenJDK 17 and Android command-line SDK paths when present.
- PC server scripts build only on Linux/Windows by design.

## Manual Build Commands

If you want to run builds manually instead of scripts:

```bash
# Website
bundle install
bundle exec jekyll build

# Android
cd VirtualGamePad-Mobile
./gradlew assembleDebug

# PC server (Linux example)
cd ../VirtualGamePad-PC
cmake --preset linux
cmake --build build-linux --config Release
```

## Licensing Note

Upstream projects are GPLv3-licensed. Keep license notices and attribution files when rebranding/distributing derivatives.
