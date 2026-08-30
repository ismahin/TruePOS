import type { CartLine } from "./contracts";

export type HeldCart = {
  id: string;
  holdNumber: number;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  lines: CartLine[];
  billDiscount: number;
};

type StoredHeldCart = Partial<HeldCart> & { label?: unknown };

function storedHoldNumber(item: StoredHeldCart) {
  const direct = Number(item.holdNumber);
  if (Number.isSafeInteger(direct) && direct > 0) return direct;
  const match =
    typeof item.label === "string"
      ? /^(?:Hold|Parked(?:\s+sale)?(?:\s*#)?)\s*(\d+)\b/i.exec(item.label)
      : null;
  const legacy = Number(match?.[1]);
  return Number.isSafeInteger(legacy) && legacy > 0 ? legacy : 0;
}

function storedCustomerField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function customerBillLabel(customerName: string, customerPhone: string) {
  const name = customerName.trim();
  const phone = customerPhone.trim();
  if (name && phone) return `${name} · ${phone}`;
  if (name) return name;
  if (phone) return phone;
  return "Walk-in customer";
}

export function normalizeHeldCarts(value: unknown): HeldCart[] {
  if (!Array.isArray(value)) return [];
  const items = value.filter(
    (item): item is StoredHeldCart =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof item.id === "string" &&
      typeof item.createdAt === "string" &&
      Array.isArray(item.lines)
  );
  const normalized = new Array<HeldCart>(items.length);
  const used = new Set<number>();
  let nextAvailable = 1;

  // Saved holds are newest-first. Preserve the older hold's number and repair
  // a newer duplicate with the next unused number.
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    let holdNumber = storedHoldNumber(item);
    if (holdNumber < 1 || used.has(holdNumber)) {
      while (used.has(nextAvailable)) nextAvailable += 1;
      holdNumber = nextAvailable;
    }
    used.add(holdNumber);
    nextAvailable = Math.max(nextAvailable, holdNumber + 1);
    normalized[index] = {
      id: item.id!,
      holdNumber,
      createdAt: item.createdAt!,
      customerName: storedCustomerField(item.customerName),
      customerPhone: storedCustomerField(item.customerPhone),
      lines: item.lines as CartLine[],
      billDiscount:
        typeof item.billDiscount === "number" && Number.isFinite(item.billDiscount)
          ? Math.max(0, item.billDiscount)
          : 0
    };
  }

  return normalized;
}

export function nextHeldCartNumber(carts: HeldCart[], storedNext: unknown) {
  const saved = Number(storedNext);
  const validSaved = Number.isSafeInteger(saved) && saved > 0 ? saved : 1;
  return Math.max(validSaved, ...carts.map((cart) => cart.holdNumber + 1), 1);
}

export function heldCartLabel(cart: HeldCart) {
  const customer = customerBillLabel(cart.customerName, cart.customerPhone);
  return `#${cart.holdNumber} · ${customer}`;
}

/** Units reserved on parked bills for each product id. */
export function parkedQuantitiesByProduct(heldCarts: HeldCart[]) {
  const reserved: Record<string, number> = {};
  for (const held of heldCarts) {
    for (const line of held.lines) {
      reserved[line.productId] = (reserved[line.productId] ?? 0) + line.quantity;
    }
  }
  return reserved;
}

export function formatParkedDuration(createdAt: string, nowMs = Date.now()) {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return "Parked just now";
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - created) / 1000));
  if (elapsedSeconds < 60) return `Parked ${elapsedSeconds}s`;
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  if (minutes < 60) return `Parked ${minutes}m ${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return `Parked ${hours}h ${String(remainMinutes).padStart(2, "0")}m`;
}

/** Units of a product already reserved on parked bills (not yet deducted from inventory). */
export function parkedQuantityForProduct(heldCarts: HeldCart[], productId: string) {
  return heldCarts.reduce(
    (sum, held) =>
      sum + held.lines.reduce((lineSum, line) => (line.productId === productId ? lineSum + line.quantity : lineSum), 0),
    0
  );
}

/** On-hand stock minus parked reservations — how many can go on the active cart. */
export function availableAfterParked(onHand: number, parkedQty: number) {
  return Math.max(0, Math.max(0, onHand) - Math.max(0, parkedQty));
}
