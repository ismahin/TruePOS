import { app, BrowserWindow, dialog, shell } from "electron";
import type { BrowserWindow as BrowserWindowType } from "electron";
import Database from "better-sqlite3-multiple-ciphers";
import bwipjs from "bwip-js";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
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
const googleDriveRefreshTokenAccount = "google-drive-refresh-token";
const googleDriveScopes = ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.file"].join(" ");
const bundledGoogleDriveClientId = "";

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
    logoWidthMm: 32,
    logoHeightMm: 16,
    logoScale: 100,
    logoOffsetX: 0,
    logoOffsetY: 0,
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
  },
  googleDrive: {
    connected: false,
    accountEmail: "",
    autoBackupEnabled: false,
    backupTime: "22:00",
    lastBackupAt: "",
    lastBackupStatus: ""
  }
};

function mergeSettings(settings: Partial<AppSettings>): AppSettings {
  return {
    ...defaultSettings,
    ...settings,
    receipt: {
      ...defaultSettings.receipt,
      ...settings.receipt
    },
    barcode: {
      ...defaultSettings.barcode,
      ...settings.barcode
    },
    googleDrive: {
      ...defaultSettings.googleDrive,
      ...settings.googleDrive
    }
  };
}

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
  private googleDriveBackupTimer: NodeJS.Timeout | null = null;
  private googleDriveBackupRunning = false;

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

  async deleteProduct(id: string) {
    this.requireAdmin();
    const existing = this.db.prepare("SELECT * FROM products WHERE id = ?").get<Row>(id);
    if (!existing) throw new Error("Product not found.");
    this.db.prepare("UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?").run(now(), id);
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

  async listProducts(params?: { query?: string; includeInactive?: boolean; lowStockOnly?: boolean; category?: string }) {
    const filters = params ?? {};
    const query = `%${(filters.query ?? "").trim()}%`;
    const category = (filters.category ?? "").trim();
    return this.db
      .prepare(
        `SELECT * FROM products
         WHERE (? = 1 OR is_active = 1)
           AND (? = '%%' OR sku LIKE ? OR barcode LIKE ? OR name LIKE ? OR category LIKE ?)
           AND (? = '' OR category = ?)
           AND (? = 0 OR stock <= low_stock_threshold)
         ORDER BY is_active DESC, name ASC
         LIMIT 500`
      )
      .all<Row>(
        filters.includeInactive ? 1 : 0,
        query,
        query,
        query,
        query,
        query,
        category,
        category,
        filters.lowStockOnly ? 1 : 0
      )
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

  async adjustInventory(productId: string, quantity: number, note: string, type: InventoryMovement["type"] = "adjustment") {
    this.requireAdmin();
    const product = this.db.prepare("SELECT * FROM products WHERE id = ?").get<Row>(productId);
    if (!product) throw new Error("Product not found.");
    const nextStock = Number(product.stock) + quantity;
    if (nextStock < 0) throw new Error("Stock cannot go below zero.");
    this.db.prepare("UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?").run(quantity, now(), productId);
    this.addMovement(productId, type, quantity, note || "Manual adjustment");
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

  async cancelSale(saleId: string) {
    const user = this.requireUser();
    const sale = this.getSale(saleId);
    if (sale.status === "returned") throw new Error("Sale has already been cancelled.");
    if (user.role !== "admin" && sale.cashierId !== user.id) {
      throw new Error("You can only cancel your own sale.");
    }
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE sales SET status = 'returned' WHERE id = ?").run(saleId);
      for (const line of sale.lines) {
        this.db.prepare("UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?").run(line.quantity, now(), line.productId);
        this.addMovement(line.productId, "return", line.quantity, `Print cancelled ${sale.receiptNo}`);
      }
    });
    tx();
    return { ...sale, status: "returned" as const };
  }

  async previewReceipt(lines: CartLine[], payment: SalePayment) {
    const user = this.requireUser();
    if (lines.length === 0) throw new Error("Sale must contain at least one product.");
    const totals = calculateTotals(lines);
    const previewSale: Sale = {
      id: "preview",
      receiptNo: "Preview",
      lines,
      payment,
      totals,
      cashierId: user.id,
      cashierName: user.username,
      status: "completed",
      createdAt: now()
    };
    return buildReceiptText(previewSale, await this.getSettings());
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
    return row ? mergeSettings(JSON.parse(row.value)) : defaultSettings;
  }

  async updateSettings(settings: Partial<AppSettings>) {
    this.requireAdmin();
    const current = await this.getSettings();
    const next = mergeSettings({
      ...current,
      ...settings,
      receipt: { ...current.receipt, ...settings.receipt },
      barcode: { ...current.barcode, ...settings.barcode },
      googleDrive: { ...current.googleDrive, ...settings.googleDrive }
    });
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)").run(JSON.stringify(next));
    this.startGoogleDriveAutoBackupScheduler();
    return next;
  }

  async listPrinters(window: BrowserWindowType) {
    return (await window.webContents.getPrintersAsync()).map((printer) => printer.name);
  }

  async printReceipt(window: BrowserWindowType, saleId?: string) {
    const settings = await this.getSettings();
    const text = saleId ? await this.getReceipt(saleId) : buildReceiptText(this.sampleSale(), settings);
    const logo = settings.receipt.logoDataUrl ? `<div class="logo-wrap"><img class="logo" src="${settings.receipt.logoDataUrl}" /></div>` : "";
    const html = `<html><head><style>${receiptStyle(settings.receipt)}</style></head><body>${logo}<pre>${escapeHtml(text)}</pre></body></html>`;
    await this.printHtml(window, html, settings.receiptPrinter);
  }

  async printBarcode(window: BrowserWindowType, productId: string, quantity: number) {
    const settings = await this.getSettings();
    const product = productFromRow(this.db.prepare("SELECT * FROM products WHERE id = ?").get<Row>(productId)!);
    const png = await bwipjs.toBuffer({ bcid: "code128", text: product.barcode, scale: 2, height: 10, includetext: false });
    const labels = Array.from({ length: Math.max(1, quantity) }, () => {
      return `<section class="label">
        ${settings.barcode.showName ? `<strong>${escapeHtml(product.name)}</strong>` : ""}
        <div class="barcode-box"><img src="data:image/png;base64,${png.toString("base64")}" /></div>
        <small>${escapeHtml(product.barcode)}</small>
        ${settings.barcode.showPrice ? `<span>${escapeHtml(product.price.toFixed(2))} BDT</span>` : ""}
      </section>`;
    }).join("");
    const html = `<html><head><style>
      body{margin:0;padding:0;font-family:Arial;color:#111827}
      .label{box-sizing:border-box;width:${settings.barcode.labelWidthMm}mm;height:${settings.barcode.labelHeightMm}mm;padding:${settings.barcode.padding}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;break-after:page;overflow:hidden}
      .barcode-box{width:100%;min-height:12mm;flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden}
      img{display:block;max-width:100%;max-height:100%;object-fit:contain}
      strong,span,small{font-size:9px;line-height:1.05;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      small{font-size:8px}
    </style></head><body>${labels}</body></html>`;
    await this.printHtml(window, html, settings.barcodePrinter);
  }

  async exportEncrypted() {
    const target = dialog.showSaveDialogSync({ title: "Export encrypted TruePOS backup", defaultPath: `truepos-backup-${Date.now()}.db` });
    if (!target) throw new Error("Export cancelled.");
    await this.db.backup(target);
    return target;
  }

  async importEncrypted(filePath?: string) {
    this.requireAdmin();
    const selectedPath =
      filePath ||
      dialog.showOpenDialogSync({
        title: "Import encrypted TruePOS backup",
        properties: ["openFile"],
        filters: [{ name: "TruePOS backup", extensions: ["db", "sqlite", "backup"] }]
      })?.[0];
    if (!selectedPath) throw new Error("Import cancelled.");
    if (!fs.existsSync(selectedPath)) throw new Error("Backup file not found.");
    const dbPath = path.join(dataDir(), "truepos.db");
    const rollbackPath = path.join(dataDir(), `truepos-rollback-${Date.now()}.db`);
    this.close();
    if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, rollbackPath);
    try {
      fs.copyFileSync(selectedPath, dbPath);
      await this.init();
      if (fs.existsSync(rollbackPath)) fs.rmSync(rollbackPath, { force: true });
      return selectedPath;
    } catch (error) {
      if (fs.existsSync(rollbackPath)) fs.copyFileSync(rollbackPath, dbPath);
      await this.init();
      throw error;
    } finally {
      if (fs.existsSync(rollbackPath)) fs.rmSync(rollbackPath, { force: true });
    }
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

  async connectGoogleDrive() {
    this.requireAdmin();
    const settings = await this.getSettings();
    const clientId = this.getGoogleDriveClientId(settings);
    if (!clientId) throw new Error("Google Drive backup is not configured for this TruePOS build.");
    const token = await this.authorizeGoogleDrive(clientId);
    if (!token.refresh_token) throw new Error("Google did not return a refresh token. Remove app access from Google Account settings and connect again.");
    await keytar.setPassword(serviceName, googleDriveRefreshTokenAccount, token.refresh_token);
    const accountEmail = await this.getGoogleAccountEmail(token.access_token);
    const next = mergeSettings({
      ...settings,
      googleDrive: {
        ...settings.googleDrive,
        connected: true,
        accountEmail,
        lastBackupStatus: "Google Drive connected."
      }
    });
    this.saveSettings(next);
    this.startGoogleDriveAutoBackupScheduler();
    return next;
  }

  async disconnectGoogleDrive() {
    this.requireAdmin();
    await keytar.deletePassword(serviceName, googleDriveRefreshTokenAccount);
    const settings = await this.getSettings();
    const next = mergeSettings({
      ...settings,
      googleDrive: {
        ...settings.googleDrive,
        connected: false,
        accountEmail: "",
        autoBackupEnabled: false,
        lastBackupStatus: "Google Drive disconnected."
      }
    });
    this.saveSettings(next);
    this.startGoogleDriveAutoBackupScheduler();
    return next;
  }

  async backupGoogleDriveNow() {
    this.requireAdmin();
    return this.uploadGoogleDriveBackup("Manual Google Drive backup completed.");
  }

  startGoogleDriveAutoBackupScheduler() {
    if (this.googleDriveBackupTimer) {
      clearInterval(this.googleDriveBackupTimer);
      this.googleDriveBackupTimer = null;
    }
    this.googleDriveBackupTimer = setInterval(() => {
      this.runScheduledGoogleDriveBackup().catch(() => undefined);
    }, 60_000);
  }

  private async runScheduledGoogleDriveBackup() {
    const settings = await this.getSettings();
    if (!settings.googleDrive.connected || !settings.googleDrive.autoBackupEnabled) return;
    if (!/^\d{2}:\d{2}$/.test(settings.googleDrive.backupTime)) return;
    const nowDate = new Date();
    const today = nowDate.toISOString().slice(0, 10);
    const currentTime = `${String(nowDate.getHours()).padStart(2, "0")}:${String(nowDate.getMinutes()).padStart(2, "0")}`;
    if (currentTime !== settings.googleDrive.backupTime) return;
    if (settings.googleDrive.lastBackupAt.startsWith(today)) return;
    await this.uploadGoogleDriveBackup("Automatic Google Drive backup completed.");
  }

  private async uploadGoogleDriveBackup(successMessage: string) {
    if (this.googleDriveBackupRunning) throw new Error("Google Drive backup is already running.");
    this.googleDriveBackupRunning = true;
    const settings = await this.getSettings();
    try {
      const clientId = this.getGoogleDriveClientId(settings);
      if (!clientId) throw new Error("Google Drive backup is not configured for this TruePOS build.");
      const accessToken = await this.refreshGoogleAccessToken(clientId);
      const backupPath = path.join(app.getPath("temp"), `truepos-drive-backup-${Date.now()}.db`);
      await this.db.backup(backupPath);
      const uploaded = await this.uploadFileToGoogleDrive(accessToken, backupPath);
      fs.rmSync(backupPath, { force: true });
      const next = mergeSettings({
        ...settings,
        googleDrive: {
          ...settings.googleDrive,
          connected: true,
          lastBackupAt: now(),
          lastBackupStatus: `${successMessage} File: ${uploaded.name}`
        }
      });
      this.saveSettings(next);
      return next;
    } catch (error) {
      const next = mergeSettings({
        ...settings,
        googleDrive: {
          ...settings.googleDrive,
          lastBackupStatus: error instanceof Error ? error.message : "Google Drive backup failed."
        }
      });
      this.saveSettings(next);
      throw error;
    } finally {
      this.googleDriveBackupRunning = false;
    }
  }

  private async authorizeGoogleDrive(clientId: string): Promise<{ access_token: string; refresh_token?: string }> {
    const verifier = base64Url(crypto.randomBytes(32));
    const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
    const state = base64Url(crypto.randomBytes(16));
    const { code, redirectUri } = await waitForGoogleOAuthCode(clientId, state, challenge);
    const body = new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri
    });
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    if (!response.ok) throw new Error(`Google token exchange failed: ${await response.text()}`);
    return response.json() as Promise<{ access_token: string; refresh_token?: string }>;
  }

  private async refreshGoogleAccessToken(clientId: string) {
    const refreshToken = await keytar.getPassword(serviceName, googleDriveRefreshTokenAccount);
    if (!refreshToken) throw new Error("Google Drive is not connected.");
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        refresh_token: refreshToken,
        grant_type: "refresh_token"
      })
    });
    if (!response.ok) throw new Error(`Google token refresh failed: ${await response.text()}`);
    const token = (await response.json()) as { access_token: string };
    return token.access_token;
  }

  private async getGoogleAccountEmail(accessToken: string) {
    const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) return "";
    const profile = (await response.json()) as { email?: string };
    return profile.email ?? "";
  }

  private async uploadFileToGoogleDrive(accessToken: string, filePath: string): Promise<{ id: string; name: string }> {
    const fileName = `truepos-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
    const boundary = `truepos-${crypto.randomBytes(12).toString("hex")}`;
    const metadata = JSON.stringify({ name: fileName, mimeType: "application/octet-stream" });
    const fileContent = fs.readFileSync(filePath);
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      fileContent,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length)
      },
      body
    });
    if (!response.ok) throw new Error(`Google Drive upload failed: ${await response.text()}`);
    return response.json() as Promise<{ id: string; name: string }>;
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
    try {
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (!printWindow.isDestroyed()) printWindow.close();
          if (error) reject(error);
          else resolve();
        };
        const timeout = setTimeout(() => finish(new Error("Print dialog timed out.")), 120000);

        printWindow.on("closed", () => finish(new Error("Print window closed.")));
      printWindow.webContents.print({ silent: Boolean(deviceName), deviceName }, (success, failureReason) => {
          if (success) finish();
          else finish(new Error(failureReason || "Print cancelled."));
      });
      });
    } finally {
      if (!printWindow.isDestroyed()) printWindow.close();
    }
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

  private saveSettings(settings: AppSettings) {
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)").run(JSON.stringify(settings));
  }

  private getGoogleDriveClientId(settings?: AppSettings) {
    const legacySettingsClientId = settings ? String((settings.googleDrive as unknown as { clientId?: string }).clientId ?? "").trim() : "";
    const configPaths = [
      process.env.TRUEPOS_GOOGLE_CLIENT_CONFIG,
      app.isPackaged ? path.join(process.resourcesPath, "google-drive-oauth.json") : path.join(process.cwd(), "google-drive-oauth.json"),
      app.isPackaged ? path.join(path.dirname(process.execPath), "google-drive-oauth.json") : "",
      path.join(app.getPath("appData"), "TruePOS", "google-drive-oauth.json")
    ].filter(Boolean) as string[];
    const fileClientId = configPaths.map(readGoogleClientId).find(Boolean) ?? "";
    return process.env.TRUEPOS_GOOGLE_CLIENT_ID?.trim() || fileClientId || bundledGoogleDriveClientId || legacySettingsClientId;
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function base64Url(buffer: Buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function readGoogleClientId(configPath: string) {
  try {
    if (!fs.existsSync(configPath)) return "";
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as { clientId?: string; installed?: { client_id?: string } };
    const clientId = String(config.clientId || config.installed?.client_id || "").trim();
    if (!clientId || clientId.startsWith("YOUR_")) return "";
    return clientId;
  } catch {
    return "";
  }
}

function waitForGoogleOAuthCode(clientId: string, state: string, challenge: string) {
  return new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    const finish = (error?: Error, value?: { code: string; redirectUri: string }) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      server.close();
      if (error) reject(error);
      else if (value) resolve(value);
    };
    const server = http.createServer((request, response) => {
      const host = request.headers.host ?? "";
      const requestUrl = new URL(request.url ?? "/", `http://${host}`);
      if (requestUrl.pathname !== "/oauth2callback") {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const returnedState = requestUrl.searchParams.get("state");
      const code = requestUrl.searchParams.get("code");
      const error = requestUrl.searchParams.get("error");
      if (returnedState !== state) {
        response.writeHead(400, { "Content-Type": "text/html" });
        response.end("<h2>TruePOS Google Drive connection failed</h2><p>Invalid OAuth state.</p>");
        finish(new Error("Invalid Google OAuth state."));
      } else if (error) {
        response.writeHead(400, { "Content-Type": "text/html" });
        response.end(`<h2>TruePOS Google Drive connection failed</h2><p>${escapeHtml(error)}</p>`);
        finish(new Error(`Google OAuth failed: ${error}`));
      } else if (code) {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end("<h2>TruePOS Google Drive connected</h2><p>You can close this browser tab and return to TruePOS.</p>");
        finish(undefined, { code, redirectUri: `http://127.0.0.1:${(server.address() as { port: number }).port}/oauth2callback` });
      }
    });

    server.on("error", (error) => finish(error));
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: googleDriveScopes,
        access_type: "offline",
        prompt: "consent",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256"
      }).toString();
      shell.openExternal(authUrl.toString()).catch((error) => {
        finish(error);
      });
    });

    timeout = setTimeout(() => finish(new Error("Google Drive connection timed out.")), 180_000);
  });
}
