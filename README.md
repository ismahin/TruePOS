# TruePOS

TruePOS is a Windows-first offline desktop point of sale system for retail shops, mini marts, grocery stores, pharmacies, and small supermarkets. It is built to run locally on the cashier PC, keep the database on the user machine, and support everyday shop workflows such as billing, product entry, inventory control, barcode labels, receipt printing, reporting, and backup.

The app is developed with Electron, React, TypeScript, and encrypted SQLite.

## Core Features

- Fast billing screen with barcode scanner friendly checkout
- Cart quantity editing, discounts, VAT, tender amount, change due, hold and void workflow
- Receipt preview before print
- Native Xprinter XP-365B USB printing for 80mm receipts and 45x35mm Code128 labels
- Windows-driver printing fallback for other printers
- Product management with SKU, barcode, category, unit, cost, price, VAT, status, and low stock threshold
- Separate stock entry workflow for receiving inventory without rescanning every unit
- Inventory stock in, stock out, adjustment, cycle count, low stock alerts, and movement history
- Barcode label printing with Code128 labels
- Receipt customization with shop name, header, footer, paper width, font, padding, VAT display, and custom logo
- Logo upload, scaling, and movement controls for receipt printing
- Sales reports with KPI cards, trends, product performance, profit estimate, VAT, and inventory valuation
- Local encrypted backup export/import
- CSV export for products, inventory, and sales
- Optional Google Drive backup connection and daily automatic backup
- Admin and cashier role foundation

## Offline-First Design

TruePOS is designed for shops where internet access cannot be guaranteed.

- Billing, products, inventory, reports, and printing work locally.
- Database is stored under the Windows user profile, not inside the install folder.
- Uninstalling the app does not delete the database.
- Backups can be exported manually or uploaded to Google Drive when connected.

## Hardware Support

TruePOS targets the following retail hardware:

- USB barcode scanners in keyboard-wedge mode
- Xprinter XP-365B over USB using Xprinter's Windows SDK (80mm receipt roll or 45x35mm gap labels)
- 58mm and 80mm Windows-driver thermal printers as a fallback
- Other Windows-driver label printers configured with the correct page size

Barcode scanners normally work without a special driver because they type the scanned code into the focused field.

### XP-365B setup

1. Connect the XP-365B by USB, turn it on, and close any other utility that has the printer port open.
2. In **Settings**, select **Xprinter XP-365B SDK (USB)**. This fixes receipt paper to 80mm and label media to 45x35mm.
3. Save settings before running either test button.
4. For receipts, load the 80mm roll and run **Test Receipt Print**.
5. For labels, load the 45x35mm gap-label roll, run **Calibrate Label Gap** once after loading or changing media, and then run **Print Test Labels**.

SDK mode communicates directly with the USB printer and does not use the Windows printer queue or its page-scaling settings. The official `printer.sdk.dll` runtimes are included from Xprinter Windows SDK 2.0.4; provenance and hashes are recorded in `vendor/xprinter/README.md`. Confirm Xprinter's redistribution terms before publishing the installer outside your organization.

## Installer

Windows installer builds are generated under:

```text
release/
```

The latest local installer from this development build is:

```text
release/TruePOS-Setup-0.1.25.exe
```

The NSIS installer is configured for per-machine installation, so it installs into Program Files when elevated, while keeping user data under AppData.

The installer also bundles the signed Seagull Xprinter driver package and starts its official DriverWizard after the TruePOS files are installed. Connect and power on the XP-365B before starting setup, then complete the printer-detection step in DriverWizard. Live driver-installation details are displayed in the installer and saved to `installation.log` inside the TruePOS installation directory.

### Software updates

Installed builds check the public `ismahin/TruePOS` GitHub releases automatically at startup and every six hours while running. When an update is available, Settings displays a notification badge and an **Update** button. TruePOS downloads the verified release in the background, then **Restart and Update** closes the app, installs the update, and opens the new version without requiring the user to download and run another installer manually.

The notification badge is cleared after the user opens Settings for that release, while the update controls remain available until the update is installed. Update activity is recorded in the application logs as `truepos-updates.log`.

## Google Drive Backup

Google Drive backup is user friendly inside the app: the shop user clicks **Connect Google Drive**, signs in through the browser, grants permission, and then can run manual or scheduled backups.

For security and Google OAuth policy reasons, the application publisher must configure the Google OAuth client before building the installer. The shop user should never enter a client ID.

Developer setup:

1. Create a Google Cloud project.
2. Enable the Google Drive API.
3. Configure the OAuth consent screen.
4. Create an OAuth Client ID with application type **Desktop app**.
5. Create `google-drive-oauth.json` in the project root:

```json
{
  "clientId": "YOUR_REAL_GOOGLE_DESKTOP_OAUTH_CLIENT_ID.apps.googleusercontent.com"
}
```

6. Build the installer:

```powershell
npm run dist
```

`google-drive-oauth.json` is ignored by Git. The build script copies it into packaged resources during release packaging.

You can also provide the client ID through:

```powershell
$env:TRUEPOS_GOOGLE_CLIENT_ID="YOUR_REAL_CLIENT_ID.apps.googleusercontent.com"
npm run dist
```

## Development

Install dependencies:

```powershell
npm install
```

Run the desktop app in development:

```powershell
npm run dev
```

Run tests:

```powershell
npm test
```

Create a production build:

```powershell
npm run build
```

Create the Windows installer:

```powershell
npm run dist
```

## Project Structure

```text
electron/              Electron main process, services, IPC, printing, backup
src/renderer/          React desktop UI
src/shared/            Shared contracts, POS calculations, receipt formatting
scripts/               Build helper scripts
build/                 App icons and generated packaging resources
release/               Generated Windows installers
```

## Data And Security

- Local database uses encrypted SQLite.
- Database key is stored with Windows-protected credential storage through Keytar.
- Google Drive refresh token is stored in protected credential storage, not in the normal settings JSON.
- Full encrypted database backups can be exported and imported from Settings.
- Import includes rollback protection if the selected backup cannot be restored.

## Current Status

TruePOS is under active development. The current build includes the main desktop POS workflows and Windows installer packaging. Before live store deployment, test with the exact printer, barcode scanner, label size, tax settings, and backup workflow used by the shop.
