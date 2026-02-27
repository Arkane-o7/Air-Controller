; AirController NSIS custom install hooks
; Runs bundled ViGEmBus driver installer (if present) during setup.

!macro customInstall
  ${If} ${FileExists} "$INSTDIR\resources\prereqs\ViGEmBus_Setup_x64.exe"
    DetailPrint "Installing ViGEm Bus Driver (required for virtual gamepad mode)..."
    ExecWait '"$INSTDIR\resources\prereqs\ViGEmBus_Setup_x64.exe"'
  ${Else}
    DetailPrint "ViGEm installer not bundled. Skipping driver prerequisite install."
  ${EndIf}
!macroend
