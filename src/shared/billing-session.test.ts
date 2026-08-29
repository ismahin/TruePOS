import { describe, expect, it } from "vitest";
import {
  emptyActiveBillingSession,
  loadActiveBillingSession,
  normalizeActiveBillingSession,
  saveActiveBillingSession
} from "./billing-session";

describe("active billing session", () => {
  it("keeps a valid cart and drops broken lines", () => {
    const session = normalizeActiveBillingSession({
      cart: [
        {
          productId: "p1",
          sku: "SKU-1",
          barcode: "SKU-1",
          name: "Rice",
          quantity: 2,
          unitPrice: 100,
          discount: 0,
          vatRate: 5,
          imageDataUrl: "data:image/jpeg;base64,abc"
        },
        { productId: "bad" }
      ],
      customerName: " Rahim ",
      customerPhone: "0171",
      paid: 500,
      paymentMethod: "mobile",
      lastSaleId: "sale-1",
      lastReceiptNo: "TP-1"
    });

    expect(session.cart).toHaveLength(1);
    expect(session.cart[0]?.name).toBe("Rice");
    expect(session.customerName).toBe(" Rahim ");
    expect(session.paymentMethod).toBe("mobile");
    expect(session.paid).toBe(500);
  });

  it("keeps bill discount on the active session", () => {
    const session = normalizeActiveBillingSession({
      ...emptyActiveBillingSession(),
      billDiscount: 12.5,
      paid: 100
    });
    expect(session.billDiscount).toBe(12.5);
  });

  it("round-trips through storage", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      }
    };
    const session = {
      ...emptyActiveBillingSession(),
      customerName: "Sani",
      customerPhone: "019",
      paid: 790,
      cart: [
        {
          productId: "p1",
          sku: "SKU-1",
          barcode: "SKU-1",
          name: "NRF52",
          quantity: 1,
          unitPrice: 750,
          discount: 0,
          vatRate: 5
        }
      ]
    };

    saveActiveBillingSession(session, storage);
    expect(loadActiveBillingSession(storage)).toEqual(session);
  });
});
