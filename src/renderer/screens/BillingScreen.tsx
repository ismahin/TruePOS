import { Banknote, CreditCard, Minus, Pause, Plus, Printer, Receipt, RotateCcw, Search, Trash2, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CartLine, Product, Sale } from "../../shared/contracts";
import { loadActiveBillingSession, saveActiveBillingSession } from "../../shared/billing-session";
import { customerBillLabel, formatParkedDuration, heldCartLabel, nextHeldCartNumber, normalizeHeldCarts, availableAfterParked, parkedQuantityForProduct, parkedQuantitiesByProduct, type HeldCart } from "../../shared/held-carts";
import { buildReceiptHtml, calculatePaymentBalance, calculateTotals, cartLinePayable, formatBdt, roundCashUp } from "../../shared/pos";
import { emitProductsChanged, PRODUCTS_CHANGED_EVENT, syncCartLinesWithProducts, syncHeldCartsWithProducts } from "../../shared/cart-sync";
import { rankBySearchFields } from "../../shared/search";
import { XP365B_SAFE_RECEIPT_WIDTH_DOTS } from "../../shared/xprinter";
import { api } from "../api";
import { friendlyErrorMessage, type Notify } from "../errors";
import { HighlightText, NumericField, ProductThumb, ReceiptPreview, saleStatusMeta, Totals } from "../ui";

const heldCartStorageKey = "truepos.heldCarts";
const heldCartSequenceStorageKey = "truepos.heldCartNextNumber";
const TODAY_SALES_DISPLAY_LIMIT = 12;

function localDateInput(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function saleCustomerLabel(sale: Sale) {
  return [sale.customerName, sale.customerPhone].filter(Boolean).join(" · ") || "Walk-in";
}

function saleTimeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function BillingScreen({ notify, active }: { notify: Notify; active: boolean }) {
  const initialSession = useMemo(() => loadActiveBillingSession(), []);
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>(() => initialSession.cart);
  const [customerName, setCustomerName] = useState(() => initialSession.customerName);
  const [customerPhone, setCustomerPhone] = useState(() => initialSession.customerPhone);
  const [paid, setPaid] = useState(() => initialSession.paid);
  const [billDiscount, setBillDiscount] = useState(() => initialSession.billDiscount);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "mobile">(() => initialSession.paymentMethod);
  const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);
  const [parkedNowMs, setParkedNowMs] = useState(() => Date.now());
  const [lastSaleId, setLastSaleId] = useState(() => initialSession.lastSaleId);
  const [lastReceiptNo, setLastReceiptNo] = useState(() => initialSession.lastReceiptNo);
  const [invoicePreview, setInvoicePreview] = useState("");
  const [todaySales, setTodaySales] = useState<Sale[]>([]);
  const [billQuery, setBillQuery] = useState("");
  const [olderBillMatches, setOlderBillMatches] = useState<Sale[]>([]);
  const [searchingOlderBills, setSearchingOlderBills] = useState(false);
  const [savedBillPreview, setSavedBillPreview] = useState<{ sale: Sale; html: string } | null>(null);
  const [reprintingSaleId, setReprintingSaleId] = useState("");
  const [stockByProductId, setStockByProductId] = useState<Record<string, { stock: number; unit: string }>>({});
  const [busy, setBusy] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const nextHoldNumberRef = useRef(1);
  const billDiscountRef = useRef(billDiscount);
  const paidRef = useRef(paid);
  billDiscountRef.current = billDiscount;
  paidRef.current = paid;
  const totals = useMemo(() => calculateTotals(cart, billDiscount), [cart, billDiscount]);
  const maxBillDiscount = useMemo(() => calculateTotals(cart).grandTotal, [cart]);
  const billLabel = useMemo(() => customerBillLabel(customerName, customerPhone), [customerName, customerPhone]);
  const roundedTender = useMemo(() => roundCashUp(totals.grandTotal), [totals.grandTotal]);
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const exactProduct = hasQuery
    ? products.find((product) => product.barcode.toLowerCase() === trimmedQuery.toLowerCase() || product.sku.toLowerCase() === trimmedQuery.toLowerCase())
    : undefined;
  const priceCheckProduct = hasQuery ? exactProduct ?? products[0] : undefined;
  const resultProducts = priceCheckProduct ? products.filter((product) => product.id !== priceCheckProduct.id) : products;
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const tendered = Number.isFinite(paid) ? Math.max(0, paid) : 0;
  const paymentBalance = calculatePaymentBalance(totals.grandTotal, tendered);

  const resetCustomer = () => {
    setCustomerName("");
    setCustomerPhone("");
  };

  useEffect(() => {
    saveActiveBillingSession({
      cart,
      customerName,
      customerPhone,
      paid,
      billDiscount,
      paymentMethod,
      lastSaleId,
      lastReceiptNo
    });
  }, [cart, customerName, customerPhone, paid, billDiscount, paymentMethod, lastSaleId, lastReceiptNo]);

  useEffect(() => {
    if (heldCarts.length === 0) return;
    setParkedNowMs(Date.now());
    const timer = window.setInterval(() => setParkedNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [heldCarts.length]);

  const loadTodaySales = useCallback(async () => {
    if (typeof api.sales.listSalesForDate !== "function") {
      // Preload not restarted yet after an update — avoid blocking checkout.
      return;
    }
    try {
      setTodaySales(await api.sales.listSalesForDate(localDateInput(), 40));
    } catch (err) {
      notify(friendlyErrorMessage(err, "Today's sales could not be loaded. You can keep selling and try again later."), "warning");
    }
  }, [notify]);

  useEffect(() => {
    if (!active) return;
    void loadTodaySales();
  }, [active, loadTodaySales]);

  const trimmedBillQuery = billQuery.trim();
  const todayBillMatches = useMemo(() => {
    if (!trimmedBillQuery) return todaySales;
    return rankBySearchFields(todaySales, trimmedBillQuery, (sale) => ({
      name: sale.customerName,
      sku: sale.receiptNo,
      barcode: sale.customerPhone,
      category: `${sale.customerPhone} ${sale.cashierName}`.trim()
    }));
  }, [todaySales, trimmedBillQuery]);

  const visibleTodayBills = todayBillMatches.slice(0, TODAY_SALES_DISPLAY_LIMIT);

  useEffect(() => {
    if (!trimmedBillQuery) {
      setOlderBillMatches([]);
      setSearchingOlderBills(false);
      return;
    }
    if (todayBillMatches.length > 0) {
      setOlderBillMatches([]);
      setSearchingOlderBills(false);
      return;
    }
    let cancelled = false;
    setSearchingOlderBills(true);
    const timer = window.setTimeout(() => {
      void api.sales
        .searchReceipts(trimmedBillQuery)
        .then((found) => {
          if (cancelled) return;
          const todayIds = new Set(todaySales.map((sale) => sale.id));
          setOlderBillMatches(found.filter((sale) => !todayIds.has(sale.id)).slice(0, 8));
        })
        .catch((err) => {
          if (cancelled) return;
          setOlderBillMatches([]);
          notify(friendlyErrorMessage(err, "Bill search failed. Check the text and try again."), "error");
        })
        .finally(() => {
          if (!cancelled) setSearchingOlderBills(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmedBillQuery, todayBillMatches.length, todaySales, notify]);

  const viewSavedBill = async (sale: Sale) => {
    try {
      const html = await api.sales.previewSavedReceipt(sale.id);
      setSavedBillPreview({ sale, html });
    } catch (err) {
      notify(friendlyErrorMessage(err, "The bill preview could not be opened. Please try again."), "error");
    }
  };

  const reprintSavedBill = async (sale: Sale) => {
    if (reprintingSaleId) return;
    setReprintingSaleId(sale.id);
    try {
      await api.printing.printReceipt(sale.id);
      notify(`Receipt ${sale.receiptNo} sent to the printer.`);
    } catch (err) {
      notify(friendlyErrorMessage(err, "The bill could not be reprinted. Check the printer and try again."), "error");
    } finally {
      setReprintingSaleId("");
    }
  };

  const rememberStock = useCallback((entries: Array<{ id: string; stock: number; unit: string }>) => {
    if (entries.length === 0) return;
    setStockByProductId((current) => {
      const next = { ...current };
      for (const entry of entries) {
        next[entry.id] = { stock: entry.stock, unit: entry.unit || "pcs" };
      }
      return next;
    });
  }, []);

  const refreshCatalogSnapshots = useCallback(async () => {
    try {
      const catalog = await api.products.list({ includeInactive: true });
      const byId = new Map(catalog.map((product) => [product.id, product]));
      rememberStock(catalog.map((product) => ({ id: product.id, stock: product.stock, unit: product.unit })));
      // Keep open search results in sync after inventory / product edits.
      setProducts((current) => {
        if (current.length === 0) return current;
        let changed = false;
        const next = current.map((product) => {
          const fresh = byId.get(product.id);
          if (!fresh) return product;
          if (
            fresh.stock === product.stock &&
            fresh.price === product.price &&
            fresh.name === product.name &&
            fresh.isActive === product.isActive
          ) {
            return product;
          }
          changed = true;
          return fresh;
        });
        return changed ? next : current;
      });
      let removedFromCart = 0;
      let quantityClamped = 0;
      setHeldCarts((held) => {
        const syncedHeld = syncHeldCartsWithProducts(held, catalog);
        const reserved = parkedQuantitiesByProduct(syncedHeld.carts);
        // Sync active cart after parked reservations are known (microtask avoids nested updater issues).
        queueMicrotask(() => {
          setCart((current) => {
            const synced = syncCartLinesWithProducts(current, catalog, reserved);
            removedFromCart = synced.removed;
            quantityClamped = synced.quantityClamped;
            if (removedFromCart > 0) {
              notify(
                removedFromCart === 1
                  ? "A product in the cart is no longer available and was removed."
                  : `${removedFromCart} products in the cart are no longer available and were removed.`,
                "warning"
              );
            } else if (quantityClamped > 0) {
              notify(
                quantityClamped === 1
                  ? "Cart quantity was reduced to match available stock."
                  : `${quantityClamped} cart quantities were reduced to match available stock.`,
                "warning"
              );
            }
            return synced.lines;
          });
        });
        return syncedHeld.carts;
      });
    } catch {
      // Keep existing cart snapshots if the catalog cannot be refreshed right now.
    }
  }, [notify, rememberStock]);

  useEffect(() => {
    if (!hasQuery) {
      setProducts([]);
      return;
    }
    if (!active) return;
    let cancelled = false;
    api.products
      .search(trimmedQuery)
      .then((found) => {
        if (cancelled) return;
        setProducts(found);
        rememberStock(found.map((product) => ({ id: product.id, stock: product.stock, unit: product.unit })));
      })
      .catch((err) => {
        if (cancelled) return;
        notify(friendlyErrorMessage(err, "Products could not be searched. Please try again."), "error");
      });
    return () => {
      cancelled = true;
    };
  }, [hasQuery, trimmedQuery, notify, rememberStock, active]);

  useEffect(() => {
    const storedNext = window.localStorage.getItem(heldCartSequenceStorageKey);
    const stored = window.localStorage.getItem(heldCartStorageKey);
    if (!stored) {
      nextHoldNumberRef.current = nextHeldCartNumber([], storedNext);
      return;
    }
    try {
      const parsed = JSON.parse(stored) as unknown;
      const normalized = normalizeHeldCarts(parsed);
      nextHoldNumberRef.current = nextHeldCartNumber(normalized, storedNext);
      window.localStorage.setItem(heldCartSequenceStorageKey, String(nextHoldNumberRef.current));
      setHeldCarts(normalized);
    } catch {
      window.localStorage.removeItem(heldCartStorageKey);
      nextHoldNumberRef.current = nextHeldCartNumber([], storedNext);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(heldCartStorageKey, JSON.stringify(heldCarts));
  }, [heldCarts]);

  useEffect(() => {
    const onProductsChanged = () => {
      void refreshCatalogSnapshots();
    };
    window.addEventListener(PRODUCTS_CHANGED_EVENT, onProductsChanged);
    return () => window.removeEventListener(PRODUCTS_CHANGED_EVENT, onProductsChanged);
  }, [refreshCatalogSnapshots]);

  useEffect(() => {
    if (!active) return;
    void refreshCatalogSnapshots();
  }, [active, refreshCatalogSnapshots]);

  const createParkedCart = (name: string, phone: string, lines: CartLine[], discount = 0): HeldCart => {
    const holdNumber = nextHoldNumberRef.current;
    nextHoldNumberRef.current += 1;
    window.localStorage.setItem(heldCartSequenceStorageKey, String(nextHoldNumberRef.current));
    return {
      id: crypto.randomUUID(),
      holdNumber,
      createdAt: new Date().toISOString(),
      customerName: name.trim(),
      customerPhone: phone.trim(),
      lines,
      billDiscount: Math.max(0, discount)
    };
  };

  const holdCart = () => {
    if (cart.length === 0) {
      notify("The cart is empty. Add a product before parking the bill.", "error");
      return;
    }
    const name = customerName.trim();
    const phone = customerPhone.trim();
    if (!name && !phone) {
      notify("Enter a customer name or phone before parking the bill so you can find it later.", "error");
      return;
    }
    for (const line of cart) {
      const onHand = stockByProductId[line.productId]?.stock;
      if (onHand === undefined) continue;
      const alreadyParked = parkedQuantityForProduct(heldCarts, line.productId);
      if (alreadyParked + line.quantity > onHand) {
        const unit = stockByProductId[line.productId]?.unit ?? "pcs";
        notify(
          `Cannot park ${line.name}: only ${onHand} ${unit} in stock, and ${alreadyParked} already on other parked bills.`,
          "warning"
        );
        return;
      }
    }
    const held = createParkedCart(name, phone, cart, billDiscount);
    setHeldCarts((current) => [held, ...current]);
    setCart([]);
    setPaid(0);
    setBillDiscount(0);
    resetCustomer();
    notify(`${heldCartLabel(held)} parked for later.`);
  };

  const assertCartStockForCharge = () => {
    for (const line of cart) {
      const onHand = stockByProductId[line.productId]?.stock;
      if (onHand === undefined) continue;
      const parkedQty = parkedQuantityForProduct(heldCarts, line.productId);
      const free = availableAfterParked(onHand, parkedQty);
      if (line.quantity > free) {
        const unit = stockByProductId[line.productId]?.unit ?? "pcs";
        notify(
          parkedQty > 0
            ? `Cannot charge ${line.name}: only ${free} ${unit} free (${onHand} on hand, ${parkedQty} on parked bills). Resume or clear a parked bill first.`
            : `Cannot charge ${line.name}: only ${free} ${unit} in stock.`,
          "error"
        );
        return false;
      }
    }
    return true;
  };

  const openInvoicePreview = async () => {
    if (busy || cart.length === 0) return;
    if (!assertCartStockForCharge()) return;
    // Commit any focused numeric field (bill discount / paid) before building the voucher.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setBusy(true);
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const liveBillDiscount = billDiscountRef.current;
      const livePaid = Number.isFinite(paidRef.current) ? Math.max(0, paidRef.current) : 0;
      // Build the voucher from the same cart totals the cashier sees, so bill discount cannot drift.
      const [settings, currentUser] = await Promise.all([api.settings.get(), api.auth.getCurrentUser()]);
      if (!currentUser) throw new Error("Login required.");
      const previewTotals = calculateTotals(cart, liveBillDiscount);
      const previewSale = {
        id: "preview",
        receiptNo: "Preview",
        lines: cart,
        payment: { method: paymentMethod, amount: livePaid },
        totals: previewTotals,
        cashierId: currentUser.id,
        cashierName: currentUser.username,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        status: "completed" as const,
        createdAt: new Date().toISOString()
      };
      setInvoicePreview(
        settings.printerMode === "xprinter"
          ? buildReceiptHtml(previewSale, settings, { widthPx: XP365B_SAFE_RECEIPT_WIDTH_DOTS, thermal: true })
          : buildReceiptHtml(previewSale, settings)
      );
    } catch (err) {
      notify(friendlyErrorMessage(err, "The invoice preview could not be prepared. Please try again."), "error");
    } finally {
      setBusy(false);
    }
  };

  const printInvoice = async () => {
    if (busy || cart.length === 0) return;
    if (!assertCartStockForCharge()) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setBusy(true);
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const liveBillDiscount = billDiscountRef.current;
      const livePaid = Number.isFinite(paidRef.current) ? Math.max(0, paidRef.current) : 0;
      const reserved = parkedQuantitiesByProduct(heldCarts);
      const sale = await api.sales.createAndPrintSale(
        cart,
        { method: paymentMethod, amount: livePaid },
        liveBillDiscount,
        { name: customerName, phone: customerPhone },
        reserved
      );
      setCart([]);
      setPaid(0);
      setBillDiscount(0);
      resetCustomer();
      setInvoicePreview("");
      setLastSaleId(sale.id);
      setLastReceiptNo(sale.receiptNo);
      notify(`Sale completed: ${sale.receiptNo}`);
      void loadTodaySales();
      void refreshCatalogSnapshots();
    } catch (err) {
      const detail = friendlyErrorMessage(err, "Check that the receipt printer is connected, powered on, and ready.");
      notify(`Receipt printing failed. The sale was not kept and stock was restored. ${detail}`, "error");
      void refreshCatalogSnapshots();
    } finally {
      setBusy(false);
      scanInputRef.current?.focus();
    }
  };

  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "F2") {
        event.preventDefault();
        scanInputRef.current?.focus();
      }
      if (event.key === "F4") {
        event.preventDefault();
        holdCart();
      }
      if (event.key === "F8") {
        event.preventDefault();
        void openInvoicePreview();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const liveStockFor = (product: Product) => {
    const known = stockByProductId[product.id];
    return {
      stock: known?.stock ?? product.stock,
      unit: known?.unit ?? (product.unit || "pcs")
    };
  };

  const addProduct = async (product: Product) => {
    let { stock, unit } = liveStockFor(product);
    // Prefer a fresh DB read when the UI still thinks stock is empty (e.g. search opened before a stock-in).
    if (stock <= 0) {
      try {
        const catalog = await api.products.list({ includeInactive: true });
        const fresh = catalog.find((entry) => entry.id === product.id);
        if (fresh) {
          stock = fresh.stock;
          unit = fresh.unit || "pcs";
          rememberStock(catalog.map((entry) => ({ id: entry.id, stock: entry.stock, unit: entry.unit })));
          setProducts((current) => current.map((entry) => (entry.id === fresh.id ? fresh : entry)));
        }
      } catch {
        // Fall through with whatever stock we already know.
      }
    } else {
      rememberStock([{ id: product.id, stock, unit }]);
    }
    if (stock <= 0) {
      notify(`${product.name} is out of stock and cannot be added to the cart.`, "error");
      return;
    }
    const parkedQty = parkedQuantityForProduct(heldCarts, product.id);
    const free = availableAfterParked(stock, parkedQty);
    if (free <= 0) {
      notify(
        parkedQty > 0
          ? `${product.name}: all ${stock} in stock are already on parked bills. Resume or clear a parked bill first.`
          : `${product.name} is out of stock and cannot be added to the cart.`,
        "warning"
      );
      return;
    }
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        if (existing.quantity + 1 > free) {
          notify(
            parkedQty > 0
              ? `Only ${free} ${unit} of ${product.name} left for this bill (${parkedQty} already parked for another customer).`
              : `Only ${stock} ${unit} of ${product.name} available. You already have ${existing.quantity} in the cart.`,
            "warning"
          );
          return current;
        }
        return current.map((line) => (line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line));
      }
      return [
        ...current,
        {
          productId: product.id,
          sku: product.sku,
          barcode: product.barcode,
          name: product.name,
          quantity: 1,
          unitPrice: product.price,
          discount: 0,
          vatRate: product.vatRate,
          imageDataUrl: product.imageDataUrl
        }
      ];
    });
    setQuery("");
    scanInputRef.current?.focus();
  };

  const scanOrSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmedQuery) {
      notify("Scan a barcode or type a product name before adding an item.", "error");
      scanInputRef.current?.focus();
      return;
    }
    const searched = await api.products.search(trimmedQuery);
    rememberStock(searched.map((product) => ({ id: product.id, stock: product.stock, unit: product.unit })));
    const match = searched.find((product) => product.barcode === trimmedQuery || product.sku === trimmedQuery) ?? searched[0];
    if (match) void addProduct(match);
    else notify("No product matches that barcode or search. Check the value and try again.", "error");
  };

  const updateLine = (productId: string, patch: Partial<CartLine>) => {
    const stockInfo = stockByProductId[productId];
    const onHand = stockInfo?.stock;
    const unit = stockInfo?.unit ?? "pcs";
    const parkedQty = parkedQuantityForProduct(heldCarts, productId);
    const free = onHand === undefined ? undefined : availableAfterParked(onHand, parkedQty);

    setCart((current) =>
      current.map((line) => {
        if (line.productId !== productId) return line;
        let quantity = Math.max(1, Number(patch.quantity ?? line.quantity));
        if (free !== undefined && quantity > free) {
          quantity = Math.max(1, free);
          notify(
            free <= 0
              ? parkedQty > 0
                ? `${line.name}: all stock is on parked bills.`
                : `${line.name} is out of stock.`
              : parkedQty > 0
                ? `Only ${free} ${unit} of ${line.name} left for this bill (${parkedQty} parked for another customer).`
                : `Only ${free} ${unit} of ${line.name} available.`,
            "warning"
          );
        }
        return {
          ...line,
          ...patch,
          quantity,
          discount: Math.max(0, Math.min(Number(patch.discount ?? line.discount), line.unitPrice))
        };
      })
    );
  };

  const resumeCart = (held: HeldCart) => {
    setInvoicePreview("");
    if (cart.length > 0) {
      const name = customerName.trim();
      const phone = customerPhone.trim();
      if (!name && !phone) {
        notify("Enter a customer name or phone before switching bills so the current cart can be parked.", "error");
        return;
      }
      for (const line of cart) {
        const onHand = stockByProductId[line.productId]?.stock;
        if (onHand === undefined) continue;
        const alreadyParked = parkedQuantityForProduct(
          heldCarts.filter((item) => item.id !== held.id),
          line.productId
        );
        if (alreadyParked + line.quantity > onHand) {
          const unit = stockByProductId[line.productId]?.unit ?? "pcs";
          notify(
            `Cannot park ${line.name} while switching: only ${onHand} ${unit} in stock, and ${alreadyParked} already on other parked bills.`,
            "warning"
          );
          return;
        }
      }
    }
    const outgoing =
      cart.length > 0 ? createParkedCart(customerName, customerPhone, cart, billDiscount) : null;

    setHeldCarts((current) => {
      const withoutTarget = current.filter((item) => item.id !== held.id);
      return outgoing ? [outgoing, ...withoutTarget] : withoutTarget;
    });
    setCart(held.lines);
    setCustomerName(held.customerName);
    setCustomerPhone(held.customerPhone);
    setBillDiscount(held.billDiscount ?? 0);
    setPaid(0);
    scanInputRef.current?.focus();
  };

  const voidCart = () => {
    setCart([]);
    setPaid(0);
    setBillDiscount(0);
    resetCustomer();
    scanInputRef.current?.focus();
  };

  const deleteParkedCart = (held: HeldCart) => {
    const label = heldCartLabel(held);
    setHeldCarts((current) => current.filter((item) => item.id !== held.id));
    notify(`${label} removed from parked bills.`);
  };

  return (
    <section className="screen billing-grid">
      <div className="panel checkout-panel">
        <div className="screen-heading">
          <div>
            <h2>Checkout</h2>
            <p>
              Scan or search · <kbd className="kbd">F2</kbd> focus · <kbd className="kbd">F4</kbd> hold · <kbd className="kbd">F8</kbd> charge
            </p>
          </div>
          <CreditCard />
        </div>
        <form className="scan-bar" onSubmit={scanOrSearch}>
          <Search size={18} />
          <input ref={scanInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Scan barcode or search by name, SKU…" autoFocus />
          <button type="submit">Add</button>
        </form>
        {hasQuery && priceCheckProduct && (
          <button className="price-check" onClick={() => void addProduct(priceCheckProduct)}>
            <span>Best match</span>
            <div className="price-check-main">
              <ProductThumb src={priceCheckProduct.imageDataUrl} alt={priceCheckProduct.name} size="lg" />
              <div className="price-check-copy">
                <strong><HighlightText text={priceCheckProduct.name} query={trimmedQuery} /></strong>
                <div>
                  <b>{formatBdt(priceCheckProduct.price)}</b>
                  <small>
                    SKU <HighlightText text={priceCheckProduct.sku} query={trimmedQuery} /> - VAT {priceCheckProduct.vatRate}% - Stock {liveStockFor(priceCheckProduct).stock}
                  </small>
                </div>
              </div>
            </div>
          </button>
        )}
        {hasQuery && resultProducts.length > 0 && (
          <div className="product-results">
            <div className="section-title">
              <strong>Other matches</strong>
              <span>{resultProducts.length}</span>
            </div>
            {resultProducts.slice(0, 7).map((product) => (
              <button key={product.id} onClick={() => void addProduct(product)} className="result-row">
                <span className="result-product">
                  <ProductThumb src={product.imageDataUrl} alt={product.name} />
                  <span>
                    <strong><HighlightText text={product.name} query={trimmedQuery} /></strong>
                    <small>
                      <HighlightText text={product.sku} query={trimmedQuery} /> - Stock {liveStockFor(product).stock}
                    </small>
                  </span>
                </span>
                <b>{formatBdt(product.price)}</b>
              </button>
            ))}
          </div>
        )}
        <div className="held-sales">
          <div className="section-title">
            <strong>Held bills</strong>
            <span>{heldCarts.length}</span>
          </div>
          <div className="scroll-list held-sales-list">
            {heldCarts.length === 0 && <small>No held bills</small>}
            {heldCarts.map((held) => (
              <div key={held.id} className="held-sale">
                <button type="button" className="held-sale-main" onClick={() => resumeCart(held)}>
                  <span>
                    <strong>{heldCartLabel(held)}</strong>
                    <small>{formatParkedDuration(held.createdAt, parkedNowMs)}</small>
                  </span>
                  <b>{held.lines.reduce((sum, line) => sum + line.quantity, 0)} items</b>
                </button>
                <button
                  type="button"
                  className="ghost icon-only held-sale-delete"
                  title="Remove held bill"
                  aria-label={`Remove held bill ${heldCartLabel(held)}`}
                  onClick={() => deleteParkedCart(held)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="today-sales">
          <div className="section-title">
            <strong>Today's sales</strong>
            <span>{trimmedBillQuery ? visibleTodayBills.length : todaySales.length}</span>
          </div>
          <div className="today-sales-search">
            <Search size={16} />
            <input
              value={billQuery}
              onChange={(event) => setBillQuery(event.target.value)}
              placeholder="Find bill · receipt, name, or phone"
              aria-label="Find today's bill by receipt, name, or phone"
            />
            {billQuery && (
              <button type="button" className="icon-button" onClick={() => setBillQuery("")} aria-label="Clear bill search">
                <X size={16} />
              </button>
            )}
          </div>
          <div className="scroll-list today-sales-list">
            {!trimmedBillQuery && todaySales.length === 0 && <small>No completed sales today yet</small>}
            {trimmedBillQuery && visibleTodayBills.length === 0 && !searchingOlderBills && olderBillMatches.length === 0 && (
              <small>No bill matched today or in recent history</small>
            )}
            {visibleTodayBills.map((sale) => {
              const meta = saleStatusMeta(sale.status);
              return (
                <div key={sale.id} className="today-sale">
                  <button type="button" className="today-sale-main" onClick={() => void viewSavedBill(sale)}>
                    <span>
                      <strong>
                        <HighlightText text={sale.receiptNo} query={trimmedBillQuery} />
                      </strong>
                      <small>
                        {saleTimeLabel(sale.createdAt)} · <HighlightText text={saleCustomerLabel(sale)} query={trimmedBillQuery} />
                      </small>
                    </span>
                    <span className="today-sale-meta">
                      <b>{formatBdt(sale.totals.grandTotal)}</b>
                      <span className={`status-pill ${meta.pill}`}>{meta.label}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ghost icon-only"
                    title="Reprint receipt"
                    aria-label={`Reprint ${sale.receiptNo}`}
                    disabled={Boolean(reprintingSaleId)}
                    onClick={() => void reprintSavedBill(sale)}
                  >
                    <Printer size={16} />
                  </button>
                </div>
              );
            })}
            {trimmedBillQuery && visibleTodayBills.length === 0 && searchingOlderBills && <small>Searching older bills…</small>}
            {olderBillMatches.length > 0 && (
              <>
                <div className="section-title today-sales-older-title">
                  <strong>Older bills</strong>
                  <span>{olderBillMatches.length}</span>
                </div>
                {olderBillMatches.map((sale) => {
                  const meta = saleStatusMeta(sale.status);
                  return (
                    <div key={sale.id} className="today-sale">
                      <button type="button" className="today-sale-main" onClick={() => void viewSavedBill(sale)}>
                        <span>
                          <strong>
                            <HighlightText text={sale.receiptNo} query={trimmedBillQuery} />
                          </strong>
                          <small>
                            {new Date(sale.createdAt).toLocaleDateString()} · <HighlightText text={saleCustomerLabel(sale)} query={trimmedBillQuery} />
                          </small>
                        </span>
                        <span className="today-sale-meta">
                          <b>{formatBdt(sale.totals.grandTotal)}</b>
                          <span className={`status-pill ${meta.pill}`}>{meta.label}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="ghost icon-only"
                        title="Reprint receipt"
                        aria-label={`Reprint ${sale.receiptNo}`}
                        disabled={Boolean(reprintingSaleId)}
                        onClick={() => void reprintSavedBill(sale)}
                      >
                        <Printer size={16} />
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="panel cart-panel">
        <div className="screen-heading">
          <div>
            <h2>Current sale</h2>
            <p>
              <span className="bill-customer-label">{billLabel}</span>
              {" · "}
              {itemCount} {itemCount === 1 ? "item" : "items"}
            </p>
          </div>
          <div className="cart-actions">
            <button className="secondary compact" onClick={holdCart} disabled={cart.length === 0}>
              <Pause size={15} /> Hold
            </button>
            <button className="danger compact" onClick={voidCart} disabled={cart.length === 0}>
              <Trash2 size={15} /> Clear cart
            </button>
          </div>
        </div>
        <div className="customer-fields">
          <label>
            Customer name
            <input
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              placeholder="Optional"
              autoComplete="name"
            />
          </label>
          <label>
            Phone
            <input
              value={customerPhone}
              onChange={(event) => setCustomerPhone(event.target.value)}
              placeholder="Optional"
              inputMode="tel"
              autoComplete="tel"
            />
          </label>
        </div>
        <div className={`cart-lines${cart.length === 0 ? " is-empty" : ""}`}>
          {cart.length > 0 && (
            <div className="cart-line cart-line-header">
              <span>Product</span>
              <span>Qty</span>
              <span>Discount</span>
              <span>Line total</span>
              <span></span>
            </div>
          )}
          {cart.map((line) => {
            const stockInfo = stockByProductId[line.productId];
            const onHand = stockInfo?.stock;
            const parkedQty = parkedQuantityForProduct(heldCarts, line.productId);
            const available = onHand === undefined ? undefined : availableAfterParked(onHand, parkedQty);
            const atStockLimit = available !== undefined && line.quantity >= available;
            const overStock = available !== undefined && line.quantity > available;
            return (
              <div className={`cart-line ${overStock || atStockLimit ? "cart-line-stock-warn" : ""}`} key={line.productId}>
                <div className="cart-product">
                  <ProductThumb src={line.imageDataUrl} alt={line.name} size="sm" />
                  <div>
                    <strong>{line.name}</strong>
                    <small>
                      {line.sku} · {formatBdt(line.unitPrice)} each{line.vatRate > 0 ? ` · VAT ${line.vatRate}%` : ""}
                      {onHand !== undefined ? ` · Stock ${onHand}` : ""}
                      {parkedQty > 0 ? ` · ${parkedQty} parked` : ""}
                    </small>
                    {atStockLimit && (
                      <small className="cart-stock-warning">
                        {available !== undefined && available <= 0
                          ? parkedQty > 0
                            ? "Reserved on a parked bill"
                            : "Out of stock"
                          : parkedQty > 0
                            ? `Only ${available} left after parked bills`
                            : `Only ${available} left in stock`}
                      </small>
                    )}
                  </div>
                </div>
                <div className="qty-stepper">
                  <button type="button" onClick={() => updateLine(line.productId, { quantity: line.quantity - 1 })}><Minus size={14} /></button>
                  <NumericField
                    aria-label="Quantity"
                    min={1}
                    max={available}
                    allowDecimal={false}
                    value={line.quantity}
                    onChange={(quantity) => updateLine(line.productId, { quantity })}
                  />
                  <button
                    type="button"
                    disabled={atStockLimit}
                    title={
                      atStockLimit
                        ? parkedQty > 0
                          ? `Reserved on parked bills (${parkedQty})`
                          : `Only ${available} in stock`
                        : "Increase quantity"
                    }
                    onClick={() => updateLine(line.productId, { quantity: line.quantity + 1 })}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <NumericField
                  aria-label="Discount"
                  min={0}
                  value={line.discount}
                  onChange={(discount) => updateLine(line.productId, { discount })}
                />
                <b>{formatBdt(cartLinePayable(line))}</b>
                <button className="ghost icon-only" title="Remove item" onClick={() => setCart(cart.filter((item) => item.productId !== line.productId))}>
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
        <Totals totals={totals} />
        <div className="payment-box">
          <label>
            Bill discount
            <NumericField
              min={0}
              max={maxBillDiscount}
              value={billDiscount}
              onChange={setBillDiscount}
              aria-label="Bill discount"
            />
          </label>
          <small className="field-hint">Applies to the whole bill after item discounts and VAT</small>
          <label>
            Payment method
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as "cash" | "card" | "mobile")}>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="mobile">Mobile banking</option>
            </select>
          </label>
          <label>
            Amount paid
            <NumericField min={0} value={paid} onChange={setPaid} />
          </label>
          <div className="quick-tender">
            <button onClick={() => setPaid(totals.grandTotal)}><Banknote size={15} /> Exact</button>
            <button onClick={() => setPaid(roundedTender)} title={`Round up to ${formatBdt(roundedTender)}`}>
              Round
            </button>
            <button onClick={() => setPaid((value) => value + 100)}>+100</button>
            <button onClick={() => setPaid((value) => value + 500)}>+500</button>
            <button onClick={() => setPaid((value) => value + 1000)}>+1000</button>
            <button onClick={() => setPaid(0)}><RotateCcw size={15} /> Reset</button>
          </div>
          <div className={`change-due ${paymentBalance.due > 0 ? "is-due" : paid > 0 ? "is-change" : ""}`}>
            <span>{paymentBalance.due > 0 ? "Still to collect" : "Change to return"}</span>
            <strong>{formatBdt(paymentBalance.due > 0 ? paymentBalance.due : paymentBalance.change)}</strong>
          </div>
        </div>
        <button className="primary wide" disabled={busy || cart.length === 0} onClick={openInvoicePreview}>
          <Receipt size={16} /> Charge & Print
        </button>
        {lastSaleId && cart.length === 0 && (
          <div className="last-sale">
            <span>Last sale · {lastReceiptNo}</span>
            <button className="secondary compact" onClick={() => api.printing.printReceipt(lastSaleId).catch((err) => notify(friendlyErrorMessage(err, "The receipt could not be reprinted. Check the printer and try again."), "error"))}>
              <Printer size={15} /> Reprint
            </button>
          </div>
        )}
      </div>
      {invoicePreview && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="invoice-modal">
            <div className="modal-heading">
              <div>
                <h2>Confirm receipt</h2>
                <p>Review totals, then print to complete the sale</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setInvoicePreview("")} aria-label="Close invoice preview"><X size={20} /></button>
            </div>
            <div className="invoice-preview-area">
              <ReceiptPreview html={invoicePreview} title="Invoice print preview" />
            </div>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setInvoicePreview("")} disabled={busy}>
                Back
              </button>
              <button className="primary" onClick={printInvoice} disabled={busy}>
                <Printer size={16} /> Print receipt
              </button>
            </div>
          </div>
        </div>
      )}
      {savedBillPreview && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="invoice-modal">
            <div className="modal-heading">
              <div>
                <h2>{savedBillPreview.sale.receiptNo}</h2>
                <p>
                  {saleCustomerLabel(savedBillPreview.sale)} · {new Date(savedBillPreview.sale.createdAt).toLocaleString()}
                </p>
              </div>
              <button className="icon-button" type="button" onClick={() => setSavedBillPreview(null)} aria-label="Close bill preview"><X size={20} /></button>
            </div>
            <div className="invoice-preview-area">
              <ReceiptPreview html={savedBillPreview.html} title={`Bill ${savedBillPreview.sale.receiptNo}`} />
            </div>
            <div className="modal-actions">
              {(() => {
                const meta = saleStatusMeta(savedBillPreview.sale.status);
                return <span className={`status-pill ${meta.pill}`}>{meta.billLabel}</span>;
              })()}
              <button
                type="button"
                className="secondary"
                disabled={Boolean(reprintingSaleId)}
                onClick={() => void reprintSavedBill(savedBillPreview.sale)}
              >
                <Printer size={16} /> {reprintingSaleId === savedBillPreview.sale.id ? "Printing…" : "Reprint"}
              </button>
              <button type="button" className="primary" onClick={() => setSavedBillPreview(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
