!macro customInstall
  DetailPrint "Checking bundled ViGEm installer..."
  IfFileExists "$INSTDIR\\resources\\vigem\\ViGEmBus_Setup.exe" +2 0
    Goto skipVigemInstall

  DetailPrint "Installing ViGEmBus driver..."
  ExecWait '"$INSTDIR\\resources\\vigem\\ViGEmBus_Setup.exe" /qn' $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "ViGEmBus installer returned code $0. You may need to install ViGEm manually."
  ${EndIf}

skipVigemInstall:
!macroend
