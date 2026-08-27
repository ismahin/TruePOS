import { describe, expect, it } from "vitest";
import { heldCartLabel, nextHeldCartNumber, normalizeHeldCarts } from "./held-carts";

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

  it("formats the migrated hold number for display", () => {
    expect(heldCartLabel({ id: "h1", holdNumber: 7, createdAt: "invalid", lines })).toBe("Hold 7");
  });
});
