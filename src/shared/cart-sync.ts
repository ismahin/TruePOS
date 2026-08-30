import type { CartLine, Product } from "./contracts";
import { availableAfterParked, type HeldCart } from "./held-carts";

export const PRODUCTS_CHANGED_EVENT = "truepos:products-changed";

export function emitProductsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PRODUCTS_CHANGED_EVENT));
}

export function syncCartLineWithProduct(
  line: CartLine,
  product: Product | undefined,
  /** Cap quantity (e.g. stock minus other parked bills). Defaults to on-hand stock. */
  maxAvailable?: number
): CartLine | null {
  if (!product || !product.isActive) return null;
  const stockCap = Math.max(0, product.stock);
  const available = Math.max(0, maxAvailable === undefined ? stockCap : Math.min(stockCap, maxAvailable));
  if (available <= 0) return null;
  const unitPrice = Math.max(0, product.price);
  const quantity = Math.max(1, Math.min(line.quantity, available));
  return {
    ...line,
    productId: product.id,
    sku: product.sku,
    barcode: product.barcode,
    name: product.name,
    quantity,
    unitPrice,
    vatRate: Math.max(0, product.vatRate),
    discount: Math.max(0, Math.min(line.discount, unitPrice)),
    imageDataUrl: product.imageDataUrl || undefined
  };
}

export function syncCartLinesWithProducts(
  lines: CartLine[],
  products: Product[],
  reservedByProductId: Record<string, number> = {}
) {
  const byId = new Map(products.map((product) => [product.id, product]));
  const next: CartLine[] = [];
  let changed = false;
  let removed = 0;
  let quantityClamped = 0;

  for (const line of lines) {
    const product = byId.get(line.productId);
    const reserved = Math.max(0, reservedByProductId[line.productId] ?? 0);
    const available = product ? availableAfterParked(product.stock, reserved) : 0;
    const synced = syncCartLineWithProduct(line, product, available);
    if (!synced) {
      changed = true;
      removed += 1;
      continue;
    }
    if (synced.quantity !== line.quantity) {
      changed = true;
      quantityClamped += 1;
    }
    if (
      synced.name !== line.name ||
      synced.sku !== line.sku ||
      synced.barcode !== line.barcode ||
      synced.unitPrice !== line.unitPrice ||
      synced.vatRate !== line.vatRate ||
      synced.discount !== line.discount ||
      (synced.imageDataUrl ?? "") !== (line.imageDataUrl ?? "")
    ) {
      changed = true;
    }
    next.push(synced);
  }

  return { lines: changed ? next : lines, changed, removed, quantityClamped };
}

/**
 * Sync parked bills to the live catalog, then ensure combined parked qty
 * never exceeds on-hand (newest bills keep stock first).
 */
export function syncHeldCartsWithProducts(carts: HeldCart[], products: Product[]) {
  const byId = new Map(products.map((product) => [product.id, product]));
  let changed = false;

  // Newest-first (held list order): claim stock before older parks.
  const usage = new Map<string, number>();
  const next: HeldCart[] = [];

  for (const cart of carts) {
    const lines: CartLine[] = [];
    for (const line of cart.lines) {
      const product = byId.get(line.productId);
      if (!product || !product.isActive) {
        changed = true;
        continue;
      }
      const used = usage.get(line.productId) ?? 0;
      const free = availableAfterParked(product.stock, used);
      const synced = syncCartLineWithProduct(line, product, free);
      if (!synced) {
        changed = true;
        continue;
      }
      if (
        synced.quantity !== line.quantity ||
        synced.name !== line.name ||
        synced.sku !== line.sku ||
        synced.barcode !== line.barcode ||
        synced.unitPrice !== line.unitPrice ||
        synced.vatRate !== line.vatRate ||
        synced.discount !== line.discount ||
        (synced.imageDataUrl ?? "") !== (line.imageDataUrl ?? "")
      ) {
        changed = true;
      }
      usage.set(line.productId, used + synced.quantity);
      lines.push(synced);
    }
    if (lines.length === 0) {
      changed = true;
      continue;
    }
    if (lines !== cart.lines) changed = true;
    next.push({
      ...cart,
      lines,
      billDiscount: Math.max(0, cart.billDiscount || 0)
    });
  }

  return { carts: changed ? next : carts, changed };
}
