!macro customInstall
  DetailPrint "Starting the Xprinter 2-in-1 driver setup..."
  ExecWait '"$INSTDIR\resources\xprinter-driver\Xprinter_2024.2_M-1.exe" /x "$PLUGINSDIR\TruePOS-Xprinter-Driver" /i' $0

  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "TruePOS was installed, but the Xprinter driver setup did not finish.$\r$\n$\r$\nConnect and power on the printer, then run this setup again.$\r$\n$\r$\nDriver setup result: $0"
  ${EndIf}
!macroend
