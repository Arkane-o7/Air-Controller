; AirController NSIS custom install hooks
; Runs bundled ViGEmBus driver installer (if present) during setup.

!macro customInstall
  ${If} ${FileExists} "$INSTDIR\resources\prereqs\ViGEmBus_Setup_x64.exe"
    DetailPrint "Installing ViGEm Bus Driver (required for virtual gamepad mode)..."
    DetailPrint "Running ViGEm installer silently..."
    ExecWait '"$INSTDIR\resources\prereqs\ViGEmBus_Setup_x64.exe" /quiet /norestart' $0
    ${If} $0 != 0
      DetailPrint "Silent ViGEm installation failed with code $0, retrying interactive install..."
      ExecWait '"$INSTDIR\resources\prereqs\ViGEmBus_Setup_x64.exe"' $0
    ${EndIf}
    ${If} $0 != 0
      DetailPrint "ViGEm driver installer exited with code $0"
      MessageBox MB_ICONEXCLAMATION|MB_OK "AirController installed, but ViGEm driver setup did not complete (exit code $0). Virtual gamepad mode may not work until you install ViGEmBus manually."
    ${Else}
      DetailPrint "ViGEm driver installation completed successfully."
    ${EndIf}
  ${Else}
    DetailPrint "ViGEm installer not bundled. Skipping driver prerequisite install."
  ${EndIf}
!macroend
