import { describe, expect, it } from "vitest";
import { availableAfterParked, customerBillLabel, formatParkedDuration, heldCartLabel, nextHeldCartNumber, normalizeHeldCarts, parkedQuantityForProduct } from "./held-carts";

const lines = [{
  productId: "p1",
  sku: "SKU-1",
  barcode: "SKU-1",
  name: "Book",
  quantity: 1,
  unitPrice: 100,
  discount: 0,
  vatRate: 0
}];

describe("held cart numbering", () => {
  it("repairs duplicate legacy hold numbers without changing the display order", () => {
    const carts = normalizeHeldCarts([
      { id: "newer", label: "Hold 1 - 2:00 PM", createdAt: "2026-08-27T14:00:00.000Z", lines },
      { id: "older", label: "Hold 1 - 1:00 PM", createdAt: "2026-08-27T13:00:00.000Z", lines }
    ]);

    expect(carts.map((cart) => [cart.id, cart.holdNumber])).toEqual([["newer", 2], ["older", 1]]);
  });

  it("keeps increasing after earlier holds are resumed or removed", () => {
    const carts = normalizeHeldCarts([
      { id: "current", holdNumber: 4, createdAt: "2026-08-27T14:00:00.000Z", lines }
    ]);

    expect(nextHeldCartNumber(carts, "8")).toBe(8);
    expect(nextHeldCartNumber(carts, "2")).toBe(5);
  });

  it("labels parked sales by customer name or phone", () => {
    expect(customerBillLabel("Rahim", "01712345678")).toBe("Rahim · 01712345678");
    expect(customerBillLabel("", "01712345678")).toBe("01712345678");
    expect(customerBillLabel("Rahim", "")).toBe("Rahim");
    expect(customerBillLabel("", "")).toBe("Walk-in customer");
    expect(
      heldCartLabel({
        id: "h1",
        holdNumber: 7,
        createdAt: "invalid",
        customerName: "Rahim",
        customerPhone: "0171",
        lines,
        billDiscount: 0
      })
    ).toBe("#7 · Rahim · 0171");
    expect(
      heldCartLabel({
        id: "h2",
        holdNumber: 3,
        createdAt: "invalid",
        customerName: "",
        customerPhone: "",
        lines,
        billDiscount: 0
      })
    ).toBe("#3 · Walk-in customer");
  });

  it("formats live parked duration", () => {
    const createdAt = "2026-08-27T14:00:00.000Z";
    const now = Date.parse(createdAt) + (2 * 60 + 5) * 1000;
    expect(formatParkedDuration(createdAt, now)).toBe("Parked 2m 05s");
    expect(formatParkedDuration(createdAt, Date.parse(createdAt) + 12_000)).toBe("Parked 12s");
    expect(formatParkedDuration(createdAt, Date.parse(createdAt) + (65 * 60 + 10) * 1000)).toBe("Parked 1h 05m");
  });

  it("restores customer fields from stored parked sales", () => {
    const carts = normalizeHeldCarts([
      {
        id: "c1",
        holdNumber: 3,
        createdAt: "2026-08-27T14:00:00.000Z",
        customerName: " Karim ",
        customerPhone: " 0181 ",
        lines
      }
    ]);
    expect(carts[0]).toMatchObject({ customerName: "Karim", customerPhone: "0181", billDiscount: 0 });
  });

  it("keeps whole-bill discount on parked sales", () => {
    const carts = normalizeHeldCarts([
      {
        id: "c1",
        holdNumber: 3,
        createdAt: "2026-08-27T14:00:00.000Z",
        customerName: "Karim",
        customerPhone: "0181",
        lines,
        billDiscount: 7.5
      }
    ]);
    expect(carts[0]?.billDiscount).toBe(7.5);
  });
});

describe("parked stock reservation", () => {
  it("sums parked quantity per product across bills", () => {
    const carts = normalizeHeldCarts([
      {
        id: "a",
        holdNumber: 1,
        createdAt: "2026-08-27T14:00:00.000Z",
        customerName: "One",
        customerPhone: "",
        lines: [{ ...lines[0], productId: "p1", quantity: 1 }]
      },
      {
        id: "b",
        holdNumber: 2,
        createdAt: "2026-08-27T14:01:00.000Z",
        customerName: "Two",
        customerPhone: "",
        lines: [
          { ...lines[0], productId: "p1", quantity: 2 },
          { ...lines[0], productId: "p2", quantity: 1 }
        ]
      }
    ]);
    expect(parkedQuantityForProduct(carts, "p1")).toBe(3);
    expect(parkedQuantityForProduct(carts, "p2")).toBe(1);
    expect(availableAfterParked(3, 3)).toBe(0);
    expect(availableAfterParked(5, 3)).toBe(2);
  });
});
