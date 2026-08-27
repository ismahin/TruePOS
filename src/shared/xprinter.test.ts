import { describe, expect, it } from "vitest";
import type { BarcodeSettings, Product } from "./contracts.js";
import { buildXp365bLabelLayout, makeReceiptBitmapMonochrome, validateLabelQuantity, validateXp365bLabelSettings, XP365B_RECEIPT_WIDTH_DOTS, XP365B_SAFE_RECEIPT_WIDTH_DOTS } from "./xprinter.js";

const settings: BarcodeSettings = {
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
};

const product: Product = {
  id: "p1",
  sku: "SKU-100",
  barcode: "SKU-100",
  name: "Sample Product",
  category: "",
  unit: "pcs",
  cost: 50,
  price: 100,
  vatRate: 0,
  stock: 10,
  lowStockThreshold: 1,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

describe("XP-365B label layout", () => {
  it("keeps receipt images inside the printer edge margins", () => {
    expect(XP365B_SAFE_RECEIPT_WIDTH_DOTS).toBeLessThan(XP365B_RECEIPT_WIDTH_DOTS);
    expect(XP365B_SAFE_RECEIPT_WIDTH_DOTS).toBe(568);
  });

  it("converts antialiased BGRA pixels to solid thermal black and white", () => {
    const result = makeReceiptBitmapMonochrome(new Uint8Array([
      255, 255, 255, 255,
      180, 180, 180, 255,
      0, 0, 0, 255
    ]));
    expect([...result]).toEqual([
      255, 255, 255, 255,
      0, 0, 0, 255,
      0, 0, 0, 255
    ]);
  });

  it("maps a 45x35mm label to 203-DPI dots", () => {
    const layout = buildXp365bLabelLayout(product, settings, 112);
    expect(layout.widthDots).toBe(360);
    expect(layout.heightDots).toBe(280);
    expect(layout.barcode.x).toBeGreaterThanOrEqual(12);
    expect(layout.barcode.height).toBeGreaterThanOrEqual(64);
  });

  it("rejects a barcode that cannot retain a two-dot module width", () => {
    expect(() => buildXp365bLabelLayout(product, settings, 300)).toThrow(/too long/i);
  });

  it("validates media controls and copy counts", () => {
    expect(() => validateXp365bLabelSettings({ ...settings, density: 16 })).toThrow(/density/i);
    expect(() => validateLabelQuantity(1.5)).toThrow(/whole number/i);
    expect(validateLabelQuantity(10)).toBe(10);
  });
});
