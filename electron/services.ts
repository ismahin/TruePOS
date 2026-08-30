import { app, BrowserWindow, dialog, nativeImage, shell } from "electron";
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
import { XprinterSdk } from "./xprinter-sdk.js";
import type {
  AppSettings,
  CartLine,
  InventoryMovement,
  Product,
  ProductInput,
  ProductSalesReport,
  Sale,
  SaleCustomer,
  SalePayment,
  SalesReport,
  SalesTrendGranularity,
  SalesTrendReport,
  User
} from "../src/shared/contracts.js";
import { buildReceiptHtml, buildReceiptText, calculateTotals, escapeHtml, money, validateCode128Value } from "../src/shared/pos.js";
import { rankBySearchFields, rankSearchResults } from "../src/shared/search.js";
import { DEFAULT_APP_SETTINGS } from "../src/shared/default-settings.js";
import { makeReceiptBitmapMonochrome, XP365B_SAFE_RECEIPT_WIDTH_DOTS, validateLabelQuantity } from "../src/shared/xprinter.js";

type Row = Record<string, unknown>;
type PreparedSale = Omit<Sale, "lines"> & { lines: Array<CartLine & { unitCost: number }> };

const serviceName = "TruePOS";
const dbPasswordAccount = "local-database-key";
const googleDriveRefreshTokenAccount = "google-drive-refresh-token";
const googleDriveScopes = ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.file"].join(" ");
const bundledGoogleDriveClientId = "";
const legacyDemoCatalogCleanupKey = "legacy-demo-catalog-cleanup-v1";

const legacyDemoCatalog = [
  { sku: "DEMO-001", barcode: "8901001000001", name: "Basmati Rice 5kg", category: "Grocery", unit: "bag", cost: 650, price: 780, vatRate: 0, stock: 40, lowStockThreshold: 8 },
  { sku: "DEMO-002", barcode: "8901001000002", name: "Soybean Oil 1L", category: "Grocery", unit: "bottle", cost: 160, price: 185, vatRate: 0, stock: 60, lowStockThreshold: 12 },
  { sku: "DEMO-003", barcode: "8901001000003", name: "White Sugar 1kg", category: "Grocery", unit: "pack", cost: 110, price: 130, vatRate: 0, stock: 55, lowStockThreshold: 10 },
  { sku: "DEMO-004", barcode: "8901001000004", name: "Fresh Milk 1L", category: "Dairy", unit: "carton", cost: 70, price: 85, vatRate: 0, stock: 48, lowStockThreshold: 10 },
  { sku: "DEMO-005", barcode: "8901001000005", name: "Farm Eggs (12 pcs)", category: "Dairy", unit: "tray", cost: 140, price: 165, vatRate: 0, stock: 35, lowStockThreshold: 8 },
  { sku: "DEMO-006", barcode: "8901001000006", name: "Sandwich Bread", category: "Bakery", unit: "pcs", cost: 45, price: 55, vatRate: 0, stock: 30, lowStockThreshold: 6 },
  { sku: "DEMO-007", barcode: "8901001000007", name: "Potato 1kg", category: "Produce", unit: "kg", cost: 30, price: 40, vatRate: 0, stock: 80, lowStockThreshold: 15 },
  { sku: "DEMO-008", barcode: "8901001000008", name: "Onion 1kg", category: "Produce", unit: "kg", cost: 50, price: 65, vatRate: 0, stock: 70, lowStockThreshold: 15 },
  { sku: "DEMO-009", barcode: "8901001000009", name: "Black Tea 400g", category: "Grocery", unit: "pack", cost: 180, price: 220, vatRate: 0, stock: 42, lowStockThreshold: 8 },
  { sku: "DEMO-010", barcode: "8901001000010", name: "Bath Soap", category: "Personal Care", unit: "pcs", cost: 35, price: 45, vatRate: 5, stock: 90, lowStockThreshold: 20 },
  { sku: "DEMO-011", barcode: "8901001000011", name: "Shampoo 180ml", category: "Personal Care", unit: "bottle", cost: 120, price: 155, vatRate: 5, stock: 38, lowStockThreshold: 8 },
  { sku: "DEMO-012", barcode: "8901001000012", name: "Cream Biscuits", category: "Snacks", unit: "pack", cost: 25, price: 35, vatRate: 5, stock: 100, lowStockThreshold: 20 },
  { sku: "DEMO-013", barcode: "8901001000013", name: "Soft Drink 1.25L", category: "Beverages", unit: "bottle", cost: 55, price: 70, vatRate: 5, stock: 64, lowStockThreshold: 12 },
  { sku: "DEMO-014", barcode: "8901001000014", name: "Instant Noodles", category: "Snacks", unit: "pack", cost: 18, price: 25, vatRate: 5, stock: 120, lowStockThreshold: 24 },
  { sku: "DEMO-015", barcode: "8901001000015", name: "Masoor Dal 1kg", category: "Grocery", unit: "pack", cost: 120, price: 145, vatRate: 0, stock: 50, lowStockThreshold: 10 }
] as const;

const defaultSettings: AppSettings = DEFAULT_APP_SETTINGS;

function mergeSettings(settings: Partial<AppSettings>): AppSettings {
  const storedPrinterMode = String((settings as { printerMode?: string }).printerMode ?? "");
  const printerMode = storedPrinterMode === "escpos" ? "xprinter" : storedPrinterMode === "windows" || storedPrinterMode === "xprinter" ? storedPrinterMode : defaultSettings.printerMode;
  return {
    ...defaultSettings,
    ...settings,
    printerMode,
    receipt: {
      ...defaultSettings.receipt,
      ...settings.receipt,
      logoOffsetY: Math.max(0, Number(settings.receipt?.logoOffsetY ?? defaultSettings.receipt.logoOffsetY) || 0),
      logoScale: Math.min(200, Math.max(25, Number(settings.receipt?.logoScale ?? defaultSettings.receipt.logoScale) || 100))
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

function productImagesDir() {
  const dir = path.join(dataDir(), "product-images");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function clearProductImageFiles(productId: string) {
  for (const file of fs.readdirSync(productImagesDir())) {
    if (file === `${productId}.jpg` || file.startsWith(`${productId}.`)) {
      fs.rmSync(path.join(productImagesDir(), file), { force: true });
    }
  }
}

function persistProductImage(productId: string, value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    clearProductImageFiles(productId);
    return "";
  }
  if (raw === `product-images/${productId}.jpg`) return raw;
  if (raw.startsWith("product-images/")) {
    const fullPath = path.join(dataDir(), raw);
    if (!fs.existsSync(fullPath)) {
      clearProductImageFiles(productId);
      return "";
    }
    return raw;
  }

  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([a-z0-9+/=\s]+)$/i.exec(raw);
  if (!match) throw new Error("Product image must be a PNG, JPEG, or WebP image.");
  const source = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!source.length) throw new Error("Product image could not be read. Choose another image and try again.");
  if (source.length > 2_500_000) throw new Error("Product image is too large. Choose a smaller image and try again.");

  let image = nativeImage.createFromBuffer(source);
  if (image.isEmpty()) {
    image = nativeImage.createFromDataURL(raw);
  }
  if (image.isEmpty()) throw new Error("Product image could not be processed. Choose another image and try again.");

  const { width, height } = image.getSize();
  const maxSide = 480;
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  if (scale < 1) {
    image = image.resize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      quality: "best"
    });
  }

  const jpeg = image.toJPEG(82);
  clearProductImageFiles(productId);
  const relativePath = `product-images/${productId}.jpg`;
  fs.writeFileSync(path.join(dataDir(), relativePath), jpeg);
  return relativePath;
}

function resolveProductImage(stored: string) {
  const value = stored.trim();
  if (!value) return "";
  if (/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(value)) return value;
  if (!value.startsWith("product-images/")) return "";
  const fullPath = path.join(dataDir(), value);
  if (!fs.existsSync(fullPath)) return "";
  const buffer = fs.readFileSync(fullPath);
  if (!buffer.length) return "";
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

function databasePath() {
  return path.join(dataDir(), "truepos.db");
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

function validateLoginCredentials(admin: { username?: string; password?: string }, cashier?: { username?: string; password?: string }) {
  const adminUsername = admin.username?.trim() ?? "";
  const adminPassword = admin.password ?? "";
  if (adminUsername.length < 3) throw new Error("Admin username must be at least 3 characters.");
  if (adminPassword.length < 6) throw new Error("Admin password must be at least 6 characters.");
  const cashierUsername = cashier?.username?.trim() ?? "";
  const cashierPassword = cashier?.password ?? "";
  if (cashierUsername || cashierPassword) {
    if (cashierUsername.length < 3) throw new Error("Cashier username must be at least 3 characters.");
    if (cashierPassword.length < 6) throw new Error("Cashier password must be at least 6 characters.");
    if (cashierUsername.toLowerCase() === adminUsername.toLowerCase()) throw new Error("Cashier username must be different from admin username.");
    return { admin: { username: adminUsername, password: adminPassword }, cashier: { username: cashierUsername, password: cashierPassword } };
  }
  return { admin: { username: adminUsername, password: adminPassword }, cashier: undefined };
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
    imageDataUrl: resolveProductImage(String(row.image_data_url ?? "")),
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

function requireFiniteNumber(value: unknown, label: string, options: { min?: number; max?: number } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a valid number.`);
  if (options.min !== undefined && number < options.min) throw new Error(`${label} must be at least ${options.min}.`);
  if (options.max !== undefined && number > options.max) throw new Error(`${label} must not exceed ${options.max}.`);
  return number;
}

function localDateRange(dateFrom: string, dateTo = dateFrom) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(dateFrom) || !datePattern.test(dateTo)) throw new Error("Report dates must use YYYY-MM-DD format.");
  const parse = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    const result = new Date(year, month - 1, day);
    if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day) throw new Error("Invalid report date.");
    return result;
  };
  const start = parse(dateFrom);
  const end = parse(dateTo);
  if (start > end) throw new Error("Invalid report date range.");
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function parseLocalDateInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function toLocalDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addLocalDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function inclusiveLocalDayCount(dateFrom: string, dateTo: string) {
  const start = parseLocalDateInput(dateFrom);
  const end = parseLocalDateInput(dateTo);
  if (!start || !end || start > end) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function localDayKey(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return toLocalDateInput(date);
}

function eachLocalDay(dateFrom: string, dateTo: string) {
  const start = parseLocalDateInput(dateFrom);
  const end = parseLocalDateInput(dateTo);
  if (!start || !end || start > end) return [] as string[];
  const days: string[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor = addLocalDays(cursor, 1)) {
    days.push(toLocalDateInput(cursor));
  }
  return days;
}

function buildTrendBuckets(dateFrom: string, dateTo: string, granularity: SalesTrendGranularity) {
  const start = parseLocalDateInput(dateFrom);
  const end = parseLocalDateInput(dateTo);
  if (!start || !end || start > end) return [] as Array<{ key: string; from: string; to: string }>;

  if (granularity === "day") {
    return eachLocalDay(dateFrom, dateTo).map((day) => ({ key: day, from: day, to: day }));
  }

  if (granularity === "week") {
    const buckets: Array<{ key: string; from: string; to: string }> = [];
    let cursor = new Date(start);
    while (cursor <= end) {
      const from = toLocalDateInput(cursor);
      const weekEnd = addLocalDays(cursor, 6);
      const to = toLocalDateInput(weekEnd > end ? end : weekEnd);
      buckets.push({ key: from, from, to });
      cursor = addLocalDays(cursor, 7);
    }
    return buckets;
  }

  if (granularity === "month") {
    const buckets: Array<{ key: string; from: string; to: string }> = [];
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      const from = toLocalDateInput(monthStart < start ? start : monthStart);
      const to = toLocalDateInput(monthEnd > end ? end : monthEnd);
      buckets.push({
        key: `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`,
        from,
        to
      });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return buckets;
  }

  const buckets: Array<{ key: string; from: string; to: string }> = [];
  for (let year = start.getFullYear(); year <= end.getFullYear(); year += 1) {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);
    buckets.push({
      key: String(year),
      from: toLocalDateInput(yearStart < start ? start : yearStart),
      to: toLocalDateInput(yearEnd > end ? end : yearEnd)
    });
  }
  return buckets;
}

export class TruePOSServices {
  private db!: Database;
  private currentUser: User | null = null;
  private googleDriveBackupTimer: NodeJS.Timeout | null = null;
  private googleDriveBackupRunning = false;
  private readonly xprinter = new XprinterSdk();

  async init(recoverUnreadable = true) {
    const dbPath = databasePath();
    const key = await getDatabaseKey();
    try {
      this.openDatabase(dbPath, key);
      this.migrate();
      this.seed();
    } catch (error) {
      this.close();
      if (!recoverUnreadable || !isUnreadableDatabaseError(error)) throw error;

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
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
  }

  close() {
    this.xprinter.close();
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
        stock REAL NOT NULL DEFAULT 0 CHECK(stock >= 0),
        low_stock_threshold REAL NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        image_data_url TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS price_history (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        old_price REAL NOT NULL,
        new_price REAL NOT NULL,
        changed_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id)
      );
      CREATE TABLE IF NOT EXISTS inventory_movements (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('stock_in', 'stock_out', 'adjustment', 'sale', 'return')),
        quantity REAL NOT NULL,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id)
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
        customer_name TEXT NOT NULL DEFAULT '',
        customer_phone TEXT NOT NULL DEFAULT '',
        bill_discount REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK(status IN ('completed', 'returned', 'cancelled')),
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
        unit_cost REAL NOT NULL DEFAULT 0,
        discount REAL NOT NULL,
        vat_rate REAL NOT NULL,
        FOREIGN KEY (sale_id) REFERENCES sales(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const saleLineColumns = this.db.pragma("table_info(sale_lines)") as Row[];
    if (!saleLineColumns.some((column) => String(column.name) === "unit_cost")) {
      this.db.exec("ALTER TABLE sale_lines ADD COLUMN unit_cost REAL NOT NULL DEFAULT 0");
      this.db.exec(`UPDATE sale_lines
        SET unit_cost = COALESCE((SELECT cost FROM products WHERE products.id = sale_lines.product_id), 0)`);
    }
    const productColumns = this.db.pragma("table_info(products)") as Row[];
    if (!productColumns.some((column) => String(column.name) === "image_data_url")) {
      this.db.exec("ALTER TABLE products ADD COLUMN image_data_url TEXT NOT NULL DEFAULT ''");
    }
    const saleColumns = this.db.pragma("table_info(sales)") as Row[];
    if (!saleColumns.some((column) => String(column.name) === "customer_name")) {
      this.db.exec("ALTER TABLE sales ADD COLUMN customer_name TEXT NOT NULL DEFAULT ''");
    }
    if (!saleColumns.some((column) => String(column.name) === "customer_phone")) {
      this.db.exec("ALTER TABLE sales ADD COLUMN customer_phone TEXT NOT NULL DEFAULT ''");
    }
    if (!saleColumns.some((column) => String(column.name) === "bill_discount")) {
      this.db.exec("ALTER TABLE sales ADD COLUMN bill_discount REAL NOT NULL DEFAULT 0");
    }
    // Enforce non-negative stock on existing DBs (CREATE CHECK only applies to fresh tables).
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS products_stock_non_negative_insert
      BEFORE INSERT ON products
      FOR EACH ROW
      WHEN NEW.stock < 0
      BEGIN
        SELECT RAISE(ABORT, 'Stock cannot go below zero.');
      END;
      CREATE TRIGGER IF NOT EXISTS products_stock_non_negative_update
      BEFORE UPDATE OF stock ON products
      FOR EACH ROW
      WHEN NEW.stock < 0
      BEGIN
        SELECT RAISE(ABORT, 'Stock cannot go below zero.');
      END;
    `);
    // Remove leftover cancelled drafts (usually failed prints) so they never clutter Today's sales.
    this.db.exec(`
      DELETE FROM sale_lines WHERE sale_id IN (SELECT id FROM sales WHERE status = 'cancelled');
      DELETE FROM sales WHERE status = 'cancelled';
    `);
  }

  private seed() {
    const settings = this.db.prepare("SELECT value FROM settings WHERE key = 'app'").get<{ value: string }>();
    if (!settings) {
      this.db.prepare("INSERT INTO settings (key, value) VALUES ('app', ?)").run(JSON.stringify(defaultSettings));
    }
    this.removeLegacyDemoCatalog();
  }

  private removeLegacyDemoCatalog() {
    const cleanupDone = this.db.prepare("SELECT 1 FROM settings WHERE key = ?").get(legacyDemoCatalogCleanupKey);
    if (cleanupDone) return;

    const findProduct = this.db.prepare("SELECT * FROM products WHERE sku = ? AND barcode = ?");
    const findSaleCount = this.db.prepare("SELECT COUNT(*) AS count FROM sale_lines WHERE product_id = ?");
    const findPriceHistoryCount = this.db.prepare("SELECT COUNT(*) AS count FROM price_history WHERE product_id = ?");
    const findMovements = this.db.prepare("SELECT type, quantity, note FROM inventory_movements WHERE product_id = ?");
    const deleteMovements = this.db.prepare("DELETE FROM inventory_movements WHERE product_id = ?");
    const deleteProduct = this.db.prepare("DELETE FROM products WHERE id = ?");
    const deactivateProduct = this.db.prepare("UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?");
    const removedImageIds: string[] = [];

    this.db.transaction(() => {
      for (const item of legacyDemoCatalog) {
        const product = findProduct.get(item.sku, item.barcode) as Row | undefined;
        if (!product) continue;

        const productId = String(product.id);
        const saleCount = Number((findSaleCount.get(productId) as Row | undefined)?.count ?? 0);
        const priceHistoryCount = Number((findPriceHistoryCount.get(productId) as Row | undefined)?.count ?? 0);
        const movements = findMovements.all(productId) as Row[];
        const unchangedProduct =
          String(product.name) === item.name &&
          String(product.category) === item.category &&
          String(product.unit) === item.unit &&
          Number(product.cost) === item.cost &&
          Number(product.price) === item.price &&
          Number(product.vat_rate) === item.vatRate &&
          Number(product.stock) === item.stock &&
          Number(product.low_stock_threshold) === item.lowStockThreshold;
        const onlyDemoOpeningStock =
          movements.length === 1 &&
          String(movements[0].type) === "stock_in" &&
          Number(movements[0].quantity) === item.stock &&
          String(movements[0].note) === "Demo opening stock";

        if (saleCount === 0 && priceHistoryCount === 0 && unchangedProduct && onlyDemoOpeningStock) {
          deleteMovements.run(productId);
          deleteProduct.run(productId);
          removedImageIds.push(productId);
        } else {
          // Keep historical references valid while removing the legacy demo item from the active catalog.
          deactivateProduct.run(now(), productId);
        }
      }

      this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(legacyDemoCatalogCleanupKey, now());
    })();

    for (const productId of removedImageIds) {
      try {
        clearProductImageFiles(productId);
      } catch (error) {
        console.warn(`Could not remove legacy demo image for product ${productId}:`, error);
      }
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
    const normalized = String(username ?? "").trim();
    const row = this.db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get<Row>(normalized);
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

  async isSetupRequired() {
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM users").get<{ count: number }>()?.count ?? 0;
    return count === 0;
  }

  async setupInitialAdmin(username: string, password: string, cashier?: { username?: string; password?: string }) {
    if (!(await this.isSetupRequired())) throw new Error("Initial setup is already complete.");
    const credentials = validateLoginCredentials({ username, password }, cashier);
    const user = this.replaceLoginUsers(credentials.admin, credentials.cashier);
    this.currentUser = user;
    return user;
  }

  async resetLoginCredentials(currentAdmin: { username?: string; password?: string }, admin: { username?: string; password?: string }, cashier?: { username?: string; password?: string }) {
    if (await this.isSetupRequired()) throw new Error("Create the first admin account before resetting login information.");
    const currentUsername = String(currentAdmin?.username ?? "").trim();
    const currentRow = this.db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE AND role = 'admin'").get<Row>(currentUsername);
    if (!currentRow || !verifyPassword(String(currentAdmin?.password ?? ""), String(currentRow.password_hash))) {
      throw new Error("Current admin username or password is incorrect.");
    }
    const credentials = validateLoginCredentials(admin, cashier);
    const cashierRow = this.db.prepare("SELECT * FROM users WHERE role = 'cashier' ORDER BY created_at LIMIT 1").get<Row>();
    this.db.transaction(() => {
      this.db.prepare("UPDATE users SET username = ?, password_hash = ? WHERE id = ?")
        .run(credentials.admin.username, hashPassword(credentials.admin.password), String(currentRow.id));
      if (credentials.cashier) {
        if (cashierRow) {
          this.db.prepare("UPDATE users SET username = ?, password_hash = ? WHERE id = ?")
            .run(credentials.cashier.username, hashPassword(credentials.cashier.password), String(cashierRow.id));
        } else {
          this.db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, 'cashier', ?)")
            .run(uuid(), credentials.cashier.username, hashPassword(credentials.cashier.password), now());
        }
      }
    })();
    this.currentUser = null;
    return { adminUsername: credentials.admin.username, cashierUsername: credentials.cashier?.username ?? (cashierRow ? String(cashierRow.username) : "") };
  }

  async createProduct(input: ProductInput) {
    this.requireAdmin();
    const sku = String(input.sku ?? "").trim();
    const name = String(input.name ?? "").trim();
    const category = String(input.category ?? "").trim();
    if (!sku || sku.length > 64) throw new Error("SKU must be 1-64 characters.");
    if (!name || name.length > 200) throw new Error("Product name must be 1-200 characters.");
    if (!category || category.length > 100) throw new Error("Category is required (max 100 characters).");
    const cleanedBarcode = validateCode128Value(input.barcode || sku);
    const productId = uuid();
    const product: Product = {
      id: productId,
      sku,
      barcode: cleanedBarcode,
      name,
      category,
      unit: input.unit?.trim() || "pcs",
      cost: requireFiniteNumber(input.cost ?? 0, "Cost", { min: 0 }),
      price: requireFiniteNumber(input.price ?? 0, "Price", { min: 0 }),
      vatRate: requireFiniteNumber(input.vatRate ?? 0, "VAT rate", { min: 0, max: 100 }),
      stock: requireFiniteNumber(input.stock ?? 0, "Opening stock", { min: 0 }),
      lowStockThreshold: requireFiniteNumber(input.lowStockThreshold ?? 0, "Low-stock threshold", { min: 0 }),
      isActive: input.isActive ?? true,
      imageDataUrl: persistProductImage(productId, input.imageDataUrl),
      createdAt: now(),
      updatedAt: now()
    };
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO products
          (id, sku, barcode, name, category, unit, cost, price, vat_rate, stock, low_stock_threshold, is_active, image_data_url, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          product.imageDataUrl,
          product.createdAt,
          product.updatedAt
        );
      if (product.stock !== 0) this.addMovement(product.id, "stock_in", product.stock, "Opening stock");
    })();
    return productFromRow(this.db.prepare("SELECT * FROM products WHERE id = ?").get<Row>(product.id)!);
  }

  async updateProduct(id: string, input: Partial<ProductInput>) {
    const user = this.requireAdmin();
    const existing = this.db.prepare("SELECT * FROM products WHERE id = ?").get<Row>(id);
    if (!existing) throw new Error("Product not found.");
    const next = { ...productFromRow(existing), ...input, updatedAt: now() };
    next.sku = String(next.sku).trim();
    next.name = String(next.name).trim();
    next.category = String(next.category ?? "").trim();
    next.unit = String(next.unit ?? "").trim() || "pcs";
    if (!next.sku || next.sku.length > 64) throw new Error("SKU must be 1-64 characters.");
    if (!next.name || next.name.length > 200) throw new Error("Product name must be 1-200 characters.");
    if (!next.category || next.category.length > 100) throw new Error("Category is required (max 100 characters).");
    next.cost = requireFiniteNumber(next.cost, "Cost", { min: 0 });
    next.price = requireFiniteNumber(next.price, "Price", { min: 0 });
    next.vatRate = requireFiniteNumber(next.vatRate, "VAT rate", { min: 0, max: 100 });
    next.lowStockThreshold = requireFiniteNumber(next.lowStockThreshold, "Low-stock threshold", { min: 0 });
    next.barcode = validateCode128Value(next.barcode || next.sku);
    const storedImage = persistProductImage(id, input.imageDataUrl !== undefined ? input.imageDataUrl : String(existing.image_data_url ?? ""));
    next.imageDataUrl = storedImage;
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE products SET sku=?, barcode=?, name=?, category=?, unit=?, cost=?, price=?, vat_rate=?,
          low_stock_threshold=?, is_active=?, image_data_url=?, updated_at=? WHERE id=?`
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
          storedImage,
          next.updatedAt,
          id
        );
      if (Number(existing.price) !== next.price) {
        this.db
          .prepare("INSERT INTO price_history (id, product_id, old_price, new_price, changed_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(uuid(), id, Number(existing.price), next.price, user.id, now());
      }
    })();
    return productFromRow(this.db.prepare("SELECT * FROM products WHERE id = ?").get<Row>(id)!);
  }

  async deleteProduct(id: string) {
    this.requireAdmin();
    const existing = this.db.prepare("SELECT * FROM products WHERE id = ?").get<Row>(id);
    if (!existing) throw new Error("Product not found.");
    this.db.prepare("UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?").run(now(), id);
    return productFromRow(this.db.prepare("SELECT * FROM products WHERE id = ?").get<Row>(id)!);
  }

  async deleteAllProducts() {
    this.requireAdmin();
    const result = this.db.prepare("UPDATE products SET is_active = 0, updated_at = ? WHERE is_active = 1").run(now());
    return { deleted: Number(result.changes ?? 0) };
  }

  async searchProducts(query: string) {
    const trimmed = query.trim();
    const products = this.db
      .prepare(
        trimmed
          ? "SELECT * FROM products WHERE is_active = 1 ORDER BY name LIMIT 2000"
          : "SELECT * FROM products WHERE is_active = 1 ORDER BY name LIMIT 100"
      )
      .all<Row>()
      .map(productFromRow);

    if (!trimmed) return products;
    return rankSearchResults(products, trimmed).slice(0, 100);
  }

  async listProducts(params?: { query?: string; includeInactive?: boolean; lowStockOnly?: boolean; category?: string }) {
    const filters = params ?? {};
    const trimmed = (filters.query ?? "").trim();
    const category = (filters.category ?? "").trim();
    const rows = this.db
      .prepare(
        `SELECT * FROM products
         WHERE (? = 1 OR is_active = 1)
           AND (? = '' OR category = ?)
           AND (? = 0 OR stock <= low_stock_threshold)
         ORDER BY is_active DESC, name ASC
         LIMIT 2000`
      )
      .all<Row>(filters.includeInactive ? 1 : 0, category, category, filters.lowStockOnly ? 1 : 0)
      .map(productFromRow);

    return trimmed ? rankSearchResults(rows, trimmed) : rows;
  }

  async importProductsCsv(csv: string) {
    this.requireAdmin();
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of parsed.data) {
      const sku = String(row.sku ?? "").trim();
      const name = String(row.name ?? "").trim();
      if (!sku || !name) {
        skipped += 1;
        if (errors.length < 8) errors.push("A row was skipped because SKU or name was missing.");
        continue;
      }

      const activeRaw = String(row.is_active ?? row.isActive ?? "1").trim().toLowerCase();
      const isActive = !(activeRaw === "0" || activeRaw === "false" || activeRaw === "no" || activeRaw === "inactive");
      const payload = {
        sku,
        barcode: String(row.barcode || sku).trim(),
        name,
        category: String(row.category || "").trim(),
        unit: String(row.unit || "pcs").trim() || "pcs",
        cost: Number(row.cost || 0),
        price: Number(row.price || 0),
        vatRate: Number(row.vatRate || row.vat_rate || 0),
        stock: Number(row.stock || 0),
        lowStockThreshold: Number(row.lowStockThreshold || row.low_stock_threshold || 0),
        isActive,
        imageDataUrl: ""
      };

      try {
        const barcode = validateCode128Value(payload.barcode || sku);
        payload.barcode = barcode;
        const existing =
          this.db.prepare("SELECT * FROM products WHERE sku = ? COLLATE NOCASE").get<Row>(sku) ??
          this.db.prepare("SELECT * FROM products WHERE barcode = ?").get<Row>(barcode);
        if (existing) {
          await this.updateProduct(String(existing.id), {
            ...payload,
            // Keep current image unless CSV somehow includes inline image data.
            imageDataUrl: undefined
          });
          // updateProduct ignores stock; set stock + reactivate explicitly for CSV restore.
          this.db
            .prepare("UPDATE products SET stock = ?, is_active = ?, updated_at = ? WHERE id = ?")
            .run(requireFiniteNumber(payload.stock, "Opening stock", { min: 0 }), payload.isActive ? 1 : 0, now(), String(existing.id));
          updated += 1;
        } else {
          await this.createProduct(payload);
          imported += 1;
        }
      } catch (error) {
        skipped += 1;
        if (errors.length < 8) {
          const raw = error instanceof Error ? error.message : "Unknown import error.";
          const reason = /UNIQUE|constraint/i.test(raw)
            ? "SKU or barcode already exists on another product."
            : raw;
          errors.push(`${sku}: ${reason}`);
        }
      }
    }

    return { imported, updated, skipped, errors };
  }

  async adjustInventory(productId: string, quantity: number, note: string, type: InventoryMovement["type"] = "adjustment") {
    this.requireAdmin();
    const delta = requireFiniteNumber(quantity, "Inventory quantity");
    if (!(["stock_in", "stock_out", "adjustment"] as const).includes(type as "stock_in" | "stock_out" | "adjustment")) {
      throw new Error("Invalid inventory movement type.");
    }
    const product = this.db.prepare("SELECT * FROM products WHERE id = ?").get<Row>(productId);
    if (!product) throw new Error("Product not found.");
    const nextStock = Number(product.stock) + delta;
    if (nextStock < 0) throw new Error("Stock cannot go below zero.");
    this.db.transaction(() => {
      this.db.prepare("UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?").run(delta, now(), productId);
      this.addMovement(productId, type, delta, String(note ?? "").trim() || "Manual adjustment");
    })();
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

  async createAndPrintSale(
    window: BrowserWindowType,
    lines: CartLine[],
    payment: SalePayment,
    billDiscount = 0,
    customer?: SaleCustomer,
    /** Soft-reserved qty on other parked bills (renderer-held); charge must leave this stock free. */
    reservedStockByProductId: Record<string, number> = {}
  ) {
    const sale = this.prepareSale(lines, payment, billDiscount, customer, reservedStockByProductId);
    // Persist first so stock and the sale never diverge from a printed receipt.
    this.persistSale(sale, reservedStockByProductId);
    try {
      await this.printSale(window, sale);
    } catch (error) {
      try {
        // Print never finished — remove the draft sale so it does not appear as a cancelled bill
        // and so a retry does not leave a pile of unused TP-###### numbers in Today's sales.
        this.abortUnprintedSale(sale.id);
      } catch {
        // Prefer surfacing the print failure; stock reverse is best-effort recovery.
      }
      throw error;
    }
    return sale;
  }

  /** Restock and delete a sale that was persisted only to print, then failed before a receipt was issued. */
  private abortUnprintedSale(saleId: string) {
    const sale = this.getSale(saleId);
    if (sale.status !== "completed") return;
    this.db.transaction(() => {
      for (const line of sale.lines) {
        this.db.prepare("UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?").run(line.quantity, now(), line.productId);
        this.addMovement(line.productId, "adjustment", line.quantity, `Print aborted ${sale.receiptNo}`);
      }
      this.db.prepare("DELETE FROM sale_lines WHERE sale_id = ?").run(saleId);
      this.db.prepare("DELETE FROM sales WHERE id = ?").run(saleId);
    })();
  }

  private normalizeSaleCustomer(customer?: SaleCustomer) {
    return {
      customerName: String(customer?.name ?? "").trim().slice(0, 120),
      customerPhone: String(customer?.phone ?? "").trim().slice(0, 40)
    };
  }

  private prepareSale(
    lines: CartLine[],
    payment: SalePayment,
    billDiscount = 0,
    customer?: SaleCustomer,
    reservedStockByProductId: Record<string, number> = {}
  ) {
    const user = this.requireUser();
    const validated = this.validateSaleInput(lines, payment, billDiscount, reservedStockByProductId);
    const totals = calculateTotals(validated.lines, validated.billDiscount);
    const saleCustomer = this.normalizeSaleCustomer(customer);
    return {
      id: uuid(),
      receiptNo: `TP-${Date.now()}-${uuid().slice(0, 4).toUpperCase()}`,
      lines: validated.lines,
      payment: validated.payment,
      totals,
      cashierId: user.id,
      cashierName: user.username,
      customerName: saleCustomer.customerName,
      customerPhone: saleCustomer.customerPhone,
      status: "completed" as const,
      createdAt: now()
    } satisfies PreparedSale;
  }

  private persistSale(sale: PreparedSale, reservedStockByProductId: Record<string, number> = {}) {
    const tx = this.db.transaction(() => {
      for (const line of sale.lines) {
        const product = this.db.prepare("SELECT stock FROM products WHERE id = ?").get<Row>(line.productId);
        if (!product) throw new Error(`Product not found: ${line.name}`);
        const reserved = Math.max(0, Number(reservedStockByProductId[line.productId] ?? 0) || 0);
        const free = Number(product.stock) - reserved;
        if (free < line.quantity) {
          throw new Error(
            reserved > 0
              ? `Insufficient stock for ${line.name}: ${Number(product.stock)} on hand, ${reserved} reserved on parked bills.`
              : `Insufficient stock for ${line.name}.`
          );
        }
      }
      this.db
        .prepare(
          `INSERT INTO sales
          (id, receipt_no, payment_method, payment_amount, subtotal, discount_total, taxable_total, vat_total, grand_total,
           cashier_id, cashier_name, customer_name, customer_phone, bill_discount, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          sale.id,
          sale.receiptNo,
          sale.payment.method,
          sale.payment.amount,
          sale.totals.subtotal,
          sale.totals.discountTotal,
          sale.totals.taxableTotal,
          sale.totals.vatTotal,
          sale.totals.grandTotal,
          sale.cashierId,
          sale.cashierName,
          sale.customerName,
          sale.customerPhone,
          sale.totals.billDiscountTotal,
          sale.status,
          sale.createdAt
        );
      for (const line of sale.lines) {
        this.db
          .prepare(
            `INSERT INTO sale_lines
            (id, sale_id, product_id, sku, barcode, name, quantity, unit_price, unit_cost, discount, vat_rate)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(uuid(), sale.id, line.productId, line.sku, line.barcode, line.name, line.quantity, line.unitPrice, line.unitCost, line.discount, line.vatRate);
        this.db.prepare("UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?").run(line.quantity, now(), line.productId);
        this.addMovement(line.productId, "sale", -line.quantity, `Sale ${sale.receiptNo}`);
      }
    });
    tx();
  }

  async returnSale(saleId: string) {
    this.requireAdmin();
    return this.reverseCompletedSale(saleId, {
      status: "returned",
      note: (receiptNo) => `Return ${receiptNo}`,
      allowCashier: false
    });
  }

  async cancelSale(saleId: string) {
    return this.reverseCompletedSale(saleId, {
      status: "cancelled",
      note: (receiptNo) => `Cancelled ${receiptNo}`,
      allowCashier: true
    });
  }

  private reverseCompletedSale(
    saleId: string,
    options: {
      status: "returned" | "cancelled";
      note: string | ((receiptNo: string) => string);
      allowCashier: boolean;
    }
  ) {
    const user = this.requireUser();
    const sale = this.getSale(saleId);
    if (sale.status === "returned") throw new Error("Sale has already been returned.");
    if (sale.status === "cancelled") throw new Error("Sale has already been cancelled.");
    if (sale.status !== "completed") throw new Error("Only completed sales can be reversed.");
    if (user.role !== "admin") {
      if (!options.allowCashier) throw new Error("Admin permission required.");
      if (sale.cashierId !== user.id) throw new Error("You can only cancel your own sale.");
    }
    const noteText = typeof options.note === "string" ? options.note : options.note(sale.receiptNo);
    this.db.transaction(() => {
      this.db.prepare("UPDATE sales SET status = ? WHERE id = ?").run(options.status, saleId);
      for (const line of sale.lines) {
        this.db.prepare("UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?").run(line.quantity, now(), line.productId);
        this.addMovement(line.productId, "return", line.quantity, noteText);
      }
    })();
    return { ...sale, status: options.status };
  }

  async previewReceipt(lines: CartLine[], payment: SalePayment, billDiscount = 0, customer?: SaleCustomer) {
    const user = this.requireUser();
    const validated = this.validateSaleInput(lines, payment, billDiscount);
    const totals = calculateTotals(validated.lines, validated.billDiscount);
    const saleCustomer = this.normalizeSaleCustomer(customer);
    const previewSale: Sale = {
      id: "preview",
      receiptNo: "Preview",
      lines: validated.lines,
      payment: validated.payment,
      totals,
      cashierId: user.id,
      cashierName: user.username,
      customerName: saleCustomer.customerName,
      customerPhone: saleCustomer.customerPhone,
      status: "completed",
      createdAt: now()
    };
    const settings = await this.getSettings();
    return settings.printerMode === "xprinter"
      ? buildReceiptHtml(previewSale, settings, { widthPx: XP365B_SAFE_RECEIPT_WIDTH_DOTS, thermal: true })
      : buildReceiptHtml(previewSale, settings);
  }

  async searchReceipts(query: string) {
    this.requireUser();
    const trimmed = String(query ?? "").trim();
    if (!trimmed) return [];
    if (trimmed.length > 120) throw new Error("Search text must not exceed 120 characters.");
    if (!/^[\p{L}\p{N}\s\-+#._/()]+$/u.test(trimmed)) {
      throw new Error("Search can only include letters, numbers, spaces, and common phone/receipt symbols.");
    }

    const rows = this.db
      .prepare(
        `SELECT id, receipt_no, customer_name, customer_phone, cashier_name, created_at
         FROM sales
         WHERE status = 'completed'
         ORDER BY created_at DESC
         LIMIT 1000`
      )
      .all<Row>();

    const ranked = rankBySearchFields(rows, trimmed, (row) => ({
      name: String(row.customer_name ?? ""),
      sku: String(row.receipt_no ?? ""),
      barcode: String(row.customer_phone ?? ""),
      category: `${String(row.customer_phone ?? "")} ${String(row.cashier_name ?? "")}`.trim()
    })).slice(0, 40);

    return ranked.map((row) => this.getSale(String(row.id)));
  }

  async listSalesForDate(date: string, limit = 40) {
    this.requireUser();
    const capped = Math.max(1, Math.min(100, Math.floor(Number(limit) || 40)));
    const { start, end } = localDateRange(date, date);
    const rows = this.db
      .prepare(
        `SELECT id FROM sales
         WHERE status = 'completed' AND created_at >= ? AND created_at < ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all<Row>(start, end, capped);
    return rows.map((row) => this.getSale(String(row.id)));
  }

  async previewSavedReceipt(saleId: string) {
    this.requireUser();
    const sale = this.getSale(String(saleId ?? ""));
    const settings = await this.getSettings();
    return settings.printerMode === "xprinter"
      ? buildReceiptHtml(sale, settings, { widthPx: XP365B_SAFE_RECEIPT_WIDTH_DOTS, thermal: true })
      : buildReceiptHtml(sale, settings);
  }

  async getReceipt(saleId: string) {
    return buildReceiptText(this.getSale(saleId), await this.getSettings());
  }

  async getDailySales(date: string): Promise<SalesReport> {
    return { ...(await this.getSalesSummary(date, date)), date };
  }

  async getSalesSummary(dateFrom: string, dateTo: string): Promise<SalesReport> {
    const { start, end } = localDateRange(dateFrom, dateTo);
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS sales_count, COALESCE(SUM(subtotal),0) AS subtotal, COALESCE(SUM(discount_total),0) AS discount_total,
        COALESCE(SUM(vat_total),0) AS vat_total, COALESCE(SUM(grand_total),0) AS grand_total
        FROM sales WHERE status = 'completed' AND created_at >= ? AND created_at < ?`
      )
      .get<Row>(start, end)!;
    const profit = this.db
      .prepare(
        `SELECT COALESCE(SUM((l.unit_price - l.discount - l.unit_cost) * l.quantity), 0) AS profit
         FROM sale_lines l JOIN sales s ON s.id = l.sale_id
         WHERE s.status = 'completed' AND s.created_at >= ? AND s.created_at < ?`
      )
      .get<Row>(start, end)!;
    return {
      date: dateFrom === dateTo ? dateFrom : `${dateFrom} to ${dateTo}`,
      salesCount: Number(row.sales_count),
      subtotal: Number(row.subtotal),
      discountTotal: Number(row.discount_total),
      vatTotal: Number(row.vat_total),
      grandTotal: Number(row.grand_total),
      profitEstimate: Number(profit.profit)
    };
  }

  async getSalesTrend(dateFrom: string, dateTo: string): Promise<SalesTrendReport> {
    const dayCount = inclusiveLocalDayCount(dateFrom, dateTo);
    if (dayCount <= 0) return { granularity: "day", dayCount: 0, points: [] };

    const granularity: SalesTrendGranularity =
      dayCount <= 62 ? "day" : dayCount <= 270 ? "week" : dayCount <= 1461 ? "month" : "year";
    const buckets = buildTrendBuckets(dateFrom, dateTo, granularity);
    const { start, end } = localDateRange(dateFrom, dateTo);

    const salesRows = this.db
      .prepare(
        `SELECT created_at, subtotal, discount_total, vat_total, grand_total
         FROM sales WHERE status = 'completed' AND created_at >= ? AND created_at < ?`
      )
      .all<Row>(start, end);
    const profitRows = this.db
      .prepare(
        `SELECT s.created_at AS created_at, ((l.unit_price - l.discount - l.unit_cost) * l.quantity) AS profit
         FROM sale_lines l JOIN sales s ON s.id = l.sale_id
         WHERE s.status = 'completed' AND s.created_at >= ? AND s.created_at < ?`
      )
      .all<Row>(start, end);

    const daily = new Map<string, SalesReport>();
    const ensureDay = (day: string) => {
      let row = daily.get(day);
      if (!row) {
        row = { date: day, salesCount: 0, subtotal: 0, discountTotal: 0, vatTotal: 0, grandTotal: 0, profitEstimate: 0 };
        daily.set(day, row);
      }
      return row;
    };

    for (const row of salesRows) {
      const day = localDayKey(String(row.created_at ?? ""));
      if (!day) continue;
      const target = ensureDay(day);
      target.salesCount += 1;
      target.subtotal += Number(row.subtotal) || 0;
      target.discountTotal += Number(row.discount_total) || 0;
      target.vatTotal += Number(row.vat_total) || 0;
      target.grandTotal += Number(row.grand_total) || 0;
    }
    for (const row of profitRows) {
      const day = localDayKey(String(row.created_at ?? ""));
      if (!day) continue;
      ensureDay(day).profitEstimate += Number(row.profit) || 0;
    }

    const points = buckets.map((bucket) => {
      const point: SalesReport = {
        date: bucket.key,
        salesCount: 0,
        subtotal: 0,
        discountTotal: 0,
        vatTotal: 0,
        grandTotal: 0,
        profitEstimate: 0
      };
      for (const day of eachLocalDay(bucket.from, bucket.to)) {
        const source = daily.get(day);
        if (!source) continue;
        point.salesCount += source.salesCount;
        point.subtotal += source.subtotal;
        point.discountTotal += source.discountTotal;
        point.vatTotal += source.vatTotal;
        point.grandTotal += source.grandTotal;
        point.profitEstimate += source.profitEstimate;
      }
      return point;
    });

    return { granularity, dayCount, points };
  }

  async getProductSales(dateFrom: string, dateTo: string): Promise<ProductSalesReport[]> {
    const { start, end } = localDateRange(dateFrom, dateTo);
    return this.db
      .prepare(
        `SELECT l.product_id, l.sku, l.name, SUM(l.quantity) AS quantity, SUM((l.unit_price - l.discount) * l.quantity) AS revenue,
                COALESCE(MAX(p.image_data_url), '') AS image_data_url
         FROM sale_lines l
         JOIN sales s ON s.id = l.sale_id
         LEFT JOIN products p ON p.id = l.product_id
         WHERE s.status = 'completed' AND s.created_at >= ? AND s.created_at < ?
         GROUP BY l.product_id, l.sku, l.name ORDER BY revenue DESC`
      )
      .all<Row>(start, end)
      .map((row) => ({
        productId: String(row.product_id),
        sku: String(row.sku),
        name: String(row.name),
        quantity: Number(row.quantity),
        revenue: Number(row.revenue),
        imageDataUrl: resolveProductImage(String(row.image_data_url ?? ""))
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
    const sale = saleId ? this.getSale(saleId) : this.sampleSale();
    await this.printSale(window, sale);
  }

  private async printSale(window: BrowserWindowType, sale: Sale) {
    const settings = await this.getSettings();
    if (settings.printerMode === "xprinter") {
      if (settings.receipt.widthMm !== 80) throw new Error("XP-365B SDK receipt mode requires the 80mm paper setting.");
      const imagePath = await this.renderXprinterReceipt(buildReceiptHtml(sale, settings, { widthPx: XP365B_SAFE_RECEIPT_WIDTH_DOTS, thermal: true }));
      try {
        await this.xprinter.printReceiptImage(imagePath);
      } finally {
        fs.rmSync(imagePath, { force: true });
      }
      return;
    }
    await this.printHtml(window, buildReceiptHtml(sale, settings), settings.receiptPrinter);
  }

  async printBarcode(window: BrowserWindowType, productId: string, quantity: number) {
    const labelCount = validateLabelQuantity(quantity);
    const settings = await this.getSettings();
    const productRow = this.db.prepare("SELECT * FROM products WHERE id = ?").get<Row>(productId);
    if (!productRow) throw new Error("Product not found.");
    const product = productFromRow(productRow);
    if (settings.printerMode === "xprinter") {
      await this.xprinter.printLabel(product, settings.barcode, labelCount);
      return;
    }
    const png = await bwipjs.toBuffer({ bcid: "code128", text: product.barcode, scale: 2, height: 10, includetext: false });
    const labels = Array.from({ length: labelCount }, () => {
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

  async calibrateLabels() {
    this.requireAdmin();
    const settings = await this.getSettings();
    if (settings.printerMode !== "xprinter") throw new Error("Select Xprinter XP-365B SDK mode before calibrating labels.");
    await this.xprinter.calibrateLabels(settings.barcode);
  }

  async installXprinterDriver() {
    this.requireAdmin();
    const driverPath = app.isPackaged
      ? path.join(process.resourcesPath, "xprinter-driver", "DriverWizard.exe")
      : path.join(process.cwd(), "vendor", "xprinter-driver", "runtime", "DriverWizard.exe");
    if (!fs.existsSync(driverPath)) {
      throw new Error("The Xprinter DriverWizard files are missing. Install the latest TruePOS release and try again.");
    }
    const result = await shell.openPath(driverPath);
    if (result) throw new Error("Windows could not open the Xprinter DriverWizard.");
  }

  async exportEncrypted() {
    this.requireAdmin();
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
    if (path.resolve(selectedPath).toLowerCase() === path.resolve(dbPath).toLowerCase()) throw new Error("Select an exported backup file, not the active database.");
    const rollbackPath = path.join(dataDir(), `truepos-rollback-${Date.now()}.db`);
    this.close();
    if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, rollbackPath);
    try {
      fs.rmSync(`${dbPath}-wal`, { force: true });
      fs.rmSync(`${dbPath}-shm`, { force: true });
      fs.copyFileSync(selectedPath, dbPath);
      await this.init(false);
      if (fs.existsSync(rollbackPath)) fs.rmSync(rollbackPath, { force: true });
      return selectedPath;
    } catch (error) {
      this.close();
      if (fs.existsSync(rollbackPath)) fs.copyFileSync(rollbackPath, dbPath);
      await this.init(false);
      throw error;
    } finally {
      if (fs.existsSync(rollbackPath)) fs.rmSync(rollbackPath, { force: true });
    }
  }

  async factoryReset() {
    this.requireAdmin();
    if (this.googleDriveBackupTimer) {
      clearInterval(this.googleDriveBackupTimer);
      this.googleDriveBackupTimer = null;
    }
    this.currentUser = null;
    await keytar.deletePassword(serviceName, googleDriveRefreshTokenAccount);
    this.close();
    const dbPath = databasePath();
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${dbPath}${suffix}`, { force: true });
    }
    await this.init();
    this.startGoogleDriveAutoBackupScheduler();
  }

  async exportCsv(kind: "products" | "inventory" | "sales") {
    this.requireAdmin();
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
    const backupPath = path.join(app.getPath("temp"), `truepos-drive-backup-${Date.now()}.db`);
    try {
      const clientId = this.getGoogleDriveClientId(settings);
      if (!clientId) throw new Error("Google Drive backup is not configured for this TruePOS build.");
      const accessToken = await this.refreshGoogleAccessToken(clientId);
      await this.db.backup(backupPath);
      const uploaded = await this.uploadFileToGoogleDrive(accessToken, backupPath);
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
      fs.rmSync(backupPath, { force: true });
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
    if (!response.ok) {
      throw new Error("Google Drive authorization could not be completed. Reconnect Google Drive and try again.");
    }
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
    if (!response.ok) {
      throw new Error("The Google Drive connection has expired. Reconnect Google Drive and try again.");
    }
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
    if (!response.ok) {
      throw new Error("The backup could not be uploaded to Google Drive. Check the internet connection and available Drive storage, then try again.");
    }
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

  private validateSaleInput(
    lines: CartLine[],
    payment: SalePayment,
    billDiscount = 0,
    reservedStockByProductId: Record<string, number> = {}
  ) {
    if (!Array.isArray(lines) || lines.length === 0) throw new Error("Sale must contain at least one product.");
    if (!payment || !(["cash", "card", "mobile"] as const).includes(payment.method)) throw new Error("Invalid payment method.");
    const amount = money(requireFiniteNumber(payment.amount, "Paid amount", { min: 0, max: 1_000_000_000 }));
    const normalizedBillDiscount = money(requireFiniteNumber(billDiscount ?? 0, "Bill discount", { min: 0, max: 1_000_000_000 }));
    const normalized = new Map<string, CartLine & { unitCost: number }>();

    for (const input of lines) {
      const productId = String(input?.productId ?? "").trim();
      if (!productId) throw new Error("A sale line is missing its product.");
      const quantity = requireFiniteNumber(input.quantity, "Sale quantity", { min: Number.EPSILON, max: 1_000_000 });
      const discount = money(requireFiniteNumber(input.discount, "Line discount", { min: 0, max: 1_000_000_000 }));
      const productRow = this.db.prepare("SELECT * FROM products WHERE id = ?").get<Row>(productId);
      if (!productRow) throw new Error(`Product not found: ${input.name || productId}`);
      const product = productFromRow(productRow);
      if (!product.isActive) throw new Error(`${product.name} is inactive and cannot be sold.`);
      if (discount > product.price) throw new Error(`Discount cannot exceed the unit price for ${product.name}.`);

      const existing = normalized.get(productId);
      if (existing) {
        if (existing.discount !== discount) throw new Error(`${product.name} appears more than once with different discounts.`);
        existing.quantity = requireFiniteNumber(existing.quantity + quantity, `Total quantity for ${product.name}`, { max: 1_000_000 });
      } else {
        normalized.set(productId, {
          productId: product.id,
          sku: product.sku,
          barcode: product.barcode,
          name: product.name,
          quantity,
          unitPrice: product.price,
          unitCost: product.cost,
          discount,
          vatRate: product.vatRate
        });
      }
    }

    for (const line of normalized.values()) {
      const stock = Number(this.db.prepare("SELECT stock FROM products WHERE id = ?").get<Row>(line.productId)?.stock);
      const reserved = Math.max(0, Number(reservedStockByProductId[line.productId] ?? 0) || 0);
      const free = (Number.isFinite(stock) ? stock : 0) - reserved;
      if (!Number.isFinite(stock) || free < line.quantity) {
        throw new Error(
          reserved > 0
            ? `Insufficient stock for ${line.name}: ${stock} on hand, ${reserved} reserved on parked bills.`
            : `Insufficient stock for ${line.name}.`
        );
      }
    }

    return {
      lines: [...normalized.values()],
      payment: { method: payment.method, amount } as SalePayment,
      billDiscount: normalizedBillDiscount
    };
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
    const itemDiscountTotal = money(
      lines.reduce((sum, line) => sum + line.quantity * line.discount, 0)
    );
    const billDiscountTotal = money(Number(row.bill_discount ?? 0));
    return {
      id: String(row.id),
      receiptNo: String(row.receipt_no),
      lines,
      payment: { method: row.payment_method as SalePayment["method"], amount: Number(row.payment_amount) },
      totals: {
        subtotal: Number(row.subtotal),
        itemDiscountTotal,
        billDiscountTotal,
        discountTotal: Number(row.discount_total),
        taxableTotal: Number(row.taxable_total),
        vatTotal: Number(row.vat_total),
        grandTotal: Number(row.grand_total)
      },
      cashierId: String(row.cashier_id),
      cashierName: String(row.cashier_name),
      customerName: String(row.customer_name ?? ""),
      customerPhone: String(row.customer_phone ?? ""),
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

  private async renderXprinterReceipt(html: string) {
    const width = XP365B_SAFE_RECEIPT_WIDTH_DOTS;
    const renderWindow = new BrowserWindow({
      show: false,
      width,
      height: 800,
      useContentSize: true,
      backgroundColor: "#ffffff",
      webPreferences: { sandbox: true }
    });
    const target = path.join(app.getPath("temp"), `truepos-xp365b-receipt-${uuid()}.png`);
    try {
      await renderWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await renderWindow.webContents.executeJavaScript("Promise.all(Array.from(document.images).map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; })))");
      const height = await renderWindow.webContents.executeJavaScript("Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))") as number;
      if (!Number.isFinite(height) || height < 1 || height > 30000) throw new Error("Receipt is too long to render safely.");
      renderWindow.setContentSize(width, height);
      await renderWindow.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      const captured = await renderWindow.webContents.capturePage({ x: 0, y: 0, width, height });
      const exact = captured.getSize().width === width ? captured : captured.resize({ width, quality: "best" });
      const exactSize = exact.getSize();
      const monochrome = nativeImage.createFromBitmap(Buffer.from(makeReceiptBitmapMonochrome(exact.toBitmap())), {
        width: exactSize.width,
        height: exactSize.height,
        scaleFactor: 1
      });
      fs.writeFileSync(target, monochrome.toPNG());
      return target;
    } catch (error) {
      fs.rmSync(target, { force: true });
      throw error;
    } finally {
      if (!renderWindow.isDestroyed()) renderWindow.close();
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
      customerName: "",
      customerPhone: "",
      status: "completed",
      createdAt: now()
    };
  }

  private saveSettings(settings: AppSettings) {
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)").run(JSON.stringify(settings));
  }

  private replaceLoginUsers(admin: { username: string; password: string }, cashier?: { username: string; password: string }) {
    const createdAt = now();
    const adminUser: User = { id: uuid(), username: admin.username, role: "admin" };
    const insertUser = this.db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)");
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM users").run();
      insertUser.run(adminUser.id, adminUser.username, hashPassword(admin.password), adminUser.role, createdAt);
      if (cashier) {
        insertUser.run(uuid(), cashier.username, hashPassword(cashier.password), "cashier", createdAt);
      }
    })();
    return adminUser;
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
        finish(new Error("Google Drive authorization was cancelled or could not be completed. Please try connecting again."));
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
