import type { CartLine } from "./contracts";

export type ActiveBillingSession = {
  cart: CartLine[];
  customerName: string;
  customerPhone: string;
  paid: number;
  billDiscount: number;
  paymentMethod: "cash" | "card" | "mobile";
  lastSaleId: string;
  lastReceiptNo: string;
};

export const ACTIVE_BILLING_STORAGE_KEY = "truepos.activeBilling";

function isFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeCartLine(value: unknown): CartLine | null {
  if (!value || typeof value !== "object") return null;
  const line = value as Partial<CartLine>;
  if (typeof line.productId !== "string" || !line.productId) return null;
  if (typeof line.sku !== "string") return null;
  if (typeof line.barcode !== "string") return null;
  if (typeof line.name !== "string" || !line.name) return null;
  if (!isFiniteNumber(line.quantity) || (line.quantity as number) <= 0) return null;
  if (!isFiniteNumber(line.unitPrice) || (line.unitPrice as number) < 0) return null;
  if (!isFiniteNumber(line.discount) || (line.discount as number) < 0) return null;
  if (!isFiniteNumber(line.vatRate) || (line.vatRate as number) < 0) return null;
  const quantity = line.quantity as number;
  const unitPrice = line.unitPrice as number;
  const discount = line.discount as number;
  const vatRate = line.vatRate as number;
  return {
    productId: line.productId,
    sku: line.sku,
    barcode: line.barcode,
    name: line.name,
    quantity,
    unitPrice,
    discount,
    vatRate,
    imageDataUrl: typeof line.imageDataUrl === "string" ? line.imageDataUrl : undefined
  };
}

export function emptyActiveBillingSession(): ActiveBillingSession {
  return {
    cart: [],
    customerName: "",
    customerPhone: "",
    paid: 0,
    billDiscount: 0,
    paymentMethod: "cash",
    lastSaleId: "",
    lastReceiptNo: ""
  };
}

export function normalizeActiveBillingSession(value: unknown): ActiveBillingSession {
  const empty = emptyActiveBillingSession();
  if (!value || typeof value !== "object") return empty;
  const raw = value as Partial<ActiveBillingSession>;
  const cart = Array.isArray(raw.cart)
    ? raw.cart.map(normalizeCartLine).filter((line): line is CartLine => Boolean(line))
    : [];
  const paymentMethod =
    raw.paymentMethod === "card" || raw.paymentMethod === "mobile" || raw.paymentMethod === "cash"
      ? raw.paymentMethod
      : "cash";
  const paid = isFiniteNumber(raw.paid) ? Math.max(0, raw.paid as number) : 0;
  const billDiscount = isFiniteNumber(raw.billDiscount) ? Math.max(0, raw.billDiscount as number) : 0;
  return {
    cart,
    customerName: typeof raw.customerName === "string" ? raw.customerName : "",
    customerPhone: typeof raw.customerPhone === "string" ? raw.customerPhone : "",
    paid,
    billDiscount,
    paymentMethod,
    lastSaleId: typeof raw.lastSaleId === "string" ? raw.lastSaleId : "",
    lastReceiptNo: typeof raw.lastReceiptNo === "string" ? raw.lastReceiptNo : ""
  };
}

export function loadActiveBillingSession(storage: Pick<Storage, "getItem"> = globalThis.localStorage): ActiveBillingSession {
  try {
    const raw = storage?.getItem?.(ACTIVE_BILLING_STORAGE_KEY);
    if (!raw) return emptyActiveBillingSession();
    return normalizeActiveBillingSession(JSON.parse(raw) as unknown);
  } catch {
    return emptyActiveBillingSession();
  }
}

export function saveActiveBillingSession(
  session: ActiveBillingSession,
  storage: Pick<Storage, "setItem"> = globalThis.localStorage
) {
  storage.setItem(ACTIVE_BILLING_STORAGE_KEY, JSON.stringify(session));
}
