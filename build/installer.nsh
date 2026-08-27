!macro customHeader
  ShowInstDetails show
!macroend

!macro customInit
  SetDetailsPrint both
  DetailPrint "Stage 1 of 2: Installing TruePOS application files..."
!macroend

!macro customInstall
  SetDetailsPrint both
  FileOpen $R9 "$INSTDIR\installation.log" w
  FileWrite $R9 "TruePOS ${VERSION} installation log$\r$\n"
  FileWrite $R9 "Application files installed in: $INSTDIR$\r$\n"
  DetailPrint "TruePOS application files installed."

  ${If} ${Silent}
    DetailPrint "Automatic update detected; keeping the existing Xprinter driver."
    FileWrite $R9 "Silent automatic update: existing Xprinter driver setup preserved.$\r$\n"
    FileClose $R9
    Goto driver_finished
  ${EndIf}

  DetailPrint "Preparing the Xprinter 2-in-1 driver..."
  FileWrite $R9 "Preparing the Xprinter 2-in-1 driver.$\r$\n"

  IfFileExists "$INSTDIR\resources\xprinter-driver\DriverWizard.exe" driver_launch driver_files_missing

  driver_launch:
    DetailPrint "Stage 2 of 2: Starting the official Xprinter DriverWizard..."
    FileWrite $R9 "Launching: $INSTDIR\resources\xprinter-driver\DriverWizard.exe$\r$\n"
    SetOutPath "$INSTDIR\resources\xprinter-driver"
    ClearErrors
    ExecWait '"$INSTDIR\resources\xprinter-driver\DriverWizard.exe"' $0
    SetOutPath "$INSTDIR"
    IfErrors driver_launch_failed
    DetailPrint "Xprinter DriverWizard finished with result $0."
    FileWrite $R9 "DriverWizard result: $0$\r$\n"
    ${If} $0 != 0
      StrCpy $R8 "The Xprinter DriverWizard did not finish successfully (result $0)."
      Goto driver_failed
    ${EndIf}
    FileWrite $R9 "Installation workflow completed.$\r$\n"
    FileClose $R9
    Goto driver_finished

  driver_files_missing:
    StrCpy $R8 "The bundled Xprinter DriverWizard files are missing."
    Goto driver_failed

  driver_launch_failed:
    StrCpy $R8 "Windows could not start the Xprinter DriverWizard."

  driver_failed:
    SetOutPath "$INSTDIR"
    DetailPrint "ERROR: $R8"
    FileWrite $R9 "ERROR: $R8$\r$\n"
    FileClose $R9
    MessageBox MB_OK|MB_ICONEXCLAMATION "TruePOS was installed, but the Xprinter driver setup did not finish.$\r$\n$\r$\n$R8$\r$\n$\r$\nYou can retry from Settings > Install / Repair Xprinter Driver.$\r$\n$\r$\nInstallation log: $INSTDIR\installation.log"

  driver_finished:
    DetailPrint "TruePOS installation workflow finished."
!macroend

!macro customRemoveFiles
  Delete "$INSTDIR\installation.log"
!macroend
