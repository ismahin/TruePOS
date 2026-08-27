import type { CartLine } from "./contracts";

export type HeldCart = {
  id: string;
  holdNumber: number;
  createdAt: string;
  lines: CartLine[];
};

type StoredHeldCart = Partial<HeldCart> & { label?: unknown };

function storedHoldNumber(item: StoredHeldCart) {
  const direct = Number(item.holdNumber);
  if (Number.isSafeInteger(direct) && direct > 0) return direct;
  const match = typeof item.label === "string" ? /^Hold\s+(\d+)\b/i.exec(item.label) : null;
  const legacy = Number(match?.[1]);
  return Number.isSafeInteger(legacy) && legacy > 0 ? legacy : 0;
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
      lines: item.lines as CartLine[]
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
  const created = new Date(cart.createdAt);
  const time = Number.isNaN(created.getTime()) ? "" : created.toLocaleTimeString();
  return time ? `Hold ${cart.holdNumber} - ${time}` : `Hold ${cart.holdNumber}`;
}
