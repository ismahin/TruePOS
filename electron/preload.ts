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
    resetLoginCredentials: (currentAdmin, admin, cashier) => invoke("auth:resetLoginCredentials", currentAdmin, admin, cashier)
  },
  products: {
    create: (input) => invoke("products:create", input),
    update: (id, input) => invoke("products:update", id, input),
    delete: (id) => invoke("products:delete", id),
    deleteAll: () => invoke("products:deleteAll"),
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
    createAndPrintSale: (lines, payment, billDiscount, customer, reservedStockByProductId) =>
      invoke("sales:createAndPrintSale", lines, payment, billDiscount, customer, reservedStockByProductId),
    returnSale: (saleId) => invoke("sales:returnSale", saleId),
    cancelSale: (saleId) => invoke("sales:cancelSale", saleId),
    previewReceipt: (lines, payment, billDiscount, customer) =>
      invoke("sales:previewReceipt", lines, payment, billDiscount, customer),
    searchReceipts: (query) => invoke("sales:searchReceipts", query),
    listSalesForDate: (date, limit) => invoke("sales:listSalesForDate", date, limit),
    previewSavedReceipt: (saleId) => invoke("sales:previewSavedReceipt", saleId),
    getReceipt: (saleId) => invoke("sales:getReceipt", saleId)
  },
  reports: {
    getDailySales: (date) => invoke("reports:getDailySales", date),
    getSalesSummary: (dateFrom, dateTo) => invoke("reports:getSalesSummary", dateFrom, dateTo),
    getSalesTrend: (dateFrom, dateTo) => invoke("reports:getSalesTrend", dateFrom, dateTo),
    getProductSales: (dateFrom, dateTo) => invoke("reports:getProductSales", dateFrom, dateTo),
    getInventoryValue: () => invoke("reports:getInventoryValue")
  },
  printing: {
    listPrinters: () => invoke("printing:listPrinters"),
    testReceipt: () => invoke("printing:testReceipt"),
    printReceipt: (saleId) => invoke("printing:printReceipt", saleId),
    testBarcode: (productId) => invoke("printing:testBarcode", productId),
    printBarcode: (productId, quantity) => invoke("printing:printBarcode", productId, quantity),
    calibrateLabels: () => invoke("printing:calibrateLabels"),
    installXprinterDriver: () => invoke("printing:installXprinterDriver")
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
  },
  updates: {
    getState: () => invoke("updates:getState"),
    check: () => invoke("updates:check"),
    download: () => invoke("updates:download"),
    install: () => invoke("updates:install"),
    onStateChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state);
      ipcRenderer.on("updates:stateChanged", handler);
      return () => ipcRenderer.removeListener("updates:stateChanged", handler);
    }
  }
};

contextBridge.exposeInMainWorld("truePOS", api);
