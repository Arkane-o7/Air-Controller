# ViGEm Installer Bundle

Place the ViGEmBus setup executable in this folder as:

- `ViGEmBus_Setup.exe`

Then build Windows artifacts with:

- `npm run dist:win`

Alternatively, point to the installer path dynamically:

- `VIGEM_SETUP_PATH=C:\path\to\ViGEmBus_*.exe npm run dist:win`

During NSIS setup, AirController will attempt to run this installer silently.
