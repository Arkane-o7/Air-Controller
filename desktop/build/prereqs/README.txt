Place prerequisite installers in this folder before packaging.

Required for full gamepad mode:
- ViGEmBus_Setup_x64.exe

During installer build, files in this folder are copied to:
resources/prereqs/

The NSIS setup script will auto-run ViGEmBus_Setup_x64.exe if present.
