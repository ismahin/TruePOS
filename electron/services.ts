import { app, BrowserWindow, dialog } from "electron";
import type { BrowserWindow as BrowserWindowType } from "electron";
import Database from "better-sqlite3-multiple-ciphers";
import bwipjs from "bwip-js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { v4 as uuid } from "uuid";
import keytar from "keytar";
import type {
  AppSettings,
  CartLine,
  InventoryMovement,
  Product,
  ProductInput,
  ProductSalesReport,
  Sale,
  SalePayment,
  SalesReport,
  User
} from "../src/shared/contracts.js";
import { buildReceiptText, calculateTotals, receiptStyle, validateCode128Value } from "../src/shared/pos.js";

type Row = Record<string, unknown>;

const serviceName = "TruePOS";
const dbPasswordAccount = "local-database-key";

const defaultSettings: AppSettings = {
  shopName: "TruePOS Store",
  currency: "BDT",
  receiptPrinter: "",
  barcodePrinter: "",
  printerMode: "windows",
  receipt: {
    widthMm: 80,
    fontSize: 12,
    fontFamily: "Consolas",
    language: "en",
    padding: 8,
    logoDataUrl: "",
    header: "Offline POS\nDhaka, Bangladesh",
    footer: "Thank you for shopping",
    showVatBreakdown: true
  },
  barcode: {
    format: "code128",
    labelWidthMm: 50,
    labelHeightMm: 30,
    padding: 6,
    showName: true,
    showPrice: true
  }
};

function now() {
  return new Date().toISOString();
}

function dataDir() {
  const dir = path.join(app.getPath("appData"), "TruePOS", "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function getDatabaseKey() {
  const existing = await keytar.getPassword(serviceName, dbPasswordAccount);
  if (existing) return existing;
  const generated = crypto.randomBytes(32).toString("hex");
  await keytar.setPassword(serviceName, dbPasswordAccount, generated);
  return generated;
}

function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  return hashPassword(password, salt).split(":")[1] === expected;
}

function productFromRow(row: Row): Product {
  return {
    id: String(row.id),
    sku: String(row.sku),
    barcode: String(row.barcode),
    name: String(row.name),
    category: String(row.category),
    unit: String(row.unit),
    cost: Number(row.cost),
    price: Number(row.price),
    vatRate: Number(row.vat_rate),
    stock: Number(row.stock),
    lowStockThreshold: Number(row.low_stock_threshold),
    isActive: Boolean(row.is_active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function userFromRow(row: Row): User {
  return { id: String(row.id), username: String(row.username), role: row.role as User["role"] };
}

function isUnreadableDatabaseError(error: unknown) {
  return error instanceof Error && /file is not a database|not an error/i.test(error.message);
}

export class TruePOSServices {
  private db!: Database;
  private currentUser: User | null = null;

  async init() {
    const dbPath = path.join(dataDir(), "truepos.db");
    const key = await getDatabaseKey();
    try {
      this.openDatabase(dbPath, key);
      this.migrate();
      this.seed();
    } catch (error) {
      this.close();
      if (!isUnreadableDatabaseError(error)) throw error;

      this.quarantineUnreadableDatabase(dbPath);
      this.openDatabase(dbPath, key);
      this.migrate();
      this.seed();
    }
  }

  private openDatabase(dbPath: string, key: string) {
    this.db = new Database(dbPath);
    this.db.pragma(`cipher='sqlcipher'`);
    this.db.pragma(`legacy=4`);
    this.db.pragma(`key='${key.replaceAll("'", "''")}'`);
    this.db.pragma("journal_mode = WAL");
  }

  close() {
    try {
      this.db?.close();
    } catch {
      // Ignore close errors during startup recovery.
    }
  }

  private quarantineUnreadableDatabase(dbPath: string) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    for (const suffix of ["", "-wal", "-shm"]) {
      const source = `${dbPath}${suffix}`;
      if (fs.existsSync(source)) {
        fs.renameSync(source, `${source}.unreadable-${stamp}`);
      }
    }
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'cashier')),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        sku TEXT NOT NULL UNIQUE,
        barcode TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        unit TEXT NOT NULL DEFAULT 'pcs',
        cost REAL NOT NULL DEFAULT 0,
        price REAL NOT NULL DEFAULT 0,
        vat_rate REAL NOT NULL DEFAULT 0,
        stock REAL NOT NULL DEFAULT 0,
        low_stock_threshold REAL NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS price_history (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        old_price REAL NOT NULL,
        new_price REAL NOT NULL,
        changed_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS inventory_movements (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        type TEXT NOT NULL,
        quantity REAL NOT NULL,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sales (
        id TEXT PRIMARY KEY,
        receipt_no TEXT NOT NULL UNIQUE,
        payment_method TEXT NOT NULL,
        payment_amount REAL NOT NULL,
        subtotal REAL NOT NULL,
        discount_total REAL NOT NULL,
        taxable_total REAL NOT NULL,
        vat_total REAL NOT NULL,
        grand_total REAL NOT NULL,
        cashier_id TEXT NOT NULL,
        cashier_name TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sale_lines (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        sku TEXT NOT NULL,
        barcode TEXT NOT NULL,
        name TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit_price REAL NOT NULL,
        discount REAL NOT NULL,
        vat_rate REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  private seed() {
    const userCount = this.db.prepare("SELECT COUNT(*) AS count FROM users").get<{ count: number }>()?.count ?? 0;
    if (userCount === 0) {
      const createdAt = now();
      this.db
        .prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(uuid(), "admin", hashPassword("admin123"), "admin", createdAt);
      this.db
        .prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(uuid(), "cashier", hashPassword("cashier123"), "cashier", createdAt);
    }

    const settings = this.db.prepare("SELECT value FROM settings WHERE key = 'app'").get<{ value: string }>();
    if (!settings) {
      this.db.prepare("INSERT INTO settings (key, value) VALUES ('app', ?)").run(JSON.stringify(defaultSettings));
    }
  }

  private requireUser() {
    if (!this.currentUser) throw new Error("Login required.");
    return this.currentUser;
  }

  private requireAdmin() {
    const user = this.requireUser();
    if (user.role !== "admin") throw new Error("Admin permission required.");
    return user;
  }

  async login(username: string, password: string) {
    const row = this.db.prepare("SELECT * FROM users WHERE username = ?").get<Row>(username);
    if (!row || !verifyPassword(password, String(row.password_hash))) throw new Error("Invalid username or password.");
    this.currentUser = userFromRow(row);
    return this.currentUser;
  }

  async logout() {
    this.currentUser = null;
  }

  async getCurrentUser() {
    return this.currentUser;
  }

  async createProduct(input: ProductInput) {
    this.requireAdmin();
    const cleanedBarcode = validateCode128Value(input.barcode || input.sku);
    const product: Product = {
      id: uuid(),
      sku: input.sku.trim(),
      barcode: cleanedBarcode,
      name: input.name.trim(),
      category: input.category?.trim() ?? "",
      unit: input.unit?.trim() || "pcs",
      cost: Number(input.cost || 0),
      price: Number(input.price || 0),
      vatRate: Number(input.vatRate || 0),
      stock: Number(input.stock || 0),
      lowStockThreshold: Number(input.lowStockThreshold || 0),
      isActive: input.isActive ?? true,
      createdAt: now(),
      updatedAt: now()
    };
    this.db
      .prepare(
        `INSERT INTO products
        (id, sku, barcode, name, category, unit, cost, price, vat_rate, stock, low_stock_threshold, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        product.id,
        product.sku,
        product.barcode,
        product.name,
        product.category,
        product.unit,
        product.cost,
        product.price,
        product.vatRate,
        product.stock,
        product.lowStockThreshold,
        product.isActive ? 1 : 0,
        product.createdAt,
        product.updatedAt
      );
    if (product.stock !== 0) this.addMovement(product.id, "stock_in", product.stock, "Opening stock");
    return product;
  }

  async updateProduct(id: string, input: Partial<ProductInput>) {
    const user = this.requireAdmin();
    const existing = this.db.prepare("SELECT * FROM products WHERE id = ?").get<Row>(id);
    if (!existing) throw new Error("Product not found.");
    const next = { ...productFromRow(existing), ...input, updatedAt: now() };
    if (input.barcode || input.sku) next.barcode = validateCode128Value(next.barcode || next.sku);
    this.db
      .prepare(
        `UPDATE products SET sku=?, barcode=?, name=?, category=?, unit=?, cost=?, price=?, vat_rate=?,
        low_stock_threshold=?, is_active=?, updated_at=? WHERE id=?`
      )
      .run(
        next.sku,
        next.barcode,
        next.name,
        next.category,
        next.unit,
        next.cost,
        next.price,
        next.vatRate,
        next.lowStockThreshold,
        next.isActive ? 1 : 0,
        next.updatedAt,
        id
      );
    if (Number(existing.price) !== next.price) {
      this.db
        .prepare("INSERT INTO price_history (id, product_id, old_price, new_price, changed_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(uuid(), id, Number(existing.price), next.price, user.id, now());
    }
    return productFromRow(this.db.prepare("SELECT * FROM products WHERE id = ?").get<Row>(id)!);
  }

  async searchProducts(query: string) {
    const q = `%${query.trim()}%`;
    return this.db
      .prepare(
        `SELECT * FROM products
        WHERE is_active = 1 AND (? = '%%' OR sku LIKE ? OR barcode LIKE ? OR name LIKE ? OR category LIKE ?)
        ORDER BY name LIMIT 100`
      )
      .all<Row>(q, q, q, q, q)
      .map(productFromRow);
  }

  async importProductsCsv(csv: string) {
    this.requireAdmin();
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
    let imported = 0;
    let skipped = 0;
    for (const row of parsed.data) {
      try {
        await this.createProduct({
          sku: row.sku,
          barcode: row.barcode || row.sku,
          name: row.name,
          category: row.category || "",
          unit: row.unit || "pcs",
          cost: Number(row.cost || 0),
          price: Number(row.price || 0),
          vatRate: Number(row.vatRate || row.vat_rate || 0),
          stock: Number(row.stock || 0),
          lowStockThreshold: Number(row.lowStockThreshold || row.low_stock_threshold || 0),
          isActive: true
        });
        imported += 1;
      } catch {
        skipped += 1;
      }
    }
    return { imported, skipped };
  }

  async adjustInventory(productId: string, quantity: number, note: string) {
    this.requireAdmin();
    this.db.prepare("UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?").run(quantity, now(), productId);
    this.addMovement(productId, "adjustment", quantity, note || "Manual adjustment");
    return productFromRow(this.db.prepare("SELECT * FROM products WHERE id = ?").get<Row>(productId)!);
  }

  async listMovements(productId?: string): Promise<InventoryMovement[]> {
    const rows = productId
      ? this.db
          .prepare(
            `SELECT m.*, p.name AS product_name FROM inventory_movements m JOIN products p ON p.id = m.product_id
             WHERE product_id = ? ORDER BY m.created_at DESC LIMIT 500`
          )
          .all<Row>(productId)
      : this.db
          .prepare(
            `SELECT m.*, p.name AS product_name FROM inventory_movements m JOIN products p ON p.id = m.product_id
             ORDER BY m.created_at DESC LIMIT 500`
          )
          .all<Row>();
    return rows.map((row) => ({
      id: String(row.id),
      productId: String(row.product_id),
      productName: String(row.product_name),
      type: row.type as InventoryMovement["type"],
      quantity: Number(row.quantity),
      note: String(row.note),
      createdAt: String(row.created_at)
    }));
  }

  async getStock(productId: string) {
    return Number(this.db.prepare("SELECT stock FROM products WHERE id = ?").get<Row>(productId)?.stock ?? 0);
  }

  async createSale(lines: CartLine[], payment: SalePayment) {
    const user = this.requireUser();
    if (lines.length === 0) throw new Error("Sale must contain at least one product.");
    const totals = calculateTotals(lines);
    if (payment.amount < totals.grandTotal) throw new Error("Payment amount is below grand total.");
    const sale: Sale = {
      id: uuid(),
      receiptNo: `TP-${Date.now()}`,
      lines,
      payment,
      totals,
      cashierId: user.id,
      cashierName: user.username,
      status: "completed",
      createdAt: now()
    };
    const tx = this.db.transaction(() => {
      for (const line of lines) {
        const product = this.db.prepare("SELECT stock FROM products WHERE id = ?").get<Row>(line.productId);
        if (!product) throw new Error(`Product not found: ${line.name}`);
        if (Number(product.stock) < line.quantity) throw new Error(`Insufficient stock for ${line.name}.`);
      }
      this.db
        .prepare(
          `INSERT INTO sales
          (id, receipt_no, payment_method, payment_amount, subtotal, discount_total, taxable_total, vat_total, grand_total,
           cashier_id, cashier_name, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          sale.id,
          sale.receiptNo,
          payment.method,
          payment.amount,
          totals.subtotal,
          totals.discountTotal,
          totals.taxableTotal,
          totals.vatTotal,
          totals.grandTotal,
          sale.cashierId,
          sale.cashierName,
          sale.status,
          sale.createdAt
        );
      for (const line of lines) {
        this.db
          .prepare(
            `INSERT INTO sale_lines
            (id, sale_id, product_id, sku, barcode, name, quantity, unit_price, discount, vat_rate)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(uuid(), sale.id, line.productId, line.sku, line.barcode, line.name, line.quantity, line.unitPrice, line.discount, line.vatRate);
        this.db.prepare("UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?").run(line.quantity, now(), line.productId);
        this.addMovement(line.productId, "sale", -line.quantity, `Sale ${sale.receiptNo}`);
      }
    });
    tx();
    return sale;
  }

  async returnSale(saleId: string) {
    this.requireAdmin();
    const sale = this.getSale(saleId);
    if (sale.status === "returned") throw new Error("Sale has already been returned.");
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE sales SET status = 'returned' WHERE id = ?").run(saleId);
      for (const line of sale.lines) {
        this.db.prepare("UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?").run(line.quantity, now(), line.productId);
        this.addMovement(line.productId, "return", line.quantity, `Return ${sale.receiptNo}`);
      }
    });
    tx();
    return { ...sale, status: "returned" as const };
  }

  async getReceipt(saleId: string) {
    return buildReceiptText(this.getSale(saleId), await this.getSettings());
  }

  async getDailySales(date: string): Promise<SalesReport> {
    const start = `${date}T00:00:00.000Z`;
    const end = `${date}T23:59:59.999Z`;
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS sales_count, COALESCE(SUM(subtotal),0) AS subtotal, COALESCE(SUM(discount_total),0) AS discount_total,
        COALESCE(SUM(vat_total),0) AS vat_total, COALESCE(SUM(grand_total),0) AS grand_total
        FROM sales WHERE status = 'completed' AND created_at BETWEEN ? AND ?`
      )
      .get<Row>(start, end)!;
    const profit = this.db
      .prepare(
        `SELECT COALESCE(SUM((l.unit_price - p.cost) * l.quantity - (l.discount * l.quantity)), 0) AS profit
         FROM sale_lines l JOIN sales s ON s.id = l.sale_id JOIN products p ON p.id = l.product_id
         WHERE s.status = 'completed' AND s.created_at BETWEEN ? AND ?`
      )
      .get<Row>(start, end)!;
    return {
      date,
      salesCount: Number(row.sales_count),
      subtotal: Number(row.subtotal),
      discountTotal: Number(row.discount_total),
      vatTotal: Number(row.vat_total),
      grandTotal: Number(row.grand_total),
      profitEstimate: Number(profit.profit)
    };
  }

  async getProductSales(dateFrom: string, dateTo: string): Promise<ProductSalesReport[]> {
    return this.db
      .prepare(
        `SELECT l.product_id, l.sku, l.name, SUM(l.quantity) AS quantity, SUM((l.unit_price - l.discount) * l.quantity) AS revenue
         FROM sale_lines l JOIN sales s ON s.id = l.sale_id
         WHERE s.status = 'completed' AND s.created_at BETWEEN ? AND ?
         GROUP BY l.product_id, l.sku, l.name ORDER BY revenue DESC`
      )
      .all<Row>(`${dateFrom}T00:00:00.000Z`, `${dateTo}T23:59:59.999Z`)
      .map((row) => ({
        productId: String(row.product_id),
        sku: String(row.sku),
        name: String(row.name),
        quantity: Number(row.quantity),
        revenue: Number(row.revenue)
      }));
  }

  async getInventoryValue() {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS products, COALESCE(SUM(stock),0) AS units, COALESCE(SUM(stock * cost),0) AS cost_value,
        COALESCE(SUM(stock * price),0) AS retail_value,
        SUM(CASE WHEN stock <= low_stock_threshold THEN 1 ELSE 0 END) AS low_stock_count
        FROM products WHERE is_active = 1`
      )
      .get<Row>()!;
    return {
      products: Number(row.products),
      units: Number(row.units),
      costValue: Number(row.cost_value),
      retailValue: Number(row.retail_value),
      lowStockCount: Number(row.low_stock_count)
    };
  }

  async getSettings(): Promise<AppSettings> {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'app'").get<{ value: string }>();
    return row ? { ...defaultSettings, ...JSON.parse(row.value) } : defaultSettings;
  }

  async updateSettings(settings: Partial<AppSettings>) {
    this.requireAdmin();
    const next = { ...(await this.getSettings()), ...settings };
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)").run(JSON.stringify(next));
    return next;
  }

  async listPrinters(window: BrowserWindowType) {
    return (await window.webContents.getPrintersAsync()).map((printer) => printer.name);
  }

  async printReceipt(window: BrowserWindowType, saleId?: string) {
    const settings = await this.getSettings();
    const text = saleId ? await this.getReceipt(saleId) : buildReceiptText(this.sampleSale(), settings);
    const html = `<html><head><style>${receiptStyle(settings.receipt)}</style></head><body>${settings.receipt.logoDataUrl ? `<img class="logo" src="${settings.receipt.logoDataUrl}" />` : ""}<pre>${escapeHtml(text)}</pre></body></html>`;
    await this.printHtml(window, html, settings.receiptPrinter);
  }

  async printBarcode(window: BrowserWindowType, productId: string, quantity: number) {
    const settings = await this.getSettings();
    const product = productFromRow(this.db.prepare("SELECT * FROM products WHERE id = ?").get<Row>(productId)!);
    const png = await bwipjs.toBuffer({ bcid: "code128", text: product.barcode, scale: 2, height: 12, includetext: true });
    const labels = Array.from({ length: Math.max(1, quantity) }, () => {
      return `<section class="label">
        ${settings.barcode.showName ? `<strong>${escapeHtml(product.name)}</strong>` : ""}
        <img src="data:image/png;base64,${png.toString("base64")}" />
        ${settings.barcode.showPrice ? `<span>${escapeHtml(product.price.toFixed(2))} BDT</span>` : ""}
      </section>`;
    }).join("");
    const html = `<html><head><style>
      body{margin:0;padding:0;font-family:Arial;color:#111827}
      .label{box-sizing:border-box;width:${settings.barcode.labelWidthMm}mm;height:${settings.barcode.labelHeightMm}mm;padding:${settings.barcode.padding}px;display:flex;flex-direction:column;align-items:center;justify-content:center;break-after:page}
      img{max-width:100%;height:auto} strong,span{font-size:10px;line-height:1.1;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    </style></head><body>${labels}</body></html>`;
    await this.printHtml(window, html, settings.barcodePrinter);
  }

  async exportEncrypted() {
    const target = dialog.showSaveDialogSync({ title: "Export encrypted TruePOS backup", defaultPath: `truepos-backup-${Date.now()}.db` });
    if (!target) throw new Error("Export cancelled.");
    await this.db.backup(target);
    return target;
  }

  async importEncrypted(filePath: string) {
    this.requireAdmin();
    if (!fs.existsSync(filePath)) throw new Error("Backup file not found.");
    this.close();
    fs.copyFileSync(filePath, path.join(dataDir(), "truepos.db"));
    await this.init();
  }

  async exportCsv(kind: "products" | "inventory" | "sales") {
    let rows: Row[];
    if (kind === "products") rows = this.db.prepare("SELECT * FROM products ORDER BY name").all<Row>();
    else if (kind === "inventory") rows = this.db.prepare("SELECT * FROM inventory_movements ORDER BY created_at DESC").all<Row>();
    else rows = this.db.prepare("SELECT * FROM sales ORDER BY created_at DESC").all<Row>();
    const csv = Papa.unparse(rows);
    const target = dialog.showSaveDialogSync({ title: `Export ${kind} CSV`, defaultPath: `truepos-${kind}-${Date.now()}.csv` });
    if (!target) throw new Error("Export cancelled.");
    fs.writeFileSync(target, csv, "utf8");
    return target;
  }

  private addMovement(productId: string, type: InventoryMovement["type"], quantity: number, note: string) {
    this.db.prepare("INSERT INTO inventory_movements (id, product_id, type, quantity, note, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      uuid(),
      productId,
      type,
      quantity,
      note,
      now()
    );
  }

  private getSale(saleId: string): Sale {
    const row = this.db.prepare("SELECT * FROM sales WHERE id = ?").get<Row>(saleId);
    if (!row) throw new Error("Sale not found.");
    const lines = this.db
      .prepare("SELECT * FROM sale_lines WHERE sale_id = ? ORDER BY rowid")
      .all<Row>(saleId)
      .map((line) => ({
        productId: String(line.product_id),
        sku: String(line.sku),
        barcode: String(line.barcode),
        name: String(line.name),
        quantity: Number(line.quantity),
        unitPrice: Number(line.unit_price),
        discount: Number(line.discount),
        vatRate: Number(line.vat_rate)
      }));
    return {
      id: String(row.id),
      receiptNo: String(row.receipt_no),
      lines,
      payment: { method: row.payment_method as SalePayment["method"], amount: Number(row.payment_amount) },
      totals: {
        subtotal: Number(row.subtotal),
        discountTotal: Number(row.discount_total),
        taxableTotal: Number(row.taxable_total),
        vatTotal: Number(row.vat_total),
        grandTotal: Number(row.grand_total)
      },
      cashierId: String(row.cashier_id),
      cashierName: String(row.cashier_name),
      status: row.status as Sale["status"],
      createdAt: String(row.created_at)
    };
  }

  private async printHtml(parent: BrowserWindowType, html: string, deviceName: string) {
    const printWindow = new BrowserWindow({ show: false, parent, webPreferences: { sandbox: true } });
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise<void>((resolve, reject) => {
      printWindow.webContents.print({ silent: Boolean(deviceName), deviceName }, (success, failureReason) => {
        printWindow.close();
        if (success) resolve();
        else reject(new Error(failureReason || "Print failed."));
      });
    });
  }

  private sampleSale(): Sale {
    return {
      id: "sample",
      receiptNo: "TP-SAMPLE",
      lines: [{ productId: "sample", sku: "SAMPLE", barcode: "SAMPLE", name: "Sample Product", quantity: 1, unitPrice: 100, discount: 0, vatRate: 15 }],
      payment: { method: "cash", amount: 115 },
      totals: calculateTotals([{ productId: "sample", sku: "SAMPLE", barcode: "SAMPLE", name: "Sample Product", quantity: 1, unitPrice: 100, discount: 0, vatRate: 15 }]),
      cashierId: "sample",
      cashierName: "admin",
      status: "completed",
      createdAt: now()
    };
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
