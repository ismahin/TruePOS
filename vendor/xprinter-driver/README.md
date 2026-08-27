# Xprinter Windows driver

`Xprinter_2024.2_M-1.exe` is the signed Seagull printer-driver package supplied for Xprinter printers. The package includes support for both `Xprinter XP-237B` and `Xprinter XP-365B`.

- Product: Seagull Printer Drivers
- File/Product version: 2023.2
- Publisher: Seagull Software, LLC
- Authenticode status when added: Valid
- SHA-256: `A34A29329AEC98FEED78CE82B07270B432C2E80C906C6AB5E6E1C9B52C3B8E27`

The TruePOS NSIS installer starts this package with Seagull's documented `/x <directory> /i` options. This extracts the driver into the NSIS temporary directory and starts the official DriverWizard after TruePOS is installed.

Before distributing TruePOS outside your organization, confirm that your Xprinter/Seagull agreement permits redistribution of this package.
