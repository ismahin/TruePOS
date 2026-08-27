import type { BarcodeSettings, Product } from "./contracts.js";

export const XP365B_DOTS_PER_MM = 8;
export const XP365B_MAX_PRINT_WIDTH_MM = 76;
export const XP365B_RECEIPT_WIDTH_DOTS = 576;
// Keep raster receipts inside the mechanism's non-printable edge margins.
export const XP365B_SAFE_RECEIPT_WIDTH_DOTS = 568;

export function makeReceiptBitmapMonochrome(bitmap: Uint8Array, threshold = 210): Uint8Array {
  if (bitmap.length % 4 !== 0) throw new Error("Receipt bitmap must contain BGRA pixels.");
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) throw new Error("Receipt bitmap threshold must be between 0 and 255.");
  const output = new Uint8Array(bitmap.length);
  for (let index = 0; index < bitmap.length; index += 4) {
    const blue = bitmap[index];
    const green = bitmap[index + 1];
    const red = bitmap[index + 2];
    const alpha = bitmap[index + 3] / 255;
    const luminance = (0.0722 * blue + 0.7152 * green + 0.2126 * red) * alpha + 255 * (1 - alpha);
    const value = luminance < threshold ? 0 : 255;
    output[index] = value;
    output[index + 1] = value;
    output[index + 2] = value;
    output[index + 3] = 255;
  }
  return output;
}

export type Xp365bLabelLayout = {
  widthDots: number;
  heightDots: number;
  name: { x: number; y: number; width: number; height: number };
  barcode: { x: number; y: number; height: number; narrow: number; wide: number };
  price: { x: number; y: number; width: number; height: number };
};

function finiteNumber(value: number, name: string, minimum: number, maximum: number) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function validateXp365bLabelSettings(settings: BarcodeSettings) {
  finiteNumber(settings.labelWidthMm, "Label width", 20, XP365B_MAX_PRINT_WIDTH_MM);
  finiteNumber(settings.labelHeightMm, "Label height", 10, 300);
  finiteNumber(settings.printSpeed, "Print speed", 1, 5);
  finiteNumber(settings.density, "Print density", 0, 15);
  finiteNumber(settings.gapMm, "Label gap", 0, 10);
  finiteNumber(settings.offsetMm, "Label offset", -10, 10);
}

export function validateLabelQuantity(quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
    throw new Error("Label quantity must be a whole number between 1 and 500.");
  }
  return quantity;
}

export function buildXp365bLabelLayout(product: Product, settings: BarcodeSettings, code128Modules: number): Xp365bLabelLayout {
  validateXp365bLabelSettings(settings);
  if (!Number.isInteger(code128Modules) || code128Modules <= 0) throw new Error("Could not measure the Code128 barcode.");

  const widthDots = Math.round(settings.labelWidthMm * XP365B_DOTS_PER_MM);
  const heightDots = Math.round(settings.labelHeightMm * XP365B_DOTS_PER_MM);
  const sideMargin = Math.max(12, Math.round(settings.padding * 2));
  const availableWidth = widthDots - sideMargin * 2;
  const narrow = 2;
  const barcodeWidth = code128Modules * narrow;
  if (barcodeWidth > availableWidth) {
    throw new Error(`Barcode ${product.barcode} is too long for a ${settings.labelWidthMm}mm label at a scanner-safe 2-dot module width.`);
  }

  const showName = settings.showName;
  const showPrice = settings.showPrice;
  const barcodeY = showName ? 54 : 20;
  const barcodeBottomReserve = showPrice ? 62 : 30;
  const barcodeHeight = Math.max(64, heightDots - barcodeY - barcodeBottomReserve);

  return {
    widthDots,
    heightDots,
    name: { x: sideMargin, y: 10, width: availableWidth, height: 40 },
    barcode: {
      x: Math.max(sideMargin, Math.floor((widthDots - barcodeWidth) / 2)),
      y: barcodeY,
      height: barcodeHeight,
      narrow,
      wide: narrow
    },
    price: { x: sideMargin, y: heightDots - 32, width: availableWidth, height: 24 }
  };
}
