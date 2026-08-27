!macro customHeader
  ShowInstDetails show
!macroend

!macro customInstall
  SetDetailsPrint both
  FileOpen $R9 "$INSTDIR\installation.log" w
  FileWrite $R9 "TruePOS ${VERSION} installation log$\r$\n"
  FileWrite $R9 "Application files installed in: $INSTDIR$\r$\n"
  DetailPrint "TruePOS application files installed."
  DetailPrint "Preparing the Xprinter 2-in-1 driver..."
  FileWrite $R9 "Preparing the Xprinter 2-in-1 driver.$\r$\n"

  IfFileExists "$INSTDIR\resources\xprinter-driver\Xprinter_2024.2_M-1.exe" driver_extract driver_package_missing

  driver_extract:
    CreateDirectory "$PLUGINSDIR\TruePOS-Xprinter-Driver"
    IfErrors driver_directory_failed
    DetailPrint "Extracting the signed Xprinter driver package..."
    FileWrite $R9 "Extracting driver to: $PLUGINSDIR\TruePOS-Xprinter-Driver$\r$\n"
    ClearErrors
    ExecWait '"$INSTDIR\resources\xprinter-driver\Xprinter_2024.2_M-1.exe" /x "$PLUGINSDIR\TruePOS-Xprinter-Driver"' $0
    IfErrors driver_extract_failed
    FileWrite $R9 "Driver extraction result: $0$\r$\n"
    ${If} $0 != 0
      StrCpy $R8 "The Xprinter driver package could not be extracted (result $0)."
      Goto driver_failed
    ${EndIf}
    IfFileExists "$PLUGINSDIR\TruePOS-Xprinter-Driver\DriverWizard.exe" driver_launch driver_wizard_missing

  driver_launch:
    DetailPrint "Opening the official Xprinter DriverWizard..."
    FileWrite $R9 "Launching: $PLUGINSDIR\TruePOS-Xprinter-Driver\DriverWizard.exe$\r$\n"
    ClearErrors
    ExecWait '"$PLUGINSDIR\TruePOS-Xprinter-Driver\DriverWizard.exe"' $0
    IfErrors driver_launch_failed
    DetailPrint "Xprinter DriverWizard finished with result $0."
    FileWrite $R9 "DriverWizard result: $0$\r$\n"
    FileWrite $R9 "Installation workflow completed.$\r$\n"
    FileClose $R9
    Goto driver_finished

  driver_package_missing:
    StrCpy $R8 "The bundled Xprinter driver package is missing."
    Goto driver_failed

  driver_directory_failed:
    StrCpy $R8 "Windows could not create the temporary Xprinter driver folder."
    Goto driver_failed

  driver_extract_failed:
    StrCpy $R8 "Windows could not start the Xprinter driver extractor."
    Goto driver_failed

  driver_wizard_missing:
    StrCpy $R8 "The Xprinter package was extracted, but DriverWizard.exe was not found."
    Goto driver_failed

  driver_launch_failed:
    StrCpy $R8 "Windows could not start the Xprinter DriverWizard."

  driver_failed:
    DetailPrint "ERROR: $R8"
    FileWrite $R9 "ERROR: $R8$\r$\n"
    FileClose $R9
    MessageBox MB_OK|MB_ICONEXCLAMATION "TruePOS was installed, but the Xprinter driver setup did not finish.$\r$\n$\r$\n$R8$\r$\n$\r$\nInstallation log: $INSTDIR\installation.log"

  driver_finished:
    DetailPrint "TruePOS installation workflow finished."
!macroend

!macro customRemoveFiles
  Delete "$INSTDIR\installation.log"
!macroend
