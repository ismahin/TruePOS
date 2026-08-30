import { describe, expect, it } from "vitest";
import { syncCartLineWithProduct, syncCartLinesWithProducts, syncHeldCartsWithProducts } from "./cart-sync";
import type { Product } from "./contracts";

const product = (patch: Partial<Product> = {}): Product => ({
  id: "p1",
  sku: "OLD-SKU",
  barcode: "OLD-BC",
  name: "Old Name",
  category: "Parts",
  unit: "pcs",
  cost: 10,
  price: 100,
  vatRate: 5,
  stock: 8,
  lowStockThreshold: 2,
  isActive: true,
  imageDataUrl: "data:image/jpeg;base64,old",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...patch
});

describe("cart catalog sync", () => {
  it("updates name, image, price, and sku from the live product", () => {
    const line = {
      productId: "p1",
      sku: "OLD-SKU",
      barcode: "OLD-BC",
      name: "Old Name",
      quantity: 2,
      unitPrice: 100,
      discount: 10,
      vatRate: 5,
      imageDataUrl: "data:image/jpeg;base64,old"
    };
    const synced = syncCartLineWithProduct(
      line,
      product({
        name: "ESP32",
        sku: "MIC-1",
        barcode: "ESP32",
        price: 1250,
        vatRate: 0,
        imageDataUrl: "data:image/jpeg;base64,new"
      })
    );
    expect(synced).toMatchObject({
      name: "ESP32",
      sku: "MIC-1",
      barcode: "ESP32",
      unitPrice: 1250,
      vatRate: 0,
      discount: 10,
      imageDataUrl: "data:image/jpeg;base64,new",
      quantity: 2
    });
  });

  it("clamps line discount when the price drops", () => {
    const synced = syncCartLineWithProduct(
      {
        productId: "p1",
        sku: "A",
        barcode: "A",
        name: "A",
        quantity: 1,
        unitPrice: 100,
        discount: 40,
        vatRate: 0
      },
      product({ price: 25 })
    );
    expect(synced?.discount).toBe(25);
  });

  it("clamps cart quantity down to available stock", () => {
    const synced = syncCartLineWithProduct(
      {
        productId: "p1",
        sku: "A",
        barcode: "A",
        name: "A",
        quantity: 8,
        unitPrice: 100,
        discount: 0,
        vatRate: 0
      },
      product({ stock: 1 })
    );
    expect(synced?.quantity).toBe(1);
  });

  it("clamps active cart using stock minus parked reservations", () => {
    const lines = [
      {
        productId: "p1",
        sku: "A",
        barcode: "A",
        name: "A",
        quantity: 5,
        unitPrice: 100,
        discount: 0,
        vatRate: 0
      }
    ];
    const synced = syncCartLinesWithProducts(lines, [product({ stock: 5 })], { p1: 3 });
    expect(synced.lines[0]?.quantity).toBe(2);
    expect(synced.quantityClamped).toBe(1);

    const blocked = syncCartLinesWithProducts(lines, [product({ stock: 3 })], { p1: 3 });
    expect(blocked.lines).toEqual([]);
    expect(blocked.removed).toBe(1);
  });

  it("keeps newer parked bills when combined parks exceed stock", () => {
    const held = syncHeldCartsWithProducts(
      [
        {
          id: "newer",
          holdNumber: 2,
          createdAt: "2026-08-27T15:00:00.000Z",
          customerName: "A",
          customerPhone: "",
          lines: [
            {
              productId: "p1",
              sku: "A",
              barcode: "A",
              name: "A",
              quantity: 2,
              unitPrice: 100,
              discount: 0,
              vatRate: 0
            }
          ],
          billDiscount: 0
        },
        {
          id: "older",
          holdNumber: 1,
          createdAt: "2026-08-27T14:00:00.000Z",
          customerName: "B",
          customerPhone: "",
          lines: [
            {
              productId: "p1",
              sku: "A",
              barcode: "A",
              name: "A",
              quantity: 2,
              unitPrice: 100,
              discount: 0,
              vatRate: 0
            }
          ],
          billDiscount: 0
        }
      ],
      [product({ stock: 2 })]
    );
    expect(held.carts).toHaveLength(1);
    expect(held.carts[0]?.id).toBe("newer");
    expect(held.carts[0]?.lines[0]?.quantity).toBe(2);
  });

  it("drops inactive or missing products from carts and parked sales", () => {
    const lines = [
      {
        productId: "p1",
        sku: "A",
        barcode: "A",
        name: "A",
        quantity: 1,
        unitPrice: 10,
        discount: 0,
        vatRate: 0
      },
      {
        productId: "gone",
        sku: "B",
        barcode: "B",
        name: "B",
        quantity: 1,
        unitPrice: 10,
        discount: 0,
        vatRate: 0
      }
    ];
    const synced = syncCartLinesWithProducts(lines, [product({ isActive: false })]);
    expect(synced.lines).toEqual([]);
    expect(synced.removed).toBe(2);

    const held = syncHeldCartsWithProducts(
      [
        {
          id: "h1",
          holdNumber: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          customerName: "Rahim",
          customerPhone: "",
          lines,
          billDiscount: 0
        }
      ],
      [product({ name: "Live", price: 50 })]
    );
    expect(held.carts[0]?.lines).toHaveLength(1);
    expect(held.carts[0]?.lines[0]?.name).toBe("Live");
    expect(held.carts[0]?.lines[0]?.unitPrice).toBe(50);

    const emptied = syncHeldCartsWithProducts(
      [
        {
          id: "h2",
          holdNumber: 2,
          createdAt: "2026-01-01T00:00:00.000Z",
          customerName: "Karim",
          customerPhone: "",
          lines,
          billDiscount: 0
        }
      ],
      []
    );
    expect(emptied.carts).toEqual([]);
  });
});
