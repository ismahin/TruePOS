import { Banknote, BarChart3, Boxes, CreditCard, Edit3, LogOut, Minus, PackagePlus, Pause, Plus, Printer, Receipt, RefreshCw, RotateCcw, Search, Settings, ShoppingCart, Tag, Trash2, Upload } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, CartLine, InventoryMovement, InventoryValueReport, Product, ProductInput, ProductSalesReport, SalesReport, User } from "../shared/contracts";
import { buildReceiptText, calculateTotals, formatBdt } from "../shared/pos";
import logoUrl from "./assets/truepos-logo-cropped.png";

type Screen = "billing" | "products" | "inventory" | "reports" | "settings";

const api = window.truePOS;

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const [screen, setScreen] = useState<Screen>("billing");
  const [toast, setToast] = useState("");

  useEffect(() => {
    Promise.all([api.auth.isSetupRequired(), api.auth.getCurrentUser()])
      .then(([required, currentUser]) => {
        setSetupRequired(required);
        setUser(currentUser);
      })
      .catch(() => {
        setSetupRequired(false);
        setUser(null);
      });
  }, []);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3500);
  };

  if (setupRequired === null) return null;
  if (setupRequired) {
    return (
      <FirstRunSetup
        onComplete={(createdUser) => {
          setSetupRequired(false);
          setUser(createdUser);
        }}
      />
    );
  }
  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src={logoUrl} alt="TruePOS" />
          <span>Offline retail terminal</span>
        </div>
        <nav>
          <NavButton active={screen === "billing"} icon={<ShoppingCart />} label="Billing" onClick={() => setScreen("billing")} />
          <NavButton active={screen === "products"} icon={<PackagePlus />} label="Products" onClick={() => setScreen("products")} />
          <NavButton active={screen === "inventory"} icon={<Boxes />} label="Inventory" onClick={() => setScreen("inventory")} />
          <NavButton active={screen === "reports"} icon={<BarChart3 />} label="Reports" onClick={() => setScreen("reports")} />
          <NavButton active={screen === "settings"} icon={<Settings />} label="Settings" onClick={() => setScreen("settings")} />
        </nav>
        <div className="user-card">
          <span>{user.username}</span>
          <small>{user.role}</small>
          <button
            className="icon-text"
            onClick={async () => {
              await api.auth.logout();
              setUser(null);
            }}
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </aside>
      <main className="workspace">
        {screen === "billing" && <EnhancedBilling notify={notify} />}
        {screen === "products" && <Products user={user} notify={notify} />}
        {screen === "inventory" && <EnhancedInventory notify={notify} />}
        {screen === "reports" && <Reports />}
        {screen === "settings" && (
          <SettingsScreen
            user={user}
            notify={notify}
            onFactoryReset={() => {
              setUser(null);
              setSetupRequired(true);
              setScreen("billing");
            }}
          />
        )}
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [resetMode, setResetMode] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      onLogin(await api.auth.login(username, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    }
  }

  if (resetMode) {
    return (
      <ResetLoginInfo
        onCancel={() => setResetMode(false)}
        onComplete={(nextUsername) => {
          setUsername(nextUsername);
          setPassword("");
          setNotice("Login information updated. Use the new credentials to sign in.");
          setResetMode(false);
        }}
      />
    );
  }

  return (
    <div className="login-page">
      <form className="login-panel" onSubmit={submit}>
        <img className="login-logo" src={logoUrl} alt="TruePOS" />
        <p>Local encrypted point of sale</p>
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus />
        </label>
        <label>
          Password
          <input value={password} type="password" onChange={(event) => setPassword(event.target.value)} />
        </label>
        {notice && <div className="notice neutral">{notice}</div>}
        {error && <div className="form-error">{error}</div>}
        <button className="primary" type="submit">
          Login
        </button>
        <button className="secondary" type="button" onClick={() => setResetMode(true)}>
          Reset login information
        </button>
      </form>
    </div>
  );
}

function ResetLoginInfo({ onCancel, onComplete }: { onCancel: () => void; onComplete: (adminUsername: string) => void }) {
  const [adminUsername, setAdminUsername] = useState("admin");
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmAdminPassword, setConfirmAdminPassword] = useState("");
  const [resetCashier, setResetCashier] = useState(true);
  const [cashierUsername, setCashierUsername] = useState("cashier");
  const [cashierPassword, setCashierPassword] = useState("");
  const [confirmCashierPassword, setConfirmCashierPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (adminPassword !== confirmAdminPassword) {
      setError("Admin passwords do not match.");
      return;
    }
    if (resetCashier && cashierPassword !== confirmCashierPassword) {
      setError("Cashier passwords do not match.");
      return;
    }
    if (!confirmed) {
      setError("Confirm that only login information will be changed.");
      return;
    }
    try {
      const result = await api.auth.resetLoginCredentials(
        { username: adminUsername, password: adminPassword },
        resetCashier ? { username: cashierUsername, password: cashierPassword } : undefined
      );
      onComplete(result.adminUsername);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login information could not be reset.");
    }
  }

  return (
    <div className="login-page">
      <form className="login-panel setup-panel" onSubmit={submit}>
        <img className="login-logo" src={logoUrl} alt="TruePOS" />
        <h2>Reset Login Information</h2>
        <p>This changes only admin and cashier login details. Products, sales, inventory, reports, settings, and backups remain unchanged.</p>
        <label>
          New admin username
          <input value={adminUsername} onChange={(event) => setAdminUsername(event.target.value)} autoFocus />
        </label>
        <label>
          New admin password
          <input value={adminPassword} type="password" onChange={(event) => setAdminPassword(event.target.value)} />
        </label>
        <label>
          Confirm admin password
          <input value={confirmAdminPassword} type="password" onChange={(event) => setConfirmAdminPassword(event.target.value)} />
        </label>
        <label className="checkbox setup-checkbox">
          <input type="checkbox" checked={resetCashier} onChange={(event) => setResetCashier(event.target.checked)} />
          Reset cashier login too
        </label>
        {resetCashier && (
          <div className="setup-cashier-fields">
            <label>
              New cashier username
              <input value={cashierUsername} onChange={(event) => setCashierUsername(event.target.value)} />
            </label>
            <label>
              New cashier password
              <input value={cashierPassword} type="password" onChange={(event) => setCashierPassword(event.target.value)} />
            </label>
            <label>
              Confirm cashier password
              <input value={confirmCashierPassword} type="password" onChange={(event) => setConfirmCashierPassword(event.target.value)} />
            </label>
          </div>
        )}
        <label className="checkbox">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          I understand this only changes login information
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary" type="submit">
          Save Login Information
        </button>
        <button className="secondary" type="button" onClick={onCancel}>
          Back to Login
        </button>
      </form>
    </div>
  );
}

function FirstRunSetup({ onComplete }: { onComplete: (user: User) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [createCashier, setCreateCashier] = useState(true);
  const [cashierUsername, setCashierUsername] = useState("cashier");
  const [cashierPassword, setCashierPassword] = useState("");
  const [confirmCashierPassword, setConfirmCashierPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (createCashier && cashierPassword !== confirmCashierPassword) {
      setError("Cashier passwords do not match.");
      return;
    }
    try {
      onComplete(
        await api.auth.setupInitialAdmin(
          username,
          password,
          createCashier ? { username: cashierUsername, password: cashierPassword } : undefined
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed.");
    }
  }

  return (
    <div className="login-page">
      <form className="login-panel setup-panel" onSubmit={submit}>
        <img className="login-logo" src={logoUrl} alt="TruePOS" />
        <h2>Create Users</h2>
        <p>Set the admin login for this TruePOS installation.</p>
        <label>
          Admin username
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus />
        </label>
        <label>
          Admin password
          <input value={password} type="password" onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label>
          Confirm admin password
          <input value={confirmPassword} type="password" onChange={(event) => setConfirmPassword(event.target.value)} />
        </label>
        <label className="checkbox setup-checkbox">
          <input type="checkbox" checked={createCashier} onChange={(event) => setCreateCashier(event.target.checked)} />
          Add cashier account
        </label>
        {createCashier && (
          <div className="setup-cashier-fields">
            <label>
              Cashier username
              <input value={cashierUsername} onChange={(event) => setCashierUsername(event.target.value)} />
            </label>
            <label>
              Cashier password
              <input value={cashierPassword} type="password" onChange={(event) => setCashierPassword(event.target.value)} />
            </label>
            <label>
              Confirm cashier password
              <input value={confirmCashierPassword} type="password" onChange={(event) => setConfirmCashierPassword(event.target.value)} />
            </label>
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
        <button className="primary" type="submit">
          Start TruePOS
        </button>
      </form>
    </div>
  );
}

function NavButton(props: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={`nav-button ${props.active ? "active" : ""}`} onClick={props.onClick}>
      {props.icon}
      {props.label}
    </button>
  );
}

function Billing({ notify }: { notify: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paid, setPaid] = useState(0);
  const [receipt, setReceipt] = useState("");
  const totals = useMemo(() => calculateTotals(cart), [cart]);

  useEffect(() => {
    api.products.search(query).then(setProducts).catch(console.error);
  }, [query]);

  const addProduct = (product: Product) => {
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) return current.map((line) => (line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line));
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
          vatRate: product.vatRate
        }
      ];
    });
    setQuery("");
  };

  const scanOrSearch = (event: FormEvent) => {
    event.preventDefault();
    const match = products.find((product) => product.barcode === query || product.sku === query) ?? products[0];
    if (match) addProduct(match);
  };

  const completeSale = async () => {
    const sale = await api.sales.createSale(cart, { method: "cash", amount: paid || totals.grandTotal });
    setReceipt(await api.sales.getReceipt(sale.id));
    setCart([]);
    setPaid(0);
    notify(`Sale completed: ${sale.receiptNo}`);
    await api.printing.printReceipt(sale.id).catch(() => notify("Sale saved, but printing failed."));
  };

  return (
    <section className="screen billing-grid">
      <div className="panel checkout-panel">
        <div className="screen-heading">
          <div>
            <h2>Billing</h2>
            <p>Scanner-ready checkout</p>
          </div>
          <CreditCard />
        </div>
        <form className="scan-bar" onSubmit={scanOrSearch}>
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Scan barcode or search products" autoFocus />
          <button type="submit">Add</button>
        </form>
        <div className="product-results">
          {products.slice(0, 8).map((product) => (
            <button key={product.id} onClick={() => addProduct(product)} className="result-row">
              <span>
                <strong>{product.name}</strong>
                <small>{product.sku} · Stock {product.stock}</small>
              </span>
              <b>{formatBdt(product.price)}</b>
            </button>
          ))}
        </div>
      </div>
      <div className="panel cart-panel">
        <h2>Cart</h2>
        <div className="cart-lines">
          {cart.map((line) => (
            <div className="cart-line" key={line.productId}>
              <div>
                <strong>{line.name}</strong>
                <small>{line.sku}</small>
              </div>
              <input
                type="number"
                min="1"
                value={line.quantity}
                onChange={(event) => setCart(cart.map((item) => (item.productId === line.productId ? { ...item, quantity: Number(event.target.value) } : item)))}
              />
              <input
                type="number"
                min="0"
                value={line.discount}
                onChange={(event) => setCart(cart.map((item) => (item.productId === line.productId ? { ...item, discount: Number(event.target.value) } : item)))}
              />
              <b>{formatBdt((line.unitPrice - line.discount) * line.quantity)}</b>
              <button className="ghost" onClick={() => setCart(cart.filter((item) => item.productId !== line.productId))}>
                Remove
              </button>
            </div>
          ))}
        </div>
        <Totals totals={totals} />
        <label>
          Paid amount
          <input type="number" min="0" value={paid} onChange={(event) => setPaid(Number(event.target.value))} />
        </label>
        <button className="primary wide" disabled={cart.length === 0} onClick={completeSale}>
          Complete & Print
        </button>
        {receipt && <pre className="receipt-preview">{receipt}</pre>}
      </div>
    </section>
  );
}

type HeldCart = {
  id: string;
  label: string;
  createdAt: string;
  lines: CartLine[];
};

const heldCartStorageKey = "truepos.heldCarts";

function EnhancedBilling({ notify }: { notify: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paid, setPaid] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "mobile">("cash");
  const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);
  const [lastSaleId, setLastSaleId] = useState("");
  const [lastReceiptNo, setLastReceiptNo] = useState("");
  const [invoicePreview, setInvoicePreview] = useState("");
  const [busy, setBusy] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const totals = useMemo(() => calculateTotals(cart), [cart]);
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const exactProduct = hasQuery ? products.find((product) => product.barcode === trimmedQuery || product.sku === trimmedQuery) : undefined;
  const priceCheckProduct = hasQuery ? exactProduct ?? products[0] : undefined;
  const resultProducts = priceCheckProduct ? products.filter((product) => product.id !== priceCheckProduct.id) : products;
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const tendered = paid || totals.grandTotal;
  const changeDue = Math.max(0, tendered - totals.grandTotal);
  const paymentReady = paymentMethod !== "cash" || tendered >= totals.grandTotal;

  useEffect(() => {
    if (!hasQuery) {
      setProducts([]);
      return;
    }
    api.products.search(trimmedQuery).then(setProducts).catch(console.error);
  }, [hasQuery, trimmedQuery]);

  useEffect(() => {
    const stored = window.localStorage.getItem(heldCartStorageKey);
    if (stored) setHeldCarts(JSON.parse(stored) as HeldCart[]);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(heldCartStorageKey, JSON.stringify(heldCarts));
  }, [heldCarts]);

  const holdCart = () => {
    if (cart.length === 0) {
      notify("Cart is empty.");
      return;
    }
    const held: HeldCart = {
      id: crypto.randomUUID(),
      label: `Hold ${heldCarts.length + 1} - ${new Date().toLocaleTimeString()}`,
      createdAt: new Date().toISOString(),
      lines: cart
    };
    setHeldCarts([held, ...heldCarts]);
    setCart([]);
    setPaid(0);
    notify(`${held.label} saved.`);
  };

  const openInvoicePreview = async () => {
    if (busy || cart.length === 0) return;
    if (!paymentReady) {
      notify("Paid amount is below the bill total.");
      return;
    }
    setBusy(true);
    try {
      setInvoicePreview(await api.sales.previewReceipt(cart, { method: paymentMethod, amount: tendered }));
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not prepare invoice preview.");
    } finally {
      setBusy(false);
    }
  };

  const printInvoice = async () => {
    if (busy || cart.length === 0) return;
    setBusy(true);
    try {
      const sale = await api.sales.createSale(cart, { method: paymentMethod, amount: tendered });
      try {
        await api.printing.printReceipt(sale.id);
        setCart([]);
        setPaid(0);
        setInvoicePreview("");
        setLastSaleId(sale.id);
        setLastReceiptNo(sale.receiptNo);
        notify(`Sale completed: ${sale.receiptNo}`);
      } catch {
        await api.sales.cancelSale(sale.id);
        notify("Print cancelled. Sale was not completed.");
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "Sale could not be completed.");
    } finally {
      setBusy(false);
      scanInputRef.current?.focus();
    }
  };

  useEffect(() => {
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

  const addProduct = (product: Product) => {
    if (product.stock <= 0) {
      notify(`${product.name} is out of stock.`);
      return;
    }
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        if (existing.quantity + 1 > product.stock) {
          notify(`Only ${product.stock} available for ${product.name}.`);
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
          vatRate: product.vatRate
        }
      ];
    });
    setQuery("");
    scanInputRef.current?.focus();
  };

  const scanOrSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmedQuery) {
      notify("Scan a barcode or type a product name first.");
      scanInputRef.current?.focus();
      return;
    }
    const searched = await api.products.search(trimmedQuery);
    const match = searched.find((product) => product.barcode === trimmedQuery || product.sku === trimmedQuery) ?? searched[0];
    if (match) addProduct(match);
    else notify("No product found for this barcode or search.");
  };

  const updateLine = (productId: string, patch: Partial<CartLine>) => {
    setCart((current) =>
      current.map((line) =>
        line.productId === productId
          ? {
              ...line,
              ...patch,
              quantity: Math.max(1, Number(patch.quantity ?? line.quantity)),
              discount: Math.max(0, Math.min(Number(patch.discount ?? line.discount), line.unitPrice))
            }
          : line
      )
    );
  };

  const resumeCart = (held: HeldCart) => {
    if (cart.length > 0) {
      notify("Void or hold the current cart before resuming another sale.");
      return;
    }
    setCart(held.lines);
    setHeldCarts(heldCarts.filter((item) => item.id !== held.id));
    scanInputRef.current?.focus();
  };

  const voidCart = () => {
    setCart([]);
    setPaid(0);
    scanInputRef.current?.focus();
  };

  return (
    <section className="screen billing-grid">
      <div className="panel checkout-panel">
        <div className="screen-heading">
          <div>
            <h2>Billing</h2>
            <p>Scanner-ready checkout - F2 scan - F4 hold - F8 pay</p>
          </div>
          <CreditCard />
        </div>
        <form className="scan-bar" onSubmit={scanOrSearch}>
          <Search size={18} />
          <input ref={scanInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Scan barcode or search products" autoFocus />
          <button type="submit">Add</button>
        </form>
        {hasQuery && priceCheckProduct && (
          <button className="price-check" onClick={() => addProduct(priceCheckProduct)}>
            <span>Best match</span>
            <strong>{priceCheckProduct.name}</strong>
            <div>
              <b>{formatBdt(priceCheckProduct.price)}</b>
              <small>SKU {priceCheckProduct.sku} - VAT {priceCheckProduct.vatRate}% - Stock {priceCheckProduct.stock}</small>
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
              <button key={product.id} onClick={() => addProduct(product)} className="result-row">
                <span>
                  <strong>{product.name}</strong>
                  <small>{product.sku} - Stock {product.stock}</small>
                </span>
                <b>{formatBdt(product.price)}</b>
              </button>
            ))}
          </div>
        )}
        <div className="held-sales">
          <div className="section-title">
            <strong>Held sales</strong>
            <span>{heldCarts.length}</span>
          </div>
          {heldCarts.length === 0 && <small>No suspended sale</small>}
          {heldCarts.map((held) => (
            <button key={held.id} className="held-sale" onClick={() => resumeCart(held)}>
              <span>{held.label}</span>
              <b>{held.lines.reduce((sum, line) => sum + line.quantity, 0)} items</b>
            </button>
          ))}
        </div>
      </div>
      <div className="panel cart-panel">
        <div className="screen-heading">
          <div>
            <h2>Cart</h2>
            <p>{itemCount} items in transaction</p>
          </div>
          <div className="cart-actions">
            <button className="secondary compact" onClick={holdCart} disabled={cart.length === 0}>
              <Pause size={15} /> Hold
            </button>
            <button className="danger compact" onClick={voidCart} disabled={cart.length === 0}>
              <Trash2 size={15} /> Void
            </button>
          </div>
        </div>
        <div className="cart-lines">
          {cart.length > 0 && (
            <div className="cart-line cart-line-header">
              <span>Product</span>
              <span>Qty</span>
              <span>Discount</span>
              <span>Line total</span>
              <span></span>
            </div>
          )}
          {cart.map((line) => (
            <div className="cart-line" key={line.productId}>
              <div>
                <strong>{line.name}</strong>
                <small>{line.sku} - {formatBdt(line.unitPrice)} each</small>
              </div>
              <div className="qty-stepper">
                <button onClick={() => updateLine(line.productId, { quantity: line.quantity - 1 })}><Minus size={14} /></button>
                <input type="number" min="1" value={line.quantity} onChange={(event) => updateLine(line.productId, { quantity: Number(event.target.value) })} />
                <button onClick={() => updateLine(line.productId, { quantity: line.quantity + 1 })}><Plus size={14} /></button>
              </div>
              <input type="number" min="0" value={line.discount} onChange={(event) => updateLine(line.productId, { discount: Number(event.target.value) })} />
              <b>{formatBdt((line.unitPrice - line.discount) * line.quantity)}</b>
              <button className="ghost icon-only" title="Void item" onClick={() => setCart(cart.filter((item) => item.productId !== line.productId))}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <Totals totals={totals} />
        <div className="payment-box">
          <label>
            Payment method
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as "cash" | "card" | "mobile")}>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="mobile">Mobile banking</option>
            </select>
          </label>
          <label>
            Paid amount
            <input type="number" min="0" value={paid} onChange={(event) => setPaid(Number(event.target.value))} />
          </label>
          <div className="quick-tender">
            <button onClick={() => setPaid(totals.grandTotal)}><Banknote size={15} /> Exact</button>
            <button onClick={() => setPaid((value) => value + 100)}>+100</button>
            <button onClick={() => setPaid((value) => value + 500)}>+500</button>
            <button onClick={() => setPaid((value) => value + 1000)}>+1000</button>
            <button onClick={() => setPaid(0)}><RotateCcw size={15} /> Reset</button>
          </div>
          <div className="change-due">
            <span>Change due</span>
            <strong>{formatBdt(changeDue)}</strong>
          </div>
        </div>
        <button className="primary wide" disabled={busy || cart.length === 0 || !paymentReady} onClick={openInvoicePreview}>
          <Receipt size={16} /> Complete
        </button>
        {lastSaleId && cart.length === 0 && (
          <div className="last-sale">
            <span>Last sale {lastReceiptNo} saved.</span>
            <button className="secondary compact" onClick={() => api.printing.printReceipt(lastSaleId).catch(() => notify("Could not reprint receipt."))}>
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
                <h2>Invoice Preview</h2>
                <p>Review the bill before printing</p>
              </div>
              <button className="ghost icon-only" onClick={() => setInvoicePreview("")}>x</button>
            </div>
            <pre className="invoice-preview">{invoicePreview}</pre>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setInvoicePreview("")} disabled={busy}>
                Cancel
              </button>
              <button className="primary" onClick={printInvoice} disabled={busy}>
                <Printer size={16} /> Print
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

const emptyProductForm: ProductInput = {
  sku: "",
  barcode: "",
  name: "",
  category: "",
  unit: "pcs",
  cost: 0,
  price: 0,
  vatRate: 0,
  stock: 0,
  lowStockThreshold: 0,
  isActive: true
};

function Products({ user, notify }: { user: User; notify: (message: string) => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductInput>(emptyProductForm);
  const [stockQuery, setStockQuery] = useState("");
  const [stockMatches, setStockMatches] = useState<Product[]>([]);
  const [stockProductId, setStockProductId] = useState("");
  const [receiveQty, setReceiveQty] = useState(0);
  const [receiveNote, setReceiveNote] = useState("");
  const [labelQty, setLabelQty] = useState(1);
  const categories = Array.from(new Set(products.map((product) => product.category).filter(Boolean))).sort();
  const selectedStockProduct = stockMatches.find((product) => product.id === stockProductId);
  const metrics = {
    total: products.length,
    active: products.filter((product) => product.isActive).length,
    lowStock: products.filter((product) => product.stock <= product.lowStockThreshold).length,
    retailValue: products.reduce((sum, product) => sum + product.stock * product.price, 0)
  };
  const margin = form.price > 0 ? ((form.price - form.cost) / form.price) * 100 : 0;

  const load = () =>
    api.products
      .list({ query, includeInactive, lowStockOnly, category })
      .then(setProducts)
      .catch((err) => notify(err instanceof Error ? err.message : "Could not load products."));

  useEffect(() => void load(), [query, includeInactive, lowStockOnly, category]);

  useEffect(() => {
    api.products
      .list({ query: stockQuery, includeInactive: false })
      .then((found) => {
        setStockMatches(found);
        setStockProductId((current) => (current && found.some((product) => product.id === current) ? current : found[0]?.id ?? ""));
      })
      .catch(() => setStockMatches([]));
  }, [stockQuery]);

  const resetForm = () => {
    setEditingProduct(null);
    setForm(emptyProductForm);
  };

  const editProduct = (product: Product) => {
    setEditingProduct(product);
    setForm({
      sku: product.sku,
      barcode: product.barcode,
      name: product.name,
      category: product.category,
      unit: product.unit,
      cost: product.cost,
      price: product.price,
      vatRate: product.vatRate,
      stock: product.stock,
      lowStockThreshold: product.lowStockThreshold,
      isActive: product.isActive
    });
  };

  const generateSku = () => {
    const prefix = (form.category || form.name || "TP").replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase() || "TP";
    const suffix = Math.floor(100000 + Math.random() * 900000);
    const sku = `${prefix}-${suffix}`;
    setForm({ ...form, sku, barcode: form.barcode || sku });
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (user.role !== "admin") return;
    const payload = { ...form, barcode: form.barcode || form.sku };
    try {
      if (editingProduct) {
        const { stock: _stock, ...updatePayload } = payload;
        await api.products.update(editingProduct.id, updatePayload);
        notify("Product updated.");
      } else {
        await api.products.create({ ...payload, stock: 0 });
        notify("Product saved.");
      }
      resetForm();
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Product could not be saved.");
    }
  }

  async function receiveStock(event: FormEvent) {
    event.preventDefault();
    if (user.role !== "admin") return;
    if (!selectedStockProduct || receiveQty <= 0) {
      notify("Select a product and enter a quantity greater than zero.");
      return;
    }
    await api.inventory.adjust(selectedStockProduct.id, receiveQty, receiveNote || `Stock received: ${receiveQty}`);
    notify(`${receiveQty} ${selectedStockProduct.unit} added to ${selectedStockProduct.name}.`);
    setReceiveQty(0);
    setReceiveNote("");
    await load();
    const refreshed = await api.products.list({ query: stockQuery, includeInactive: false });
    setStockMatches(refreshed);
  }

  async function printLabelsForStock() {
    if (!selectedStockProduct) {
      notify("Select a product first.");
      return;
    }
    await api.printing.printBarcode(selectedStockProduct.id, Math.max(1, labelQty)).catch(() => notify("Could not print barcode labels."));
  }

  const importCsv = async (file: File | undefined) => {
    if (!file) return;
    const csv = await file.text();
    const result = await api.products.importCsv(csv);
    notify(`Imported ${result.imported}, skipped ${result.skipped}.`);
    await load();
  };

  const deleteProduct = async (product: Product) => {
    if (user.role !== "admin") return;
    const confirmed = window.confirm(`Delete ${product.name}? This will deactivate the product but keep sales and stock history.`);
    if (!confirmed) return;
    await api.products.delete(product.id);
    notify(`${product.name} deleted.`);
    if (editingProduct?.id === product.id) resetForm();
    await load();
  };

  return (
    <section className="screen products-screen">
      <div className="product-metrics">
        <Metric label="Products" value={String(metrics.total)} />
        <Metric label="Active" value={String(metrics.active)} />
        <Metric label="Low stock" value={String(metrics.lowStock)} />
        <Metric label="Retail value" value={formatBdt(metrics.retailValue)} />
      </div>
      <div className="product-management-grid">
      <form className="panel product-form" onSubmit={submit}>
        <div className="screen-heading">
          <div>
            <h2>{editingProduct ? "Edit Product Setup" : "Product Setup"}</h2>
            <p>Create the product identity, barcode, price, VAT, and reorder alert</p>
          </div>
          <button type="button" className="secondary compact" onClick={resetForm}>
            <RefreshCw size={15} /> New
          </button>
        </div>
        {user.role !== "admin" && <div className="notice">Admin permission is required to save products.</div>}
        <div className="notice neutral">Stock quantity is handled separately in Stock Entry. Create the product once, then receive stock by quantity.</div>
        <div className="form-section">
          <label>
            Product name
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </label>
          <label>
            Category
            <input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} list="product-categories" />
          </label>
          <label>
            Unit
            <input value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} />
          </label>
        </div>
        <datalist id="product-categories">
          {categories.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
        <div className="form-section">
          <label>
            SKU
            <input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} required />
          </label>
          <label>
            Barcode
            <input value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} />
          </label>
          <button type="button" className="secondary field-button" onClick={generateSku}>
            <Tag size={16} /> Generate
          </button>
        </div>
        <div className="form-section">
          <NumberInput label="Cost" value={form.cost} onChange={(value) => setForm({ ...form, cost: value })} />
          <NumberInput label="Price" value={form.price} onChange={(value) => setForm({ ...form, price: value })} />
          <NumberInput label="VAT %" value={form.vatRate} onChange={(value) => setForm({ ...form, vatRate: value })} />
          <div className="computed-field">
            <span>Margin</span>
            <strong>{Number.isFinite(margin) ? margin.toFixed(1) : "0.0"}%</strong>
          </div>
        </div>
        <div className="form-section">
          {editingProduct && (
            <div className="computed-field">
              <span>Current stock</span>
              <strong>{editingProduct.stock}</strong>
            </div>
          )}
          <NumberInput label="Low stock alert" value={form.lowStockThreshold} onChange={(value) => setForm({ ...form, lowStockThreshold: value })} />
          <label className="checkbox product-active">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
            Active product
          </label>
        </div>
        <div className="form-actions">
          <button className="primary" type="submit" disabled={user.role !== "admin"}>
            {editingProduct ? "Update Product" : "Save Product"}
          </button>
          <button type="button" className="secondary" onClick={resetForm}>
            Cancel
          </button>
        </div>
      </form>
      <form className="panel stock-entry-panel" onSubmit={receiveStock}>
        <div className="screen-heading">
          <div>
            <h2>Stock Entry</h2>
            <p>Scan/select one product, enter received quantity, then print labels if needed</p>
          </div>
          <Boxes />
        </div>
        {user.role !== "admin" && <div className="notice">Admin permission is required to receive stock.</div>}
        <label>
          Scan barcode or search product
          <input value={stockQuery} onChange={(event) => setStockQuery(event.target.value)} placeholder="Scan barcode, SKU, or product name" />
        </label>
        <label>
          Product
          <select value={stockProductId} onChange={(event) => setStockProductId(event.target.value)}>
            {stockMatches.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} - {product.sku}
              </option>
            ))}
          </select>
        </label>
        {selectedStockProduct && (
          <div className="stock-summary">
            <div>
              <span>Current stock</span>
              <strong>{selectedStockProduct.stock}</strong>
            </div>
            <div>
              <span>After entry</span>
              <strong>{selectedStockProduct.stock + receiveQty}</strong>
            </div>
            <div>
              <span>Barcode</span>
              <strong>{selectedStockProduct.barcode}</strong>
            </div>
          </div>
        )}
        <div className="form-section stock-entry-fields">
          <NumberInput label="Quantity received" value={receiveQty} onChange={setReceiveQty} />
          <input placeholder="Reference / note" value={receiveNote} onChange={(event) => setReceiveNote(event.target.value)} />
        </div>
        <div className="stock-actions">
          <button className="primary" type="submit" disabled={user.role !== "admin" || !selectedStockProduct || receiveQty <= 0}>
            Add Stock
          </button>
          <NumberInput label="Labels" value={labelQty} onChange={setLabelQty} />
          <button type="button" className="secondary" onClick={printLabelsForStock} disabled={!selectedStockProduct}>
            <Printer size={16} /> Print Labels
          </button>
        </div>
      </form>
      </div>
      <div className="panel product-list-panel">
        <div className="screen-heading">
          <div>
            <h2>Product Master</h2>
            <p>Search, edit, print barcode labels, and import catalog data</p>
          </div>
          <label className="secondary compact import-button">
            <Upload size={15} /> CSV Import
            <input type="file" accept=".csv,text/csv" onChange={(event) => void importCsv(event.target.files?.[0])} />
          </label>
        </div>
        <div className="product-filters">
          <input placeholder="Search name, SKU, barcode" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {categories.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <label className="checkbox">
            <input type="checkbox" checked={lowStockOnly} onChange={(event) => setLowStockOnly(event.target.checked)} />
            Low stock
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} />
            Include inactive
          </label>
        </div>
        <div className="product-table">
          <div className="product-row product-row-header">
            <span>Product</span>
            <span>Codes</span>
            <span>Price</span>
            <span>Stock</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          {products.map((product) => (
            <div className="product-row" key={product.id}>
              <div>
                <strong>{product.name}</strong>
                <small>{product.category || "Uncategorized"} - {product.unit}</small>
              </div>
              <div>
                <span>{product.sku}</span>
                <small>{product.barcode}</small>
              </div>
              <div>
                <strong>{formatBdt(product.price)}</strong>
                <small>Cost {formatBdt(product.cost)} - VAT {product.vatRate}%</small>
              </div>
              <div>
                <strong>{product.stock}</strong>
                <small>Alert at {product.lowStockThreshold}</small>
              </div>
              <span className={`status-pill ${product.isActive ? "active" : "inactive"}`}>{product.isActive ? "Active" : "Inactive"}</span>
              <div className="row-actions">
                <button className="secondary compact" onClick={() => editProduct(product)}><Edit3 size={15} /> Edit</button>
                <button className="secondary compact" onClick={() => api.printing.printBarcode(product.id, 1).catch(() => notify("Could not print barcode."))}><Printer size={15} /> Label</button>
                <button className="danger compact" onClick={() => void deleteProduct(product)} disabled={user.role !== "admin" || !product.isActive}><Trash2 size={15} /> Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Inventory({ notify }: { notify: (message: string) => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(0);
  const [note, setNote] = useState("");

  const load = async () => {
    const found = await api.products.search("");
    setProducts(found);
    setProductId((current) => current || found[0]?.id || "");
    setMovements(await api.inventory.listMovements());
  };
  useEffect(() => void load(), []);

  async function adjust(event: FormEvent) {
    event.preventDefault();
    await api.inventory.adjust(productId, quantity, note);
    notify("Inventory adjusted.");
    setQuantity(0);
    setNote("");
    await load();
  }

  return (
    <section className="screen two-column">
      <form className="panel form-grid" onSubmit={adjust}>
        <h2>Inventory Adjustment</h2>
        <select value={productId} onChange={(event) => setProductId(event.target.value)}>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name} · {product.stock}
            </option>
          ))}
        </select>
        <NumberInput label="Quantity change" value={quantity} onChange={setQuantity} />
        <input placeholder="Note" value={note} onChange={(event) => setNote(event.target.value)} />
        <button className="primary" type="submit">
          Save Adjustment
        </button>
      </form>
      <div className="panel">
        <h2>Movement History</h2>
        <DataTable
          headers={["Date", "Product", "Type", "Qty", "Note"]}
          rows={movements.map((movement) => [
            new Date(movement.createdAt).toLocaleString(),
            movement.productName,
            movement.type,
            movement.quantity,
            movement.note
          ])}
        />
      </div>
    </section>
  );
}

function EnhancedInventory({ notify }: { notify: (message: string) => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [productId, setProductId] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [operation, setOperation] = useState<"stock_in" | "stock_out" | "adjustment" | "count">("stock_in");
  const [quantity, setQuantity] = useState(0);
  const [note, setNote] = useState("");
  const [movementFilter, setMovementFilter] = useState("all");
  const selectedProduct = products.find((product) => product.id === productId);
  const lowStockProducts = products.filter((product) => product.stock <= product.lowStockThreshold);
  const outOfStockProducts = products.filter((product) => product.stock <= 0);
  const inventoryMetrics = {
    products: products.length,
    units: products.reduce((sum, product) => sum + product.stock, 0),
    retailValue: products.reduce((sum, product) => sum + product.stock * product.price, 0),
    lowStock: lowStockProducts.length,
    outOfStock: outOfStockProducts.length
  };
  const delta =
    operation === "stock_in" ? quantity :
    operation === "stock_out" ? -quantity :
    operation === "count" && selectedProduct ? quantity - selectedProduct.stock :
    quantity;
  const afterStock = selectedProduct ? selectedProduct.stock + delta : 0;
  const visibleMovements = movements.filter((movement) => movementFilter === "all" || movement.type === movementFilter);

  const load = async () => {
    const found = await api.products.list({ query: productQuery, includeInactive: false });
    setProducts(found);
    setProductId((current) => (current && found.some((product) => product.id === current) ? current : found[0]?.id ?? ""));
    setMovements(await api.inventory.listMovements());
  };

  useEffect(() => void load(), [productQuery]);

  async function saveMovement(event: FormEvent) {
    event.preventDefault();
    if (!selectedProduct) {
      notify("Select a product first.");
      return;
    }
    if (operation !== "count" && quantity <= 0) {
      notify("Quantity must be greater than zero.");
      return;
    }
    if (afterStock < 0) {
      notify("Stock cannot go below zero.");
      return;
    }
    const movementType = operation === "count" ? "adjustment" : operation;
    const reason = note || (operation === "count" ? `Cycle count: ${quantity}` : operation.replace("_", " "));
    try {
      await api.inventory.adjust(selectedProduct.id, delta, reason, movementType);
      notify("Inventory updated.");
      setQuantity(0);
      setNote("");
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Inventory could not be updated.");
    }
  }

  return (
    <section className="screen inventory-screen">
      <div className="product-metrics">
        <Metric label="Products" value={String(inventoryMetrics.products)} />
        <Metric label="Units on hand" value={String(inventoryMetrics.units)} />
        <Metric label="Retail value" value={formatBdt(inventoryMetrics.retailValue)} />
        <Metric label="Low stock" value={String(inventoryMetrics.lowStock)} />
        <Metric label="Out of stock" value={String(inventoryMetrics.outOfStock)} />
      </div>
      <div className="inventory-grid">
        <form className="panel stock-entry-panel" onSubmit={saveMovement}>
          <div className="screen-heading">
            <div>
              <h2>Stock Control</h2>
              <p>Receive stock, remove stock, reconcile counts, and keep an audit trail</p>
            </div>
            <Boxes />
          </div>
          <div className="inventory-modes">
            <button type="button" className={operation === "stock_in" ? "mode active" : "mode"} onClick={() => setOperation("stock_in")}>Stock In</button>
            <button type="button" className={operation === "stock_out" ? "mode active" : "mode"} onClick={() => setOperation("stock_out")}>Stock Out</button>
            <button type="button" className={operation === "adjustment" ? "mode active" : "mode"} onClick={() => setOperation("adjustment")}>Adjustment</button>
            <button type="button" className={operation === "count" ? "mode active" : "mode"} onClick={() => setOperation("count")}>Cycle Count</button>
          </div>
          <label>
            Scan barcode or search product
            <input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Barcode, SKU, or product name" />
          </label>
          <label>
            Product
            <select value={productId} onChange={(event) => setProductId(event.target.value)}>
              {products.map((product) => (
                <option key={product.id} value={product.id}>{product.name} - {product.sku}</option>
              ))}
            </select>
          </label>
          {selectedProduct && (
            <div className="stock-summary">
              <div><span>Current</span><strong>{selectedProduct.stock}</strong></div>
              <div><span>{operation === "count" ? "Counted" : "Change"}</span><strong>{operation === "count" ? quantity : delta}</strong></div>
              <div><span>After</span><strong>{afterStock}</strong></div>
            </div>
          )}
          <div className="form-section stock-entry-fields">
            <NumberInput label={operation === "count" ? "Counted quantity" : "Quantity"} value={quantity} onChange={setQuantity} />
            <input placeholder="Reason / reference" value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <button className="primary" type="submit" disabled={!selectedProduct || afterStock < 0}>
            Save Stock Movement
          </button>
        </form>
        <div className="panel">
          <div className="screen-heading">
            <div>
              <h2>Reorder Attention</h2>
              <p>Products at or below alert level</p>
            </div>
            <span className="status-pill inactive">{lowStockProducts.length}</span>
          </div>
          <div className="reorder-list">
            {lowStockProducts.length === 0 && <div className="empty-state">No low-stock products.</div>}
            {lowStockProducts.slice(0, 8).map((product) => (
              <div className="reorder-row" key={product.id}>
                <div>
                  <strong>{product.name}</strong>
                  <small>{product.sku} - Alert at {product.lowStockThreshold}</small>
                </div>
                <b>{product.stock}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="screen-heading">
          <div>
            <h2>Stock Overview</h2>
            <p>Real-time on-hand quantity and inventory value</p>
          </div>
          <input className="panel-search" placeholder="Filter products" value={productQuery} onChange={(event) => setProductQuery(event.target.value)} />
        </div>
        <div className="inventory-table">
          <div className="inventory-row inventory-row-header">
            <span>Product</span><span>On hand</span><span>Alert</span><span>Retail value</span><span>Status</span>
          </div>
          {products.map((product) => (
            <div className="inventory-row" key={product.id}>
              <div><strong>{product.name}</strong><small>{product.sku} - {product.category || "Uncategorized"}</small></div>
              <strong>{product.stock}</strong>
              <span>{product.lowStockThreshold}</span>
              <strong>{formatBdt(product.stock * product.price)}</strong>
              <span className={`status-pill ${product.stock <= 0 ? "inactive" : product.stock <= product.lowStockThreshold ? "warning" : "active"}`}>
                {product.stock <= 0 ? "Out" : product.stock <= product.lowStockThreshold ? "Low" : "OK"}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="screen-heading">
          <div>
            <h2>Movement History</h2>
            <p>Audit trail for receipts, removals, counts, sales, and returns</p>
          </div>
          <select value={movementFilter} onChange={(event) => setMovementFilter(event.target.value)}>
            <option value="all">All movements</option>
            <option value="stock_in">Stock in</option>
            <option value="stock_out">Stock out</option>
            <option value="adjustment">Adjustment/count</option>
            <option value="sale">Sales</option>
            <option value="return">Returns</option>
          </select>
        </div>
        <DataTable
          headers={["Date", "Product", "Type", "Qty", "Note"]}
          rows={visibleMovements.map((movement) => [
            new Date(movement.createdAt).toLocaleString(),
            movement.productName,
            movement.type,
            movement.quantity,
            movement.note
          ])}
        />
      </div>
    </section>
  );
}

function Reports() {
  const today = toDateInput(new Date());
  const [dateFrom, setDateFrom] = useState(toDateInput(addDays(new Date(), -6)));
  const [dateTo, setDateTo] = useState(today);
  const [dailyReports, setDailyReports] = useState<SalesReport[]>([]);
  const [topProducts, setTopProducts] = useState<ProductSalesReport[]>([]);
  const [inventoryValue, setInventoryValue] = useState<InventoryValueReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const rangeDates = useMemo(() => buildDateRange(dateFrom, dateTo).slice(-31), [dateFrom, dateTo]);
  const totals = useMemo(() => summarizeReports(dailyReports), [dailyReports]);
  const bestProduct = topProducts[0];
  const inventoryProfit = inventoryValue ? inventoryValue.retailValue - inventoryValue.costValue : 0;
  const inventoryMargin = inventoryValue?.retailValue ? (inventoryProfit / inventoryValue.retailValue) * 100 : 0;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([
      Promise.all(rangeDates.map((date) => api.reports.getDailySales(date))),
      api.reports.getProductSales(dateFrom, dateTo),
      api.reports.getInventoryValue()
    ])
      .then(([daily, products, inventory]) => {
        if (!active) return;
        setDailyReports(daily);
        setTopProducts(products);
        setInventoryValue(inventory);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Reports could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dateFrom, dateTo, rangeDates]);

  const setPreset = (days: number) => {
    setDateTo(today);
    setDateFrom(toDateInput(addDays(new Date(), -(days - 1))));
  };

  return (
    <section className="screen reports-screen">
      <div className="panel report-hero">
        <div className="screen-heading">
          <div>
            <h2>Sales Reporting & Analytics</h2>
            <p>Revenue, profit, product performance, VAT, and inventory health</p>
          </div>
          <div className="report-presets">
            <button className="secondary compact" onClick={() => setPreset(1)}>Today</button>
            <button className="secondary compact" onClick={() => setPreset(7)}>7 days</button>
            <button className="secondary compact" onClick={() => setPreset(30)}>30 days</button>
          </div>
        </div>
        <div className="report-filters">
          <label>
            From
            <input type="date" value={dateFrom} max={dateTo} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={dateTo} min={dateFrom} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          <div className="range-note">
            <span>{rangeDates.length} day trend</span>
            <small>{rangeDates.length === 31 ? "Trend is capped at latest 31 days for fast loading." : "Range summary uses selected dates."}</small>
          </div>
        </div>
        {error && <div className="notice">{error}</div>}
        {loading && <div className="notice neutral">Loading report data...</div>}
        <div className="metric-grid report-metrics">
          <Metric label="Net sales" value={formatBdt(totals.grandTotal)} />
          <Metric label="Profit estimate" value={formatBdt(totals.profitEstimate)} />
          <Metric label="Transactions" value={String(totals.salesCount)} />
          <Metric label="Average sale" value={formatBdt(totals.salesCount ? totals.grandTotal / totals.salesCount : 0)} />
          <Metric label="VAT collected" value={formatBdt(totals.vatTotal)} />
          <Metric label="Discounts" value={formatBdt(totals.discountTotal)} />
        </div>
      </div>

      <div className="report-grid">
        <div className="panel chart-panel">
          <div className="screen-heading">
            <div>
              <h2>Sales Trend</h2>
              <p>Daily net sales and transaction count</p>
            </div>
            <strong>{formatBdt(totals.grandTotal)}</strong>
          </div>
          <TrendChart reports={dailyReports} />
        </div>
        <div className="panel chart-panel">
          <div className="screen-heading">
            <div>
              <h2>Profit Snapshot</h2>
              <p>Estimated gross profit against net sales</p>
            </div>
            <span className="status-pill active">{formatPercent(totals.grandTotal ? (totals.profitEstimate / totals.grandTotal) * 100 : 0)}</span>
          </div>
          <ProgressChart
            rows={[
              { label: "Net sales", value: totals.grandTotal, color: "#0f766e" },
              { label: "Profit", value: totals.profitEstimate, color: "#2563eb" },
              { label: "VAT", value: totals.vatTotal, color: "#c2410c" },
              { label: "Discount", value: totals.discountTotal, color: "#be123c" }
            ]}
          />
        </div>
      </div>

      <div className="report-grid">
        <div className="panel chart-panel">
          <div className="screen-heading">
            <div>
              <h2>Top Products</h2>
              <p>Revenue leaders for selected range</p>
            </div>
            {bestProduct && <strong>{bestProduct.name}</strong>}
          </div>
          <ProductRevenueChart products={topProducts.slice(0, 8)} />
        </div>
        <div className="panel chart-panel">
          <div className="screen-heading">
            <div>
              <h2>Inventory Health</h2>
              <p>Stock value, margin, and low-stock pressure</p>
            </div>
            {inventoryValue && <span className="status-pill warning">{inventoryValue.lowStockCount} low</span>}
          </div>
          {inventoryValue ? (
            <>
              <div className="inventory-value-cards">
                <Metric label="Products" value={String(inventoryValue.products)} />
                <Metric label="Units" value={String(inventoryValue.units)} />
                <Metric label="Cost value" value={formatBdt(inventoryValue.costValue)} />
                <Metric label="Retail value" value={formatBdt(inventoryValue.retailValue)} />
              </div>
              <ProgressChart
                rows={[
                  { label: "Retail value", value: inventoryValue.retailValue, color: "#0f766e" },
                  { label: "Cost value", value: inventoryValue.costValue, color: "#475467" },
                  { label: "Stock margin", value: Math.max(0, inventoryProfit), color: "#2563eb" },
                  { label: "Low stock items", value: inventoryValue.lowStockCount, color: "#c2410c" }
                ]}
              />
              <div className="report-insight">
                <strong>{formatPercent(inventoryMargin)}</strong>
                <span>estimated margin in current inventory value</span>
              </div>
            </>
          ) : (
            <div className="empty-state">Inventory value is not available.</div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="screen-heading">
          <div>
            <h2>Product Sales Detail</h2>
            <p>Quantity and revenue by product</p>
          </div>
        </div>
        <DataTable
          headers={["Product", "SKU", "Qty sold", "Revenue", "Share"]}
          rows={topProducts.map((product) => [
            product.name,
            product.sku,
            product.quantity,
            formatBdt(product.revenue),
            formatPercent(totals.grandTotal ? (product.revenue / totals.grandTotal) * 100 : 0)
          ])}
        />
      </div>
    </section>
  );
}

function TrendChart({ reports }: { reports: SalesReport[] }) {
  const max = Math.max(...reports.map((report) => report.grandTotal), 0);
  if (reports.length === 0 || max === 0) return <div className="empty-state">No sales found for this date range.</div>;
  return (
    <div className="trend-chart">
      {reports.map((report) => {
        const height = Math.max(8, (report.grandTotal / max) * 100);
        return (
          <div className="trend-day" key={report.date} title={`${report.date}: ${formatBdt(report.grandTotal)}`}>
            <div className="trend-bar-wrap">
              <span className="trend-bar" style={{ height: `${height}%` }} />
            </div>
            <small>{shortDate(report.date)}</small>
            <b>{report.salesCount}</b>
          </div>
        );
      })}
    </div>
  );
}

function ProductRevenueChart({ products }: { products: ProductSalesReport[] }) {
  const max = Math.max(...products.map((product) => product.revenue), 0);
  if (products.length === 0 || max === 0) return <div className="empty-state">No product sales found for this range.</div>;
  return (
    <div className="bar-list">
      {products.map((product) => (
        <div className="bar-row" key={product.productId}>
          <div>
            <strong>{product.name}</strong>
            <small>{product.quantity} sold - {product.sku}</small>
          </div>
          <div className="bar-track">
            <span style={{ width: `${Math.max(4, (product.revenue / max) * 100)}%` }} />
          </div>
          <b>{formatBdt(product.revenue)}</b>
        </div>
      ))}
    </div>
  );
}

function ProgressChart({ rows }: { rows: Array<{ label: string; value: number; color: string }> }) {
  const max = Math.max(...rows.map((row) => row.value), 0);
  if (max === 0) return <div className="empty-state">No values to graph yet.</div>;
  return (
    <div className="progress-chart">
      {rows.map((row) => (
        <div className="progress-row" key={row.label}>
          <div>
            <span>{row.label}</span>
            <strong>{row.label.includes("items") ? row.value : formatBdt(row.value)}</strong>
          </div>
          <div className="bar-track">
            <span style={{ width: `${Math.max(4, (row.value / max) * 100)}%`, background: row.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function summarizeReports(reports: SalesReport[]): SalesReport {
  return reports.reduce(
    (sum, report) => ({
      date: "range",
      salesCount: sum.salesCount + report.salesCount,
      subtotal: sum.subtotal + report.subtotal,
      discountTotal: sum.discountTotal + report.discountTotal,
      vatTotal: sum.vatTotal + report.vatTotal,
      grandTotal: sum.grandTotal + report.grandTotal,
      profitEstimate: sum.profitEstimate + report.profitEstimate
    }),
    { date: "range", salesCount: 0, subtotal: 0, discountTotal: 0, vatTotal: 0, grandTotal: 0, profitEstimate: 0 }
  );
}

function buildDateRange(dateFrom: string, dateTo: string) {
  const start = new Date(`${dateFrom}T00:00:00`);
  const end = new Date(`${dateTo}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const dates: string[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    dates.push(toDateInput(cursor));
  }
  return dates;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shortDate(date: string) {
  const [, month, day] = date.split("-");
  return `${month}/${day}`;
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function SettingsScreen({ user, notify, onFactoryReset }: { user: User; notify: (message: string) => void; onFactoryReset: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [printers, setPrinters] = useState<string[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [labelProductId, setLabelProductId] = useState("");
  const [labelQuantity, setLabelQuantity] = useState(1);

  const load = async () => {
    const [nextSettings, nextProducts] = await Promise.all([
      api.settings.get(),
      api.products.list({ includeInactive: false }).catch(() => api.products.search(""))
    ]);
    setSettings(nextSettings);
    setProducts(nextProducts);
    setLabelProductId((current) => (current && nextProducts.some((product) => product.id === current) ? current : nextProducts[0]?.id ?? ""));
    api.printing.listPrinters().then(setPrinters).catch(() => setPrinters([]));
  };

  useEffect(() => void load(), []);

  if (!settings) return null;

  const selectedLabelProduct = products.find((product) => product.id === labelProductId) ?? products[0];
  const sampleLine: CartLine = {
    productId: "sample",
    sku: "SAMPLE",
    barcode: "89900010001",
    name: "Sample Product",
    quantity: 2,
    unitPrice: 120,
    discount: 5,
    vatRate: 15
  };
  const previewReceipt = buildReceiptText(
    {
      id: "preview",
      receiptNo: "TP-PREVIEW",
      lines: [sampleLine],
      payment: { method: "cash", amount: 300 },
      totals: calculateTotals([sampleLine]),
      cashierId: user.id,
      cashierName: user.username,
      status: "completed",
      createdAt: new Date().toISOString()
    },
    settings
  );

  const updateReceipt = (receipt: Partial<AppSettings["receipt"]>) => {
    setSettings({ ...settings, receipt: { ...settings.receipt, ...receipt } });
  };

  const updateBarcode = (barcode: Partial<AppSettings["barcode"]>) => {
    setSettings({ ...settings, barcode: { ...settings.barcode, ...barcode } });
  };

  const handleLogoUpload = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxWidth = 512;
        const ratio = Math.min(1, maxWidth / image.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));
        canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
        updateReceipt({ logoDataUrl: canvas.toDataURL("image/png") });
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    try {
      setSettings(await api.settings.update(settings));
      notify("Settings saved.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Settings could not be saved.");
    }
  };

  const importBackup = async () => {
    try {
      const path = await api.backup.importEncrypted();
      notify(`Backup imported: ${path}`);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Backup import failed.");
    }
  };

  const connectGoogleDrive = async () => {
    try {
      setSettings(await api.settings.update(settings));
      setSettings(await api.backup.connectGoogleDrive());
      notify("Google Drive connected.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Google Drive connection failed.");
    }
  };

  const backupGoogleDriveNow = async () => {
    try {
      setSettings(await api.settings.update(settings));
      setSettings(await api.backup.backupGoogleDriveNow());
      notify("Google Drive backup uploaded.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Google Drive backup failed.");
    }
  };

  const disconnectGoogleDrive = async () => {
    try {
      setSettings(await api.backup.disconnectGoogleDrive());
      notify("Google Drive disconnected.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not disconnect Google Drive.");
    }
  };

  const factoryReset = async () => {
    const confirmed = window.confirm("Factory reset will permanently delete products, inventory, sales, settings, users, and backup connections from this PC. Continue?");
    if (!confirmed) return;
    const finalConfirmed = window.confirm("This cannot be undone unless you already exported a backup. Reset TruePOS now?");
    if (!finalConfirmed) return;
    try {
      await api.backup.factoryReset();
      onFactoryReset();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Factory reset failed.");
    }
  };

  return (
    <section className="screen settings-screen">
      {user.role !== "admin" && <div className="notice">Admin permission is required to update settings.</div>}
      <div className="settings-title panel">
        <div>
          <h2>Settings</h2>
          <p>Printer mapping, receipt branding, barcode labels, and local database backup</p>
        </div>
        <button className="primary" disabled={user.role !== "admin"} onClick={save}>
          <Settings size={16} /> Save Settings
        </button>
      </div>

      <div className="settings-layout">
        <div className="settings-editor">
          <div className="panel form-grid">
            <div className="screen-heading">
              <div>
                <h2>Shop Profile</h2>
                <p>Used on receipts and print previews</p>
              </div>
            </div>
            <label>
              Shop name
              <input value={settings.shopName} onChange={(event) => setSettings({ ...settings, shopName: event.target.value })} />
            </label>
            <div className="form-section">
              <label>
                Receipt language
                <select value={settings.receipt.language} onChange={(event) => updateReceipt({ language: event.target.value as "en" | "bn" })}>
                  <option value="en">English</option>
                  <option value="bn">Bangla ready</option>
                </select>
              </label>
              <label>
                Printer mode
                <select value={settings.printerMode} onChange={(event) => setSettings({ ...settings, printerMode: event.target.value as "windows" | "escpos" })}>
                  <option value="windows">Windows printer driver</option>
                  <option value="escpos">ESC/POS compatible</option>
                </select>
              </label>
            </div>
          </div>

          <div className="panel form-grid">
            <div className="screen-heading">
              <div>
                <h2>POS Receipt Printer</h2>
                <p>Thermal receipt paper, font, padding, header, footer, and VAT display</p>
              </div>
              <button className="secondary compact" onClick={() => api.printing.listPrinters().then(setPrinters).catch(() => setPrinters([]))}>
                <RefreshCw size={15} /> Refresh
              </button>
            </div>
            <label>
              Receipt printer
              <select value={settings.receiptPrinter} onChange={(event) => setSettings({ ...settings, receiptPrinter: event.target.value })}>
                <option value="">Default printer</option>
                {printers.map((printer) => (
                  <option key={printer}>{printer}</option>
                ))}
              </select>
            </label>
            <div className="form-section">
              <label>
                Paper width
                <select value={settings.receipt.widthMm} onChange={(event) => updateReceipt({ widthMm: Number(event.target.value) as 58 | 80 })}>
                  <option value={58}>58mm</option>
                  <option value={80}>80mm</option>
                </select>
              </label>
              <label>
                Font
                <select value={settings.receipt.fontFamily} onChange={(event) => updateReceipt({ fontFamily: event.target.value })}>
                  <option value="Consolas">Consolas</option>
                  <option value="Arial">Arial</option>
                  <option value="Segoe UI">Segoe UI</option>
                </select>
              </label>
              <NumberInput label="Font size" value={settings.receipt.fontSize} onChange={(value) => updateReceipt({ fontSize: value })} />
              <NumberInput label="Padding" value={settings.receipt.padding} onChange={(value) => updateReceipt({ padding: value })} />
            </div>
            <label>
              Header text
              <textarea value={settings.receipt.header} onChange={(event) => updateReceipt({ header: event.target.value })} />
            </label>
            <label>
              Footer text
              <textarea value={settings.receipt.footer} onChange={(event) => updateReceipt({ footer: event.target.value })} />
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={settings.receipt.showVatBreakdown} onChange={(event) => updateReceipt({ showVatBreakdown: event.target.checked })} />
              Show VAT breakdown on receipt
            </label>
            <button className="secondary" onClick={() => api.printing.testReceipt().catch((err) => notify(err instanceof Error ? err.message : "Receipt test failed."))}>
              <Printer size={16} /> Test Receipt Print
            </button>
          </div>

          <div className="panel form-grid">
            <div className="screen-heading">
              <div>
                <h2>Receipt Logo</h2>
                <p>Upload once, then resize for consistent thermal printer output</p>
              </div>
            </div>
            <label className="logo-upload">
              <Upload size={16} />
              <span>Upload logo image</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handleLogoUpload(event.target.files?.[0])} />
            </label>
            <div className="form-section">
              <NumberInput label="Logo width mm" value={settings.receipt.logoWidthMm} onChange={(value) => updateReceipt({ logoWidthMm: value })} />
              <NumberInput label="Logo height mm" value={settings.receipt.logoHeightMm} onChange={(value) => updateReceipt({ logoHeightMm: value })} />
              <label>
                Logo scaling {settings.receipt.logoScale}%
                <input type="range" min={25} max={200} value={settings.receipt.logoScale} onChange={(event) => updateReceipt({ logoScale: Number(event.target.value) })} />
              </label>
              <label>
                Move left/right {settings.receipt.logoOffsetX}px
                <input type="range" min={-80} max={80} value={settings.receipt.logoOffsetX} onChange={(event) => updateReceipt({ logoOffsetX: Number(event.target.value) })} />
              </label>
              <label>
                Move up/down {settings.receipt.logoOffsetY}px
                <input type="range" min={-30} max={50} value={settings.receipt.logoOffsetY} onChange={(event) => updateReceipt({ logoOffsetY: Number(event.target.value) })} />
              </label>
            </div>
            <button className="secondary" disabled={!settings.receipt.logoDataUrl} onClick={() => updateReceipt({ logoDataUrl: "" })}>
              <Trash2 size={16} /> Remove Logo
            </button>
          </div>

          <div className="panel form-grid">
            <div className="screen-heading">
              <div>
                <h2>Barcode Label Printer</h2>
                <p>Code128 labels for product stickers</p>
              </div>
            </div>
            <label>
              Barcode printer
              <select value={settings.barcodePrinter} onChange={(event) => setSettings({ ...settings, barcodePrinter: event.target.value })}>
                <option value="">Default printer</option>
                {printers.map((printer) => (
                  <option key={printer}>{printer}</option>
                ))}
              </select>
            </label>
            <div className="form-section">
              <NumberInput label="Label width mm" value={settings.barcode.labelWidthMm} onChange={(value) => updateBarcode({ labelWidthMm: value })} />
              <NumberInput label="Label height mm" value={settings.barcode.labelHeightMm} onChange={(value) => updateBarcode({ labelHeightMm: value })} />
              <NumberInput label="Padding" value={settings.barcode.padding} onChange={(value) => updateBarcode({ padding: value })} />
              <NumberInput label="Test quantity" value={labelQuantity} onChange={setLabelQuantity} />
            </div>
            <div className="form-section">
              <label>
                Test product
                <select value={labelProductId} onChange={(event) => setLabelProductId(event.target.value)}>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>{product.name} - {product.barcode}</option>
                  ))}
                </select>
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={settings.barcode.showName} onChange={(event) => updateBarcode({ showName: event.target.checked })} />
                Show product name
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={settings.barcode.showPrice} onChange={(event) => updateBarcode({ showPrice: event.target.checked })} />
                Show price
              </label>
            </div>
            <button className="secondary" disabled={!selectedLabelProduct} onClick={() => selectedLabelProduct && api.printing.printBarcode(selectedLabelProduct.id, Math.max(1, labelQuantity)).catch((err) => notify(err instanceof Error ? err.message : "Barcode test failed."))}>
              <Printer size={16} /> Print Test Labels
            </button>
          </div>

          <div className="panel form-grid">
            <div className="screen-heading">
              <div>
                <h2>Database Backup</h2>
                <p>Encrypted full backup plus CSV exports for external reporting</p>
              </div>
            </div>
            <div className="drive-backup-box">
              <div className="screen-heading">
                <div>
                  <h2>Google Drive Backup</h2>
                  <p>Connect a Google account, upload now, or run an automatic daily backup</p>
                </div>
                <span className={`status-pill ${settings.googleDrive.connected ? "active" : "inactive"}`}>
                  {settings.googleDrive.connected ? "Connected" : "Not connected"}
                </span>
              </div>
              <div className="form-section">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={settings.googleDrive.autoBackupEnabled}
                    disabled={!settings.googleDrive.connected}
                    onChange={(event) => setSettings({ ...settings, googleDrive: { ...settings.googleDrive, autoBackupEnabled: event.target.checked } })}
                  />
                  Automatic daily backup
                </label>
                <label>
                  Backup time
                  <input
                    type="time"
                    value={settings.googleDrive.backupTime}
                    onChange={(event) => setSettings({ ...settings, googleDrive: { ...settings.googleDrive, backupTime: event.target.value } })}
                  />
                </label>
              </div>
              <div className="drive-status">
                <span>{settings.googleDrive.accountEmail || "No Google account connected"}</span>
                <small>{settings.googleDrive.lastBackupAt ? `Last backup: ${new Date(settings.googleDrive.lastBackupAt).toLocaleString()}` : "No Google Drive backup yet"}</small>
                {settings.googleDrive.lastBackupStatus && <small>{settings.googleDrive.lastBackupStatus}</small>}
              </div>
              <div className="backup-actions">
                <button className="secondary" disabled={user.role !== "admin"} onClick={connectGoogleDrive}>
                  Connect Google Drive
                </button>
                <button className="secondary" disabled={user.role !== "admin" || !settings.googleDrive.connected} onClick={backupGoogleDriveNow}>
                  Backup to Drive Now
                </button>
                <button className="danger" disabled={user.role !== "admin" || !settings.googleDrive.connected} onClick={disconnectGoogleDrive}>
                  Disconnect Drive
                </button>
              </div>
            </div>
            <div className="backup-actions">
              <button className="secondary" onClick={() => api.backup.exportEncrypted().then((path) => notify(`Backup exported: ${path}`)).catch((err) => notify(err instanceof Error ? err.message : "Backup export failed."))}>
                Export Encrypted Backup
              </button>
              <button className="danger" disabled={user.role !== "admin"} onClick={importBackup}>
                Import Encrypted Backup
              </button>
              <button className="secondary" onClick={() => api.backup.exportCsv("products").then((path) => notify(`CSV exported: ${path}`))}>
                Export Products CSV
              </button>
              <button className="secondary" onClick={() => api.backup.exportCsv("inventory").then((path) => notify(`CSV exported: ${path}`))}>
                Export Inventory CSV
              </button>
              <button className="secondary" onClick={() => api.backup.exportCsv("sales").then((path) => notify(`CSV exported: ${path}`))}>
                Export Sales CSV
              </button>
            </div>
            <div className="factory-reset-box">
              <div>
                <h2>Factory Reset</h2>
                <p>Reset this PC to a fresh TruePOS installation. A new admin account must be created after reset.</p>
              </div>
              <button className="danger" disabled={user.role !== "admin"} onClick={factoryReset}>
                <Trash2 size={16} /> Factory Reset
              </button>
            </div>
          </div>
        </div>

        <div className="settings-preview-stack">
          <div className="panel preview-panel">
            <div className="screen-heading">
              <div>
                <h2>Receipt Preview</h2>
                <p>Live preview of logo, paper width, font, header, footer, and VAT display</p>
              </div>
            </div>
            <div className="receipt-preview-shell">
              <div
                className="receipt-preview-paper"
                style={{
                  width: `${settings.receipt.widthMm}mm`,
                  padding: settings.receipt.padding,
                  fontFamily: settings.receipt.fontFamily,
                  fontSize: settings.receipt.fontSize
                }}
              >
                {settings.receipt.logoDataUrl && (
                  <div
                    className="preview-logo-wrap"
                    style={{
                      transform: `translate(${settings.receipt.logoOffsetX}px, ${settings.receipt.logoOffsetY}px)`,
                      marginBottom: `${8 + settings.receipt.logoOffsetY}px`
                    }}
                  >
                    <img
                      src={settings.receipt.logoDataUrl}
                      alt="Receipt logo"
                      style={{
                        width: `${Math.max(8, settings.receipt.logoWidthMm * (settings.receipt.logoScale / 100))}mm`,
                        height: `${Math.max(4, settings.receipt.logoHeightMm * (settings.receipt.logoScale / 100))}mm`
                      }}
                    />
                  </div>
                )}
                <pre>{previewReceipt}</pre>
              </div>
            </div>
          </div>

          <div className="panel preview-panel">
            <div className="screen-heading">
              <div>
                <h2>Barcode Label Preview</h2>
                <p>Approximate sticker size and visible fields</p>
              </div>
            </div>
            <div className="barcode-preview-shell">
              <div
                className="barcode-label-preview"
                style={{
                  width: `${settings.barcode.labelWidthMm * 3}px`,
                  height: `${settings.barcode.labelHeightMm * 3}px`,
                  padding: settings.barcode.padding
                }}
              >
                {settings.barcode.showName && <strong>{selectedLabelProduct?.name ?? "Sample Product"}</strong>}
                <span className="fake-barcode" />
                <small>{selectedLabelProduct?.barcode ?? "89900010001"}</small>
                {settings.barcode.showPrice && <b>{formatBdt(selectedLabelProduct?.price ?? 100)}</b>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      {label}
      <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function Totals({ totals }: { totals: ReturnType<typeof calculateTotals> }) {
  return (
    <div className="totals">
      <span>Subtotal <b>{formatBdt(totals.subtotal)}</b></span>
      <span>Discount <b>{formatBdt(totals.discountTotal)}</b></span>
      <span>VAT <b>{formatBdt(totals.vatTotal)}</b></span>
      <strong>Total <b>{formatBdt(totals.grandTotal)}</b></strong>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: Array<Array<string | number>> }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
