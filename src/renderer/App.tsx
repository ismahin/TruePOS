import { BarChart3, Boxes, CreditCard, LogOut, PackagePlus, Printer, Search, Settings, ShoppingCart } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AppSettings, CartLine, InventoryMovement, Product, ProductInput, SalesReport, User } from "../shared/contracts";
import { calculateTotals, formatBdt } from "../shared/pos";

type Screen = "billing" | "products" | "inventory" | "reports" | "settings";

const api = window.truePOS;

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [screen, setScreen] = useState<Screen>("billing");
  const [toast, setToast] = useState("");

  useEffect(() => {
    api.auth.getCurrentUser().then(setUser).catch(() => setUser(null));
  }, []);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3500);
  };

  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">TP</div>
          <div>
            <strong>TruePOS</strong>
            <span>Offline retail terminal</span>
          </div>
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
        {screen === "billing" && <Billing notify={notify} />}
        {screen === "products" && <Products user={user} notify={notify} />}
        {screen === "inventory" && <Inventory notify={notify} />}
        {screen === "reports" && <Reports />}
        {screen === "settings" && <SettingsScreen user={user} notify={notify} />}
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      onLogin(await api.auth.login(username, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    }
  }

  return (
    <div className="login-page">
      <form className="login-panel" onSubmit={submit}>
        <div className="brand-mark large">TP</div>
        <h1>TruePOS</h1>
        <p>Local encrypted point of sale</p>
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus />
        </label>
        <label>
          Password
          <input value={password} type="password" onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary" type="submit">
          Login
        </button>
        <small>Default setup: admin/admin123 and cashier/cashier123</small>
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

function Products({ user, notify }: { user: User; notify: (message: string) => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<ProductInput>({
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
  });

  const load = () => api.products.search(query).then(setProducts);
  useEffect(() => void load(), [query]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await api.products.create({ ...form, barcode: form.barcode || form.sku });
    setForm({ ...form, sku: "", barcode: "", name: "", cost: 0, price: 0, stock: 0 });
    notify("Product saved.");
    await load();
  }

  return (
    <section className="screen two-column">
      <form className="panel form-grid" onSubmit={submit}>
        <h2>Product Entry</h2>
        {user.role !== "admin" && <div className="notice">Admin permission is required to save products.</div>}
        <input placeholder="SKU" value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} required />
        <input placeholder="Barcode" value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} />
        <input placeholder="Product name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        <input placeholder="Category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} />
        <input placeholder="Unit" value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} />
        <NumberInput label="Cost" value={form.cost} onChange={(value) => setForm({ ...form, cost: value })} />
        <NumberInput label="Price" value={form.price} onChange={(value) => setForm({ ...form, price: value })} />
        <NumberInput label="VAT %" value={form.vatRate} onChange={(value) => setForm({ ...form, vatRate: value })} />
        <NumberInput label="Opening stock" value={form.stock ?? 0} onChange={(value) => setForm({ ...form, stock: value })} />
        <NumberInput label="Low stock alert" value={form.lowStockThreshold} onChange={(value) => setForm({ ...form, lowStockThreshold: value })} />
        <button className="primary" type="submit" disabled={user.role !== "admin"}>
          Save Product
        </button>
      </form>
      <div className="panel">
        <div className="screen-heading">
          <h2>Products</h2>
          <input placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <DataTable
          rows={products.map((product) => [product.sku, product.name, product.category, product.stock, formatBdt(product.price)])}
          headers={["SKU", "Name", "Category", "Stock", "Price"]}
        />
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

function Reports() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [inventory, setInventory] = useState<{ label: string; value: string }[]>([]);

  useEffect(() => {
    api.reports.getDailySales(date).then(setReport);
    api.reports.getInventoryValue().then((value) =>
      setInventory([
        { label: "Products", value: String(value.products) },
        { label: "Units", value: String(value.units) },
        { label: "Cost value", value: formatBdt(value.costValue) },
        { label: "Retail value", value: formatBdt(value.retailValue) },
        { label: "Low stock", value: String(value.lowStockCount) }
      ])
    );
  }, [date]);

  return (
    <section className="screen">
      <div className="panel">
        <div className="screen-heading">
          <h2>Sales Reporting & Analytics</h2>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        {report && (
          <div className="metric-grid">
            <Metric label="Sales" value={String(report.salesCount)} />
            <Metric label="Subtotal" value={formatBdt(report.subtotal)} />
            <Metric label="VAT" value={formatBdt(report.vatTotal)} />
            <Metric label="Grand total" value={formatBdt(report.grandTotal)} />
            <Metric label="Profit estimate" value={formatBdt(report.profitEstimate)} />
          </div>
        )}
      </div>
      <div className="panel">
        <h2>Inventory Value</h2>
        <div className="metric-grid">
          {inventory.map((item) => (
            <Metric key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
      </div>
    </section>
  );
}

function SettingsScreen({ user, notify }: { user: User; notify: (message: string) => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [printers, setPrinters] = useState<string[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    api.settings.get().then(setSettings);
    api.printing.listPrinters().then(setPrinters).catch(() => setPrinters([]));
    api.products.search("").then(setProducts);
  }, []);

  if (!settings) return null;

  const save = async () => {
    setSettings(await api.settings.update(settings));
    notify("Settings saved.");
  };

  return (
    <section className="screen settings-grid">
      {user.role !== "admin" && <div className="notice">Admin permission is required to update settings.</div>}
      <div className="panel form-grid">
        <h2>Shop & Receipt</h2>
        <input value={settings.shopName} onChange={(event) => setSettings({ ...settings, shopName: event.target.value })} />
        <textarea value={settings.receipt.header} onChange={(event) => setSettings({ ...settings, receipt: { ...settings.receipt, header: event.target.value } })} />
        <textarea value={settings.receipt.footer} onChange={(event) => setSettings({ ...settings, receipt: { ...settings.receipt, footer: event.target.value } })} />
        <select value={settings.receiptPrinter} onChange={(event) => setSettings({ ...settings, receiptPrinter: event.target.value })}>
          <option value="">Default printer</option>
          {printers.map((printer) => (
            <option key={printer}>{printer}</option>
          ))}
        </select>
        <select value={settings.receipt.widthMm} onChange={(event) => setSettings({ ...settings, receipt: { ...settings.receipt, widthMm: Number(event.target.value) as 58 | 80 } })}>
          <option value={58}>58mm</option>
          <option value={80}>80mm</option>
        </select>
        <NumberInput label="Font size" value={settings.receipt.fontSize} onChange={(value) => setSettings({ ...settings, receipt: { ...settings.receipt, fontSize: value } })} />
        <NumberInput label="Padding" value={settings.receipt.padding} onChange={(value) => setSettings({ ...settings, receipt: { ...settings.receipt, padding: value } })} />
        <button className="primary" disabled={user.role !== "admin"} onClick={save}>
          Save Settings
        </button>
        <button className="secondary" onClick={() => api.printing.testReceipt()}>
          <Printer size={16} /> Test Receipt
        </button>
      </div>
      <div className="panel form-grid">
        <h2>Barcode Labels</h2>
        <select value={settings.barcodePrinter} onChange={(event) => setSettings({ ...settings, barcodePrinter: event.target.value })}>
          <option value="">Default printer</option>
          {printers.map((printer) => (
            <option key={printer}>{printer}</option>
          ))}
        </select>
        <NumberInput label="Label width mm" value={settings.barcode.labelWidthMm} onChange={(value) => setSettings({ ...settings, barcode: { ...settings.barcode, labelWidthMm: value } })} />
        <NumberInput label="Label height mm" value={settings.barcode.labelHeightMm} onChange={(value) => setSettings({ ...settings, barcode: { ...settings.barcode, labelHeightMm: value } })} />
        <NumberInput label="Padding" value={settings.barcode.padding} onChange={(value) => setSettings({ ...settings, barcode: { ...settings.barcode, padding: value } })} />
        <label className="checkbox">
          <input type="checkbox" checked={settings.barcode.showName} onChange={(event) => setSettings({ ...settings, barcode: { ...settings.barcode, showName: event.target.checked } })} />
          Show product name
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={settings.barcode.showPrice} onChange={(event) => setSettings({ ...settings, barcode: { ...settings.barcode, showPrice: event.target.checked } })} />
          Show price
        </label>
        <button className="secondary" disabled={!products[0]} onClick={() => products[0] && api.printing.testBarcode(products[0].id)}>
          <Printer size={16} /> Test Barcode
        </button>
      </div>
      <div className="panel form-grid">
        <h2>Backup & CSV</h2>
        <button className="secondary" onClick={() => api.backup.exportEncrypted().then((path) => notify(`Backup exported: ${path}`))}>
          Export Encrypted Backup
        </button>
        <button className="secondary" onClick={() => api.backup.exportCsv("products").then((path) => notify(`CSV exported: ${path}`))}>
          Export Products CSV
        </button>
        <button className="secondary" onClick={() => api.backup.exportCsv("sales").then((path) => notify(`CSV exported: ${path}`))}>
          Export Sales CSV
        </button>
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
