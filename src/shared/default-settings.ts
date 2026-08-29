import type { AppSettings } from "./contracts.js";

/** Factory defaults for shop, receipt, barcode, and printer settings. */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  shopName: "TruePOS Store",
  currency: "BDT",
  receiptPrinter: "",
  barcodePrinter: "",
  printerMode: "xprinter",
  receipt: {
    widthMm: 80,
    fontSize: 12,
    fontFamily: "Consolas",
    language: "en",
    padding: 8,
    logoDataUrl: "",
    logoWidthMm: 32,
    logoHeightMm: 16,
    logoScale: 100,
    logoOffsetX: 0,
    logoOffsetY: 0,
    header: "Offline POS\nDhaka, Bangladesh",
    footer: "Thank you for shopping",
    showVatBreakdown: true
  },
  barcode: {
    format: "code128",
    labelWidthMm: 45,
    labelHeightMm: 35,
    padding: 6,
    printSpeed: 4,
    density: 8,
    gapMm: 2,
    offsetMm: 0,
    showName: true,
    showPrice: true
  },
  googleDrive: {
    connected: false,
    accountEmail: "",
    autoBackupEnabled: false,
    backupTime: "22:00",
    lastBackupAt: "",
    lastBackupStatus: ""
  }
};
