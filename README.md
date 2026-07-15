# TruePOS

TruePOS is a Windows-first offline desktop point of sale system for retail shops, mini marts, grocery stores, pharmacies, and small supermarkets. It is built to run locally on the cashier PC, keep the database on the user machine, and support everyday shop workflows such as billing, product entry, inventory control, barcode labels, receipt printing, reporting, and backup.

The app is developed with Electron, React, TypeScript, and encrypted SQLite.

## Core Features

- Fast billing screen with barcode scanner friendly checkout
- Cart quantity editing, discounts, VAT, tender amount, change due, hold and void workflow
- Receipt preview before print
- POS thermal receipt printing through Windows printers
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

TruePOS targets common retail hardware:

- USB barcode scanners in keyboard-wedge mode
- 58mm and 80mm POS thermal receipt printers
- Windows-driver thermal printers
- Barcode label printers or thermal printers configured with label size

Barcode scanners normally work without a special driver because they type the scanned code into the focused field.

## Installer

Windows installer builds are generated under:

```text
release/
```

The latest local installer from this development build is:

```text
release/TruePOS Setup 0.1.19.exe
```

The NSIS installer is configured for per-machine installation, so it installs into Program Files when elevated, while keeping user data under AppData.

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

