import { describe, expect, it } from "vitest";
import { calculateTotals, validateCode128Value } from "./pos.js";

describe("POS calculations", () => {
  it("calculates subtotal, discounts, VAT, and grand total", () => {
    const totals = calculateTotals([
      {
        productId: "p1",
        sku: "SKU-1",
        barcode: "SKU-1",
        name: "Rice",
        quantity: 2,
        unitPrice: 100,
        discount: 5,
        vatRate: 15
      }
    ]);

    expect(totals).toEqual({
      subtotal: 200,
      discountTotal: 10,
      taxableTotal: 190,
      vatTotal: 28.5,
      grandTotal: 218.5
    });
  });

  it("rejects invalid Code128 values", () => {
    expect(() => validateCode128Value("")).toThrow();
    expect(() => validateCode128Value("SKU-100")).not.toThrow();
  });
});
