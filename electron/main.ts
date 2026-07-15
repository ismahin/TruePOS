import { app, BrowserWindow, ipcMain } from "electron";
import type { BrowserWindow as BrowserWindowType } from "electron";
import path from "node:path";
import { TruePOSServices } from "./services.js";

const services = new TruePOSServices();
let mainWindow: BrowserWindowType | null = null;
const appIconPath = app.isPackaged ? path.join(process.resourcesPath, "icon.png") : path.join(__dirname, "../../build/icon.png");

app.setAppUserModelId("com.truepos.desktop");

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1180,
    minHeight: 720,
    title: "TruePOS",
    icon: appIconPath,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

function registerIpc() {
  ipcMain.handle("auth:login", (_event, username: string, password: string) => services.login(username, password));
  ipcMain.handle("auth:logout", () => services.logout());
  ipcMain.handle("auth:getCurrentUser", () => services.getCurrentUser());
  ipcMain.handle("auth:isSetupRequired", () => services.isSetupRequired());
  ipcMain.handle("auth:setupInitialAdmin", (_event, username: string, password: string, cashier) => services.setupInitialAdmin(username, password, cashier));
  ipcMain.handle("auth:resetLoginCredentials", (_event, admin, cashier) => services.resetLoginCredentials(admin, cashier));

  ipcMain.handle("products:create", (_event, input) => services.createProduct(input));
  ipcMain.handle("products:update", (_event, id, input) => services.updateProduct(id, input));
  ipcMain.handle("products:delete", (_event, id) => services.deleteProduct(id));
  ipcMain.handle("products:search", (_event, query) => services.searchProducts(query));
  ipcMain.handle("products:list", (_event, params) => services.listProducts(params));
  ipcMain.handle("products:importCsv", (_event, csv) => services.importProductsCsv(csv));

  ipcMain.handle("inventory:adjust", (_event, productId, quantity, note, type) => services.adjustInventory(productId, quantity, note, type));
  ipcMain.handle("inventory:listMovements", (_event, productId) => services.listMovements(productId));
  ipcMain.handle("inventory:getStock", (_event, productId) => services.getStock(productId));

  ipcMain.handle("sales:createSale", (_event, lines, payment) => services.createSale(lines, payment));
  ipcMain.handle("sales:returnSale", (_event, saleId) => services.returnSale(saleId));
  ipcMain.handle("sales:cancelSale", (_event, saleId) => services.cancelSale(saleId));
  ipcMain.handle("sales:previewReceipt", (_event, lines, payment) => services.previewReceipt(lines, payment));
  ipcMain.handle("sales:getReceipt", (_event, saleId) => services.getReceipt(saleId));

  ipcMain.handle("reports:getDailySales", (_event, date) => services.getDailySales(date));
  ipcMain.handle("reports:getProductSales", (_event, dateFrom, dateTo) => services.getProductSales(dateFrom, dateTo));
  ipcMain.handle("reports:getInventoryValue", () => services.getInventoryValue());

  ipcMain.handle("printing:listPrinters", () => services.listPrinters(assertWindow()));
  ipcMain.handle("printing:testReceipt", () => services.printReceipt(assertWindow()));
  ipcMain.handle("printing:printReceipt", (_event, saleId) => services.printReceipt(assertWindow(), saleId));
  ipcMain.handle("printing:testBarcode", (_event, productId) => services.printBarcode(assertWindow(), productId, 1));
  ipcMain.handle("printing:printBarcode", (_event, productId, quantity) => services.printBarcode(assertWindow(), productId, quantity));

  ipcMain.handle("settings:get", () => services.getSettings());
  ipcMain.handle("settings:update", (_event, settings) => services.updateSettings(settings));

  ipcMain.handle("backup:exportEncrypted", () => services.exportEncrypted());
  ipcMain.handle("backup:importEncrypted", (_event, filePath) => services.importEncrypted(filePath));
  ipcMain.handle("backup:exportCsv", (_event, kind) => services.exportCsv(kind));
  ipcMain.handle("backup:connectGoogleDrive", () => services.connectGoogleDrive());
  ipcMain.handle("backup:disconnectGoogleDrive", () => services.disconnectGoogleDrive());
  ipcMain.handle("backup:backupGoogleDriveNow", () => services.backupGoogleDriveNow());
  ipcMain.handle("backup:factoryReset", () => services.factoryReset());
}

function assertWindow() {
  if (!mainWindow) throw new Error("Main window is not ready.");
  return mainWindow;
}

app.whenReady().then(async () => {
  await services.init();
  services.startGoogleDriveAutoBackupScheduler();
  registerIpc();
  await createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on("before-quit", () => services.close());
