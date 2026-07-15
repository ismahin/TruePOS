import { contextBridge, ipcRenderer } from "electron";
import type { TruePOSApi } from "../src/shared/contracts.js";

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: TruePOSApi = {
  auth: {
    login: (username, password) => invoke("auth:login", username, password),
    logout: () => invoke("auth:logout"),
    getCurrentUser: () => invoke("auth:getCurrentUser"),
    isSetupRequired: () => invoke("auth:isSetupRequired"),
    setupInitialAdmin: (username, password, cashier) => invoke("auth:setupInitialAdmin", username, password, cashier),
    resetLoginCredentials: (admin, cashier) => invoke("auth:resetLoginCredentials", admin, cashier)
  },
  products: {
    create: (input) => invoke("products:create", input),
    update: (id, input) => invoke("products:update", id, input),
    delete: (id) => invoke("products:delete", id),
    search: (query) => invoke("products:search", query),
    list: (params) => invoke("products:list", params),
    importCsv: (csv) => invoke("products:importCsv", csv)
  },
  inventory: {
    adjust: (productId, quantity, note, type) => invoke("inventory:adjust", productId, quantity, note, type),
    listMovements: (productId) => invoke("inventory:listMovements", productId),
    getStock: (productId) => invoke("inventory:getStock", productId)
  },
  sales: {
    createSale: (lines, payment) => invoke("sales:createSale", lines, payment),
    returnSale: (saleId) => invoke("sales:returnSale", saleId),
    cancelSale: (saleId) => invoke("sales:cancelSale", saleId),
    previewReceipt: (lines, payment) => invoke("sales:previewReceipt", lines, payment),
    getReceipt: (saleId) => invoke("sales:getReceipt", saleId)
  },
  reports: {
    getDailySales: (date) => invoke("reports:getDailySales", date),
    getProductSales: (dateFrom, dateTo) => invoke("reports:getProductSales", dateFrom, dateTo),
    getInventoryValue: () => invoke("reports:getInventoryValue")
  },
  printing: {
    listPrinters: () => invoke("printing:listPrinters"),
    testReceipt: () => invoke("printing:testReceipt"),
    printReceipt: (saleId) => invoke("printing:printReceipt", saleId),
    testBarcode: (productId) => invoke("printing:testBarcode", productId),
    printBarcode: (productId, quantity) => invoke("printing:printBarcode", productId, quantity)
  },
  settings: {
    get: () => invoke("settings:get"),
    update: (settings) => invoke("settings:update", settings)
  },
  backup: {
    exportEncrypted: () => invoke("backup:exportEncrypted"),
    importEncrypted: (filePath) => invoke("backup:importEncrypted", filePath),
    exportCsv: (kind) => invoke("backup:exportCsv", kind),
    connectGoogleDrive: () => invoke("backup:connectGoogleDrive"),
    disconnectGoogleDrive: () => invoke("backup:disconnectGoogleDrive"),
    backupGoogleDriveNow: () => invoke("backup:backupGoogleDriveNow"),
    factoryReset: () => invoke("backup:factoryReset")
  }
};

contextBridge.exposeInMainWorld("truePOS", api);
