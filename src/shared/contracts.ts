export type Role = "admin" | "cashier";

export type User = {
  id: string;
  username: string;
  role: Role;
};

export type Product = {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  category: string;
  unit: string;
  cost: number;
  price: number;
  vatRate: number;
  stock: number;
  lowStockThreshold: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProductInput = Omit<Product, "id" | "stock" | "createdAt" | "updatedAt"> & {
  stock?: number;
};

export type InventoryMovement = {
  id: string;
  productId: string;
  productName: string;
  type: "stock_in" | "stock_out" | "adjustment" | "sale" | "return";
  quantity: number;
  note: string;
  createdAt: string;
};

export type CartLine = {
  productId: string;
  sku: string;
  barcode: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  vatRate: number;
};

export type SalePayment = {
  method: "cash" | "card" | "mobile";
  amount: number;
};

export type SaleTotals = {
  subtotal: number;
  discountTotal: number;
  taxableTotal: number;
  vatTotal: number;
  grandTotal: number;
};

export type Sale = {
  id: string;
  receiptNo: string;
  lines: CartLine[];
  payment: SalePayment;
  totals: SaleTotals;
  cashierId: string;
  cashierName: string;
  status: "completed" | "returned";
  createdAt: string;
};

export type ReceiptSettings = {
  widthMm: 58 | 80;
  fontSize: number;
  fontFamily: string;
  language: "en" | "bn";
  padding: number;
  logoDataUrl: string;
  logoWidthMm: number;
  logoHeightMm: number;
  logoScale: number;
  logoOffsetX: number;
  logoOffsetY: number;
  header: string;
  footer: string;
  showVatBreakdown: boolean;
};

export type BarcodeSettings = {
  format: "code128";
  labelWidthMm: number;
  labelHeightMm: number;
  padding: number;
  printSpeed: number;
  density: number;
  gapMm: number;
  offsetMm: number;
  showName: boolean;
  showPrice: boolean;
};

export type GoogleDriveBackupSettings = {
  connected: boolean;
  accountEmail: string;
  autoBackupEnabled: boolean;
  backupTime: string;
  lastBackupAt: string;
  lastBackupStatus: string;
};

export type AppSettings = {
  shopName: string;
  currency: "BDT";
  receiptPrinter: string;
  barcodePrinter: string;
  printerMode: "windows" | "xprinter";
  receipt: ReceiptSettings;
  barcode: BarcodeSettings;
  googleDrive: GoogleDriveBackupSettings;
};

export type SalesReport = {
  date: string;
  salesCount: number;
  subtotal: number;
  discountTotal: number;
  vatTotal: number;
  grandTotal: number;
  profitEstimate: number;
};

export type ProductSalesReport = {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  revenue: number;
};

export type InventoryValueReport = {
  products: number;
  units: number;
  costValue: number;
  retailValue: number;
  lowStockCount: number;
};

export type AuthApi = {
  login(username: string, password: string): Promise<User>;
  logout(): Promise<void>;
  getCurrentUser(): Promise<User | null>;
  isSetupRequired(): Promise<boolean>;
  setupInitialAdmin(username: string, password: string, cashier?: { username: string; password: string }): Promise<User>;
  resetLoginCredentials(currentAdmin: { username: string; password: string }, admin: { username: string; password: string }, cashier?: { username: string; password: string }): Promise<{ adminUsername: string; cashierUsername: string }>;
};

export type ProductApi = {
  create(input: ProductInput): Promise<Product>;
  update(id: string, input: Partial<ProductInput>): Promise<Product>;
  delete(id: string): Promise<Product>;
  search(query: string): Promise<Product[]>;
  list(params?: { query?: string; includeInactive?: boolean; lowStockOnly?: boolean; category?: string }): Promise<Product[]>;
  importCsv(csv: string): Promise<{ imported: number; skipped: number }>;
};

export type InventoryApi = {
  adjust(productId: string, quantity: number, note: string, type?: "stock_in" | "stock_out" | "adjustment"): Promise<Product>;
  listMovements(productId?: string): Promise<InventoryMovement[]>;
  getStock(productId: string): Promise<number>;
};

export type SalesApi = {
  createSale(lines: CartLine[], payment: SalePayment): Promise<Sale>;
  returnSale(saleId: string): Promise<Sale>;
  cancelSale(saleId: string): Promise<Sale>;
  previewReceipt(lines: CartLine[], payment: SalePayment): Promise<string>;
  searchReceipts(receiptNumber: string): Promise<Sale[]>;
  previewSavedReceipt(saleId: string): Promise<string>;
  getReceipt(saleId: string): Promise<string>;
};

export type ReportsApi = {
  getDailySales(date: string): Promise<SalesReport>;
  getSalesSummary(dateFrom: string, dateTo: string): Promise<SalesReport>;
  getProductSales(dateFrom: string, dateTo: string): Promise<ProductSalesReport[]>;
  getInventoryValue(): Promise<InventoryValueReport>;
};

export type PrintingApi = {
  listPrinters(): Promise<string[]>;
  testReceipt(): Promise<void>;
  printReceipt(saleId: string): Promise<void>;
  testBarcode(productId: string): Promise<void>;
  printBarcode(productId: string, quantity: number): Promise<void>;
  calibrateLabels(): Promise<void>;
};

export type SettingsApi = {
  get(): Promise<AppSettings>;
  update(settings: Partial<AppSettings>): Promise<AppSettings>;
};

export type BackupApi = {
  exportEncrypted(): Promise<string>;
  importEncrypted(filePath?: string): Promise<string>;
  exportCsv(kind: "products" | "inventory" | "sales"): Promise<string>;
  connectGoogleDrive(): Promise<AppSettings>;
  disconnectGoogleDrive(): Promise<AppSettings>;
  backupGoogleDriveNow(): Promise<AppSettings>;
  factoryReset(): Promise<void>;
};

export type TruePOSApi = {
  auth: AuthApi;
  products: ProductApi;
  inventory: InventoryApi;
  sales: SalesApi;
  reports: ReportsApi;
  printing: PrintingApi;
  settings: SettingsApi;
  backup: BackupApi;
};
