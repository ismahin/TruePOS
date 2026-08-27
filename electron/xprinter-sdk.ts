import { app } from "electron";
import bwipjs from "bwip-js/node";
import fs from "node:fs";
import path from "node:path";
import koffi from "koffi";
import type { BarcodeSettings, Product } from "../src/shared/contracts.js";
import { buildXp365bLabelLayout, validateLabelQuantity, validateXp365bLabelSettings } from "../src/shared/xprinter.js";

type PrinterHandle = object;

type XprinterApi = {
  library: unknown;
  InitPrinter(model: string): PrinterHandle | null;
  ReleasePrinter(handle: PrinterHandle): number;
  OpenPort(handle: PrinterHandle, setting: string): number;
  ClosePort(handle: PrinterHandle): number;
  PrinterInitialize(handle: PrinterHandle): number;
  SetAlign(handle: PrinterHandle, alignment: number): number;
  PrintImage(handle: PrinterHandle, imagePath: string, scaleMode: number): number;
  FeedLine(handle: PrinterHandle, lines: number): number;
  TSPL_Setup(handle: PrinterHandle, speed: number, density: number, width: number, height: number, labelType: number, gap: number, offset: number): number;
  TSPL_ClearBuffer(handle: PrinterHandle): number;
  TSPL_SetCodePage(handle: PrinterHandle, codepage: string): number;
  TSPL_SetTear(handle: PrinterHandle, mode: number): number;
  TSPL_Block(handle: PrinterHandle, x: number, y: number, width: number, height: number, font: string, text: string, rotation: number, xScale: number, yScale: number, alignment: number): number;
  TSPL_BarCode(handle: PrinterHandle, x: number, y: number, type: number, text: string, height: number, showText: number, rotation: number, narrow: number, wide: number): number;
  TSPL_Print(handle: PrinterHandle, labels: number, copies: number): number;
  TSPL_Learn(handle: PrinterHandle): number;
  TSPL_GetPrinterStatus(handle: PrinterHandle, status: number[]): number;
};

const sdkErrors = new Map<number, string>([
  [-1, "invalid parameter"],
  [-2, "invalid printer handle"],
  [-3, "operation not implemented"],
  [-4, "insufficient memory"],
  [-5, "image load failed"],
  [-6, "invalid image format"],
  [-7, "invalid I/O handle"],
  [-8, "could not open the printer port"],
  [-9, "write failed"],
  [-10, "write timed out"],
  [-11, "status read failed"],
  [-12, "status read timed out"],
  [-16, "invalid USB path"],
  [-17, "XP-365B USB device not found"]
]);

function sdkError(operation: string, result: number) {
  return new Error(`Xprinter ${operation} failed: ${sdkErrors.get(result) ?? `SDK error ${result}`}.`);
}

function checkSdk(operation: string, result: number) {
  if (result !== 0) throw sdkError(operation, result);
}

function resolveSdkDllPath() {
  const architecture = process.arch === "ia32" ? "win32" : process.arch === "x64" ? "x64" : "";
  if (!architecture) throw new Error(`Xprinter SDK does not support the ${process.arch} application architecture.`);
  return app.isPackaged
    ? path.join(process.resourcesPath, "xprinter", architecture, "printer.sdk.dll")
    : path.join(process.cwd(), "vendor", "xprinter", architecture, "printer.sdk.dll");
}

function loadApi(): XprinterApi {
  if (process.platform !== "win32") throw new Error("Xprinter SDK printing is available only on Windows.");
  const dllPath = resolveSdkDllPath();
  if (!fs.existsSync(dllPath)) throw new Error(`Xprinter SDK runtime was not found at ${dllPath}.`);
  const library = koffi.load(dllPath);
  const defineFunction = library.func.bind(library) as unknown as (
    convention: string,
    name: string,
    result: string,
    parameters: unknown[]
  ) => unknown;
  const fn = <T>(name: string, result: string, parameters: unknown[]) =>
    defineFunction("__stdcall", name, result, parameters) as T;

  return {
    library,
    InitPrinter: fn("InitPrinter", "void *", ["str16"]),
    ReleasePrinter: fn("ReleasePrinter", "int", ["void *"]),
    OpenPort: fn("OpenPort", "int", ["void *", "str16"]),
    ClosePort: fn("ClosePort", "int", ["void *"]),
    PrinterInitialize: fn("PrinterInitialize", "int", ["void *"]),
    SetAlign: fn("SetAlign", "int", ["void *", "int"]),
    PrintImage: fn("PrintImage", "int", ["void *", "str", "int"]),
    FeedLine: fn("FeedLine", "int", ["void *", "int"]),
    TSPL_Setup: fn("TSPL_Setup", "int", ["void *", "int", "int", "int", "int", "int", "int", "int"]),
    TSPL_ClearBuffer: fn("TSPL_ClearBuffer", "int", ["void *"]),
    TSPL_SetCodePage: fn("TSPL_SetCodePage", "int", ["void *", "str"]),
    TSPL_SetTear: fn("TSPL_SetTear", "int", ["void *", "int"]),
    TSPL_Block: fn("TSPL_Block", "int", ["void *", "int", "int", "int", "int", "str", "str", "int", "int", "int", "int"]),
    TSPL_BarCode: fn("TSPL_BarCode", "int", ["void *", "int", "int", "int", "str", "int", "int", "int", "int", "int"]),
    TSPL_Print: fn("TSPL_Print", "int", ["void *", "int", "int"]),
    TSPL_Learn: fn("TSPL_Learn", "int", ["void *"]),
    TSPL_GetPrinterStatus: fn("TSPL_GetPrinterStatus", "int", ["void *", koffi.out(koffi.pointer("uint32_t"))])
  };
}

function decodeLabelStatus(status: number) {
  const states = [
    [1, "print head open"],
    [2, "paper jam"],
    [4, "out of labels"],
    [8, "out of ribbon"],
    [16, "printing paused"],
    [32, "printer busy"],
    [64, "cover open"],
    [128, "printer error"]
  ] as const;
  return states.filter(([flag]) => (status & flag) !== 0).map(([, name]) => name).join(", ") || `status ${status}`;
}

function assertTsplReady(api: XprinterApi, handle: PrinterHandle) {
  const status = [0];
  const statusResult = api.TSPL_GetPrinterStatus(handle, status);
  if (statusResult !== 0) {
    throw new Error(
      "XP-365B did not respond in TSPL label mode. Switch the printer from Receipt/ESC-POS mode to Label/TSPL mode, then try again."
    );
  }
  if (status[0] !== 0 && status[0] !== 32) {
    throw new Error(`XP-365B is not ready: ${decodeLabelStatus(status[0])}.`);
  }
}

function printableLabelName(product: Product) {
  const name = product.name.trim();
  return /^[\x20-\x7e]+$/.test(name) ? name : product.sku;
}

async function code128ModuleCount(value: string) {
  const png = await bwipjs.toBuffer({
    bcid: "code128",
    text: value,
    scale: 1,
    height: 1,
    includetext: false,
    paddingwidth: 0,
    paddingheight: 0
  });
  if (png.length < 24 || png.toString("ascii", 1, 4) !== "PNG") throw new Error("Could not measure the Code128 barcode.");
  return png.readUInt32BE(16);
}

export class XprinterSdk {
  private api: XprinterApi | null = null;
  private handle: PrinterHandle | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private getApi() {
    this.api ??= loadApi();
    return this.api;
  }

  private getHandle() {
    if (this.handle) return this.handle;
    const handle = this.getApi().InitPrinter("");
    if (!handle) throw new Error("Xprinter SDK could not initialize the XP-365B.");
    this.handle = handle;
    return handle;
  }

  private enqueue<T>(job: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private withUsbPort<T>(job: (api: XprinterApi, handle: PrinterHandle) => T) {
    const api = this.getApi();
    const handle = this.getHandle();
    checkSdk("USB connection", api.OpenPort(handle, "USB,"));
    try {
      return job(api, handle);
    } finally {
      api.ClosePort(handle);
    }
  }

  printReceiptImage(imagePath: string) {
    return this.enqueue(() => {
      if (!fs.existsSync(imagePath)) throw new Error("The generated receipt image was not found.");
      this.withUsbPort((api, handle) => {
        checkSdk("receipt initialization", api.PrinterInitialize(handle));
        checkSdk("receipt alignment", api.SetAlign(handle, 1));
        checkSdk("receipt image", api.PrintImage(handle, imagePath, 0));
        checkSdk("receipt feed", api.FeedLine(handle, 4));
      });
    });
  }

  printLabel(product: Product, settings: BarcodeSettings, quantity: number) {
    return this.enqueue(async () => {
      validateLabelQuantity(quantity);
      const modules = await code128ModuleCount(product.barcode);
      const layout = buildXp365bLabelLayout(product, settings, modules);
      this.withUsbPort((api, handle) => {
        assertTsplReady(api, handle);
        checkSdk(
          "label setup",
          api.TSPL_Setup(
            handle,
            Math.round(settings.printSpeed),
            Math.round(settings.density),
            Math.round(settings.labelWidthMm),
            Math.round(settings.labelHeightMm),
            1,
            Math.round(settings.gapMm),
            Math.round(settings.offsetMm)
          )
        );
        checkSdk("label code page", api.TSPL_SetCodePage(handle, "UTF-8"));
        checkSdk("label tear position", api.TSPL_SetTear(handle, 1));
        checkSdk("label buffer", api.TSPL_ClearBuffer(handle));
        if (settings.showName) {
          checkSdk(
            "label product name",
            api.TSPL_Block(handle, layout.name.x, layout.name.y, layout.name.width, layout.name.height, "2", printableLabelName(product), 0, 1, 1, 2)
          );
        }
        checkSdk(
          "label barcode",
          api.TSPL_BarCode(
            handle,
            layout.barcode.x,
            layout.barcode.y,
            0,
            product.barcode,
            layout.barcode.height,
            2,
            0,
            layout.barcode.narrow,
            layout.barcode.wide
          )
        );
        if (settings.showPrice) {
          checkSdk(
            "label price",
            api.TSPL_Block(handle, layout.price.x, layout.price.y, layout.price.width, layout.price.height, "3", `${product.price.toFixed(2)} BDT`, 0, 1, 1, 2)
          );
        }
        checkSdk("label print", api.TSPL_Print(handle, 1, quantity));
      });
    });
  }

  calibrateLabels(settings: BarcodeSettings) {
    return this.enqueue(() => {
      validateXp365bLabelSettings(settings);
      this.withUsbPort((api, handle) => {
        assertTsplReady(api, handle);
        checkSdk(
          "label setup",
          api.TSPL_Setup(
            handle,
            Math.round(settings.printSpeed),
            Math.round(settings.density),
            Math.round(settings.labelWidthMm),
            Math.round(settings.labelHeightMm),
            1,
            Math.round(settings.gapMm),
            Math.round(settings.offsetMm)
          )
        );
        checkSdk("label calibration", api.TSPL_Learn(handle));
      });
    });
  }

  close() {
    if (!this.api || !this.handle) return;
    try {
      this.api.ClosePort(this.handle);
      this.api.ReleasePrinter(this.handle);
    } finally {
      this.handle = null;
    }
  }
}
