import { describe, expect, it } from "vitest";
import { buildReceiptHtml, buildReceiptText, calculatePaymentBalance, calculateTotals, roundCashUp, validateCode128Value } from "./pos.js";
import type { AppSettings, Sale } from "./contracts.js";

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
      itemDiscountTotal: 10,
      billDiscountTotal: 0,
      discountTotal: 10,
      taxableTotal: 190,
      vatTotal: 28.5,
      grandTotal: 218.5
    });
  });

  it("applies a whole-bill discount to the payable total", () => {
    const lines = [
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
    ];
    expect(calculateTotals(lines, 8.5)).toEqual({
      subtotal: 200,
      itemDiscountTotal: 10,
      billDiscountTotal: 8.5,
      discountTotal: 18.5,
      taxableTotal: 190,
      vatTotal: 28.5,
      grandTotal: 210
    });
    expect(calculateTotals(lines, 999).grandTotal).toBe(0);
    expect(calculateTotals(lines, -5)).toEqual(calculateTotals(lines));
  });

  it("rejects invalid Code128 values", () => {
    expect(() => validateCode128Value("")).toThrow();
    expect(() => validateCode128Value("SKU-100")).not.toThrow();
  });

  it("calculates due and change without treating zero as full payment", () => {
    expect(calculatePaymentBalance(218.5, 0)).toEqual({ due: 218.5, change: 0 });
    expect(calculatePaymentBalance(218.5, 200)).toEqual({ due: 18.5, change: 0 });
    expect(calculatePaymentBalance(218.5, 250)).toEqual({ due: 0, change: 31.5 });
  });

  it("rounds cash tender up to the next convenient note", () => {
    expect(roundCashUp(0)).toBe(0);
    expect(roundCashUp(787.5)).toBe(790);
    expect(roundCashUp(790)).toBe(790);
    expect(roundCashUp(791)).toBe(795);
    expect(roundCashUp(218.5, 1)).toBe(219);
  });

  it("prints the outstanding due on an unpaid receipt", () => {
    const sale: Sale = {
      id: "sale-1",
      receiptNo: "TP-1",
      lines: [{ productId: "p1", sku: "SKU-1", barcode: "SKU-1", name: "Rice", quantity: 1, unitPrice: 100, discount: 0, vatRate: 0 }],
      payment: { method: "cash", amount: 0 },
      totals: calculateTotals([{ productId: "p1", sku: "SKU-1", barcode: "SKU-1", name: "Rice", quantity: 1, unitPrice: 100, discount: 0, vatRate: 0 }]),
      cashierId: "u1",
      cashierName: "cashier",
      customerName: "",
      customerPhone: "",
      status: "completed",
      createdAt: "2026-08-24T12:00:00.000Z"
    };
    const settings = {
      shopName: "TruePOS",
      currency: "BDT",
      receipt: { widthMm: 80, header: "", footer: "", showVatBreakdown: true }
    } as AppSettings;

    const receipt = buildReceiptText(sale, settings);
    expect(receipt).toContain("Paid");
    expect(receipt).toContain("Due");
    expect(receipt.match(/BDT\s*100\.00/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("builds a safe-width structured thermal receipt", () => {
    const lines = [{ productId: "p1", sku: "SKU-1", barcode: "SKU-1", name: "Long <Book> & Supply Name", quantity: 2, unitPrice: 150, discount: 5, vatRate: 15 }];
    const sale: Sale = {
      id: "sale-1",
      receiptNo: "TP-1787559035-AB12",
      lines,
      payment: { method: "cash", amount: 400 },
      totals: calculateTotals(lines),
      cashierId: "u1",
      cashierName: "cashier",
      customerName: "Rahim",
      customerPhone: "01712345678",
      status: "completed",
      createdAt: "2026-08-24T12:00:00.000Z"
    };
    const settings = {
      shopName: "TruePOS",
      currency: "BDT",
      receipt: {
        widthMm: 80,
        fontSize: 12,
        fontFamily: "Consolas",
        padding: 8,
        logoDataUrl: "",
        logoWidthMm: 32,
        logoHeightMm: 16,
        logoScale: 100,
        logoOffsetX: 0,
        logoOffsetY: 0,
        header: "Dhaka, Bangladesh",
        footer: "Thank you",
        showVatBreakdown: true
      }
    } as AppSettings;

    const html = buildReceiptHtml(sale, settings, { widthPx: 568, thermal: true });
    expect(html).toContain("width:568px");
    expect(html).toContain('font-family:"Trebuchet MS",Verdana,Tahoma,Arial,sans-serif');
    expect(html).toContain("font-variant-ligatures:none");
    expect(html).toContain("Description");
    expect(html).toContain("Payable");
    expect(html).toContain("All amounts in BDT");
    expect(html).toContain("TruePOS</span><span class=\"credit-by\">develop by</span><span>BUBT Innovation HUB");
    expect(html).toContain("Long &lt;Book&gt; &amp; Supply Name");
    expect(html).not.toContain("Long <Book> & Supply Name");
  });
});
