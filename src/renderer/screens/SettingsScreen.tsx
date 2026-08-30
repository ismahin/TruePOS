import { Download, Printer, RefreshCw, RotateCcw, Settings, Trash2, Upload } from "lucide-react";
import { useEffect, useReducer, useState } from "react";
import type { AppSettings, AppUpdateState, CartLine, Product, User } from "../../shared/contracts";
import { DEFAULT_APP_SETTINGS } from "../../shared/default-settings";
import { buildReceiptHtml, calculateTotals, formatBdt } from "../../shared/pos";
import { XP365B_SAFE_RECEIPT_WIDTH_DOTS } from "../../shared/xprinter";
import { api } from "../api";
import { friendlyErrorMessage, type Notify } from "../errors";
import { initialSettingsEditorState, settingsEditorReducer } from "../settings-editor-state";
import { NumberInput, ReceiptPreview } from "../ui";

function SoftwareUpdatePanel({ state, notify }: { state: AppUpdateState | null; notify: Notify }) {
  const checkForUpdates = async () => {
    try {
      const next = await api.updates.check();
      if (next.status === "up-to-date") notify("TruePOS is already up to date.");
      if (next.status === "available") notify(`TruePOS ${next.availableVersion} is available.`);
      if (next.status === "error") notify(next.message, "error");
    } catch (error) {
      notify(friendlyErrorMessage(error, "TruePOS could not check for updates. Check the internet connection and try again."), "error");
    }
  };

  const downloadUpdate = async () => {
    try {
      const next = await api.updates.download();
      if (next.status === "downloaded") notify("The update is ready. Restart TruePOS to finish installing it.");
      if (next.status === "error") notify(next.message, "error");
    } catch (error) {
      notify(friendlyErrorMessage(error, "The TruePOS update could not be downloaded. Check the internet connection and try again."), "error");
    }
  };

  const installUpdate = async () => {
    try {
      await api.updates.install();
    } catch (error) {
      notify(friendlyErrorMessage(error, "The update could not be installed. Restart TruePOS and try again."), "error");
    }
  };

  const status = state?.status ?? "idle";
  const statusLabel = {
    disabled: "Installed builds only",
    idle: "Ready to check",
    checking: "Checking",
    "up-to-date": "Up to date",
    available: "Update available",
    downloading: "Downloading",
    downloaded: "Ready to install",
    error: "Check failed"
  }[status];
  const currentVersion = state?.currentVersion ?? "...";
  const updateVisible = status === "available" || status === "downloading" || status === "downloaded";

  return (
    <div className={`panel software-update-panel update-${status}`}>
      <div className="screen-heading">
        <div>
          <h2>Software Update</h2>
          <p>TruePOS checks GitHub automatically and installs updates without a manual reinstall</p>
        </div>
        <span className={`status-pill ${status === "available" || status === "downloaded" ? "active" : status === "error" ? "inactive" : ""}`}>{statusLabel}</span>
      </div>
      <div className="update-version-row">
        <div><small>Installed version</small><strong>v{currentVersion}</strong></div>
        {state?.availableVersion && <div><small>Latest version</small><strong>v{state.availableVersion}</strong></div>}
      </div>
      <p className="update-message">{state?.message ?? "Loading update information..."}</p>
      {status === "downloading" && (
        <div className="update-progress" aria-label={`Update download ${Math.round(state?.percent ?? 0)} percent`}>
          <span style={{ width: `${state?.percent ?? 0}%` }} />
        </div>
      )}
      {state?.checkedAt && <small className="update-checked">Last checked: {new Date(state.checkedAt).toLocaleString()}</small>}
      <div className="update-actions">
        <button className="secondary" type="button" disabled={status === "checking" || status === "downloading" || status === "downloaded" || status === "disabled"} onClick={() => void checkForUpdates()}>
          <RefreshCw size={16} className={status === "checking" ? "spin" : ""} /> {status === "checking" ? "Checking..." : "Check for Updates"}
        </button>
        {updateVisible && status === "available" && (
          <button className="primary" type="button" onClick={() => void downloadUpdate()}>
            <Download size={16} /> Update to v{state?.availableVersion}
          </button>
        )}
        {updateVisible && status === "downloading" && (
          <button className="primary" type="button" disabled>
            <Download size={16} /> Downloading {Math.round(state?.percent ?? 0)}%
          </button>
        )}
        {updateVisible && status === "downloaded" && (
          <button className="primary" type="button" onClick={() => void installUpdate()}>
            <RefreshCw size={16} /> Restart and Update
          </button>
        )}
      </div>
    </div>
  );
}

export function SettingsScreen({ user, notify, updateState, onFactoryReset }: { user: User; notify: Notify; updateState: AppUpdateState | null; onFactoryReset: () => void }) {
  const [settingsState, dispatchSettings] = useReducer(settingsEditorReducer, initialSettingsEditorState);
  const settings = settingsState.settings;
  const [printers, setPrinters] = useState<string[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [labelProductId, setLabelProductId] = useState("");
  const [labelQuantity, setLabelQuantity] = useState(1);

  const load = async () => {
    const [nextSettings, nextProducts] = await Promise.all([
      api.settings.get(),
      api.products.list({ includeInactive: false }).catch(() => api.products.search(""))
    ]);
    dispatchSettings({ type: "load", settings: nextSettings });
    setProducts(nextProducts);
    setLabelProductId((current) => (current && nextProducts.some((product) => product.id === current) ? current : nextProducts[0]?.id ?? ""));
    api.printing.listPrinters().then(setPrinters).catch((err) => {
      setPrinters([]);
      notify(friendlyErrorMessage(err, "Windows printers could not be loaded. Check the printer connection and try refreshing."), "error");
    });
  };

  useEffect(() => {
    void load().catch((err) => notify(friendlyErrorMessage(err, "Settings could not be loaded. Please reopen Settings and try again."), "error"));
  }, [notify]);

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
  const previewSale = {
    id: "preview",
    receiptNo: "TP-PREVIEW",
    lines: [sampleLine],
    payment: { method: "cash" as const, amount: 300 },
    totals: calculateTotals([sampleLine]),
    cashierId: user.id,
    cashierName: user.username,
    customerName: "",
    customerPhone: "",
    status: "completed" as const,
    createdAt: new Date().toISOString()
  };
  const previewReceipt = settings.printerMode === "xprinter"
    ? buildReceiptHtml(previewSale, settings, { widthPx: XP365B_SAFE_RECEIPT_WIDTH_DOTS, thermal: true })
    : buildReceiptHtml(previewSale, settings);

  const updateReceipt = (receipt: Partial<AppSettings["receipt"]>) => {
    dispatchSettings({
      type: "edit",
      update: (current) => ({ ...current, receipt: { ...current.receipt, ...receipt } })
    });
  };

  const updateBarcode = (barcode: Partial<AppSettings["barcode"]>) => {
    dispatchSettings({
      type: "edit",
      update: (current) => ({ ...current, barcode: { ...current.barcode, ...barcode } })
    });
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
      image.onerror = () => notify("The selected file is not a readable image. Choose a PNG, JPEG, or other supported image and try again.", "error");
      image.src = String(reader.result);
    };
    reader.onerror = () => notify("The logo file could not be read. Choose another image and try again.", "error");
    reader.readAsDataURL(file);
  };

  const save = async () => {
    const startedRevision = settingsState.revision;
    const snapshot = settings;
    try {
      const saved = await api.settings.update(snapshot);
      dispatchSettings({ type: "async-result", settings: saved, startedRevision });
      notify("Settings saved.");
    } catch (err) {
      notify(friendlyErrorMessage(err, "Settings could not be saved. Check the entered values and try again."), "error");
    }
  };

  const resetToDefaults = async () => {
    if (
      !window.confirm(
        "Reset shop, printer, receipt, and label settings to defaults?\n\nGoogle Drive connection stays as it is. Changes are saved immediately."
      )
    ) {
      return;
    }
    const startedRevision = settingsState.revision;
    try {
      const next = {
        ...DEFAULT_APP_SETTINGS,
        googleDrive: settings.googleDrive
      };
      const saved = await api.settings.update(next);
      dispatchSettings({ type: "async-result", settings: saved, startedRevision });
      notify("Settings restored to defaults.");
    } catch (err) {
      notify(friendlyErrorMessage(err, "Defaults could not be restored. Please try again."), "error");
    }
  };

  const importBackup = async () => {
    try {
      const path = await api.backup.importEncrypted();
      notify(`Backup imported: ${path}`);
      await load();
    } catch (err) {
      notify(friendlyErrorMessage(err, "The backup could not be imported. Select a valid TruePOS backup and try again."), "error");
    }
  };

  const connectGoogleDrive = async () => {
    const startedRevision = settingsState.revision;
    const snapshot = settings;
    try {
      await api.settings.update(snapshot);
      const connected = await api.backup.connectGoogleDrive();
      dispatchSettings({ type: "async-google-result", settings: connected, startedRevision });
      notify("Google Drive connected.");
    } catch (err) {
      notify(friendlyErrorMessage(err, "Google Drive could not be connected. Check the internet connection and try again."), "error");
    }
  };

  const backupGoogleDriveNow = async () => {
    const startedRevision = settingsState.revision;
    const snapshot = settings;
    try {
      await api.settings.update(snapshot);
      const backedUp = await api.backup.backupGoogleDriveNow();
      dispatchSettings({ type: "async-google-result", settings: backedUp, startedRevision });
      notify("Google Drive backup uploaded.");
    } catch (err) {
      notify(friendlyErrorMessage(err, "The Google Drive backup could not be uploaded. Check the connection and try again."), "error");
    }
  };

  const disconnectGoogleDrive = async () => {
    const startedRevision = settingsState.revision;
    try {
      const disconnected = await api.backup.disconnectGoogleDrive();
      dispatchSettings({ type: "async-google-result", settings: disconnected, startedRevision });
      notify("Google Drive disconnected.");
    } catch (err) {
      notify(friendlyErrorMessage(err, "Google Drive could not be disconnected. Please try again."), "error");
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
      notify(friendlyErrorMessage(err, "Factory reset could not be completed. No data was intentionally removed; please try again."), "error");
    }
  };

  const testReceipt = async () => {
    const startedRevision = settingsState.revision;
    const snapshot = settings;
    try {
      const saved = await api.settings.update(snapshot);
      dispatchSettings({ type: "async-result", settings: saved, startedRevision });
      await api.printing.testReceipt();
      notify("Receipt test sent to the XP-365B.");
    } catch (err) {
      notify(friendlyErrorMessage(err, "The test receipt could not be printed. Check the printer connection and receipt mode."), "error");
    }
  };

  const testLabels = async () => {
    if (!selectedLabelProduct) {
      notify("Add or select a product before printing a test label.", "error");
      return;
    }
    const startedRevision = settingsState.revision;
    const snapshot = settings;
    try {
      const saved = await api.settings.update(snapshot);
      dispatchSettings({ type: "async-result", settings: saved, startedRevision });
      await api.printing.printBarcode(selectedLabelProduct.id, Math.max(1, labelQuantity));
      notify("Test labels sent to the XP-365B.");
    } catch (err) {
      notify(friendlyErrorMessage(err, "The test label could not be printed. Check that the XP-365B is in Label/TSPL mode."), "error");
    }
  };

  const calibrateLabels = async () => {
    if (!window.confirm("Label calibration feeds several labels while the XP-365B learns the 45x35mm gap. Continue?")) return;
    const startedRevision = settingsState.revision;
    const snapshot = settings;
    try {
      const saved = await api.settings.update(snapshot);
      dispatchSettings({ type: "async-result", settings: saved, startedRevision });
      await api.printing.calibrateLabels();
      notify("XP-365B label gap calibration completed.");
    } catch (err) {
      notify(friendlyErrorMessage(err, "Label calibration could not be completed. Check the label roll and printer mode, then try again."), "error");
    }
  };

  const installXprinterDriver = async () => {
    try {
      await api.printing.installXprinterDriver();
      notify("Xprinter DriverWizard opened. Complete the steps shown in the wizard.");
    } catch (err) {
      notify(friendlyErrorMessage(err, "The Xprinter DriverWizard could not be opened. Install the latest TruePOS release and try again."), "error");
    }
  };

  return (
    <section className="screen settings-screen">
      {user.role !== "admin" && <div className="notice">Admin permission is required to update settings.</div>}

      <div className="settings-layout">
        <div className="settings-editor">
          <SoftwareUpdatePanel state={updateState} notify={notify} />

          <div className="panel form-grid">
            <div className="screen-heading">
              <div>
                <h2>Printer connection</h2>
                <p>How TruePOS sends the bill to paper</p>
              </div>
              <button className="secondary compact" onClick={() => api.printing.listPrinters().then(setPrinters).catch((err) => {
                setPrinters([]);
                notify(friendlyErrorMessage(err, "Windows printers could not be refreshed. Check the printer connection and try again."), "error");
              })}>
                <RefreshCw size={15} /> Refresh
              </button>
            </div>
            <div className="form-section">
              <label>
                Printer mode
                <select value={settings.printerMode} onChange={(event) => {
                  const printerMode = event.target.value as "windows" | "xprinter";
                  dispatchSettings({
                    type: "edit",
                    update: (current) => ({
                      ...current,
                      printerMode,
                      receipt: printerMode === "xprinter" ? { ...current.receipt, widthMm: 80 } : current.receipt,
                      barcode: printerMode === "xprinter" ? { ...current.barcode, labelWidthMm: 45, labelHeightMm: 35 } : current.barcode
                    })
                  });
                }}>
                  <option value="windows">Windows printer driver</option>
                  <option value="xprinter">Xprinter XP-365B SDK (USB)</option>
                </select>
              </label>
              {settings.printerMode === "xprinter" ? (
                <div className="computed-field"><span>Receipt printer</span><strong>XP-365B direct USB</strong></div>
              ) : (
                <label>
                  Receipt printer
                  <select value={settings.receiptPrinter} onChange={(event) => {
                    const receiptPrinter = event.target.value;
                    dispatchSettings({ type: "edit", update: (current) => ({ ...current, receiptPrinter }) });
                  }}>
                    <option value="">Default printer</option>
                    {printers.map((printer) => (
                      <option key={printer}>{printer}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {settings.printerMode === "xprinter" && (
              <div className="notice neutral driver-setup-notice">
                <span>SDK mode connects directly to the fixed XP-365B over USB. Windows printer selection and page scaling are bypassed.</span>
                <button className="secondary compact" disabled={user.role !== "admin"} onClick={installXprinterDriver}>
                  Install / Repair Xprinter Driver
                </button>
              </div>
            )}
          </div>

          <div className="panel form-grid">
            <div className="screen-heading">
              <div>
                <h2>Receipt layout</h2>
                <p>Ordered like the printed bill — top to bottom</p>
              </div>
            </div>

            <div className="settings-subheading settings-subheading-first">
              <strong>1 · Top of bill</strong>
              <span>Logo and shop identity</span>
            </div>
            <label className="logo-upload">
              <Upload size={16} />
              <span>Upload logo image</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handleLogoUpload(event.target.files?.[0])} />
            </label>
            <div className="form-section">
              <NumberInput label="Logo width mm" value={settings.receipt.logoWidthMm} onChange={(value) => updateReceipt({ logoWidthMm: value })} min={1} />
              <NumberInput label="Logo height mm" value={settings.receipt.logoHeightMm} onChange={(value) => updateReceipt({ logoHeightMm: value })} min={1} />
              <label>
                Logo scaling {settings.receipt.logoScale}%
                <input
                  className="settings-range"
                  type="range"
                  min={25}
                  max={200}
                  value={settings.receipt.logoScale}
                  onChange={(event) => updateReceipt({ logoScale: Number(event.target.value) })}
                  style={{
                    ["--range-progress" as string]: `${((settings.receipt.logoScale - 25) / (200 - 25)) * 100}%`
                  }}
                />
              </label>
              {settings.printerMode === "xprinter" ? (
                <div className="computed-field"><span>Logo alignment</span><strong>Centered automatically</strong></div>
              ) : (
                <label>
                  Move left/right {settings.receipt.logoOffsetX}px
                  <input
                    className="settings-range"
                    type="range"
                    min={-80}
                    max={80}
                    value={settings.receipt.logoOffsetX}
                    onChange={(event) => updateReceipt({ logoOffsetX: Number(event.target.value) })}
                    style={{
                      ["--range-progress" as string]: `${((settings.receipt.logoOffsetX + 80) / 160) * 100}%`
                    }}
                  />
                </label>
              )}
              <label>
                Move down {Math.max(0, settings.receipt.logoOffsetY)}px
                <input
                  className="settings-range"
                  type="range"
                  min={0}
                  max={80}
                  value={Math.max(0, settings.receipt.logoOffsetY)}
                  onChange={(event) => updateReceipt({ logoOffsetY: Number(event.target.value) })}
                  style={{
                    ["--range-progress" as string]: `${(Math.max(0, settings.receipt.logoOffsetY) / 80) * 100}%`
                  }}
                />
              </label>
            </div>
            <button className="secondary" disabled={!settings.receipt.logoDataUrl} onClick={() => updateReceipt({ logoDataUrl: "" })}>
              <Trash2 size={16} /> Remove Logo
            </button>
            <label>
              Shop name
              <input value={settings.shopName} onChange={(event) => {
                const shopName = event.target.value;
                dispatchSettings({ type: "edit", update: (current) => ({ ...current, shopName }) });
              }} />
            </label>
            <label>
              Header text
              <textarea value={settings.receipt.header} onChange={(event) => updateReceipt({ header: event.target.value })} />
            </label>

            <div className="settings-subheading">
              <strong>2 · Bill body</strong>
              <span>Language, type, paper, and totals options</span>
            </div>
            <div className="form-section">
              <label>
                Receipt language
                <select value={settings.receipt.language} onChange={(event) => updateReceipt({ language: event.target.value as "en" | "bn" })}>
                  <option value="en">English</option>
                  <option value="bn">Bangla ready</option>
                </select>
              </label>
              {settings.printerMode === "xprinter" ? (
                <div className="computed-field"><span>Paper width</span><strong>80mm fixed</strong></div>
              ) : (
                <label>
                  Paper width
                  <select value={settings.receipt.widthMm} onChange={(event) => updateReceipt({ widthMm: Number(event.target.value) as 58 | 80 })}>
                    <option value={58}>58mm</option>
                    <option value={80}>80mm</option>
                  </select>
                </label>
              )}
              {settings.printerMode === "xprinter" ? (
                <div className="computed-field"><span>Font</span><strong>Trebuchet MS (thermal safe)</strong></div>
              ) : (
                <label>
                  Font
                  <select value={settings.receipt.fontFamily} onChange={(event) => updateReceipt({ fontFamily: event.target.value })}>
                    <option value="Trebuchet MS">Trebuchet MS (clear I / l / 1)</option>
                    <option value="Consolas">Consolas</option>
                    <option value="Arial">Arial</option>
                    <option value="Segoe UI">Segoe UI</option>
                  </select>
                </label>
              )}
              <NumberInput label="Font size" value={settings.receipt.fontSize} onChange={(value) => updateReceipt({ fontSize: value })} min={1} allowDecimal={false} />
              <NumberInput label="Padding" value={settings.receipt.padding} onChange={(value) => updateReceipt({ padding: value })} min={0} allowDecimal={false} />
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={settings.receipt.showVatBreakdown} onChange={(event) => updateReceipt({ showVatBreakdown: event.target.checked })} />
              Show VAT breakdown on receipt
            </label>

            <div className="settings-subheading">
              <strong>3 · Bottom of bill</strong>
              <span>Closing message under the totals</span>
            </div>
            <label>
              Footer text
              <textarea value={settings.receipt.footer} onChange={(event) => updateReceipt({ footer: event.target.value })} />
            </label>
          </div>

          <div className="panel form-grid">
            <div className="screen-heading">
              <div>
                <h2>Barcode Label Printer</h2>
                <p>Code128 labels for product stickers</p>
              </div>
            </div>
            {settings.printerMode === "xprinter" ? (
              <div className="computed-field"><span>Barcode printer</span><strong>XP-365B direct USB</strong></div>
            ) : (
              <label>
                Barcode printer
                <select value={settings.barcodePrinter} onChange={(event) => {
                  const barcodePrinter = event.target.value;
                  dispatchSettings({ type: "edit", update: (current) => ({ ...current, barcodePrinter }) });
                }}>
                  <option value="">Default printer</option>
                  {printers.map((printer) => (
                    <option key={printer}>{printer}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="form-section">
              <NumberInput label="Label width mm" value={settings.barcode.labelWidthMm} onChange={(value) => updateBarcode({ labelWidthMm: value })} min={1} />
              <NumberInput label="Label height mm" value={settings.barcode.labelHeightMm} onChange={(value) => updateBarcode({ labelHeightMm: value })} min={1} />
              <NumberInput label="Padding" value={settings.barcode.padding} onChange={(value) => updateBarcode({ padding: value })} min={0} allowDecimal={false} />
              <NumberInput label="Test quantity" value={labelQuantity} onChange={setLabelQuantity} min={1} allowDecimal={false} />
            </div>
            {settings.printerMode === "xprinter" && (
              <div className="form-section">
                <NumberInput label="Print speed (1-5)" value={settings.barcode.printSpeed} onChange={(value) => updateBarcode({ printSpeed: value })} min={1} max={5} allowDecimal={false} />
                <NumberInput label="Density (0-15)" value={settings.barcode.density} onChange={(value) => updateBarcode({ density: value })} min={0} max={15} allowDecimal={false} />
                <NumberInput label="Label gap mm" value={settings.barcode.gapMm} onChange={(value) => updateBarcode({ gapMm: value })} min={0} />
                <NumberInput label="Vertical offset mm" value={settings.barcode.offsetMm} onChange={(value) => updateBarcode({ offsetMm: value })} allowNegative />
              </div>
            )}
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
            <div className="backup-actions">
              <button className="secondary" disabled={user.role !== "admin" || !selectedLabelProduct} onClick={testLabels}>
                <Printer size={16} /> Print Test Labels
              </button>
              {settings.printerMode === "xprinter" && (
                <button className="secondary" disabled={user.role !== "admin"} onClick={calibrateLabels}>
                  <RefreshCw size={16} /> Calibrate Label Gap
                </button>
              )}
            </div>
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
                    onChange={(event) => {
                      const autoBackupEnabled = event.target.checked;
                      dispatchSettings({
                        type: "edit",
                        update: (current) => ({ ...current, googleDrive: { ...current.googleDrive, autoBackupEnabled } })
                      });
                    }}
                  />
                  Automatic daily backup
                </label>
                <label>
                  Backup time
                  <input
                    type="time"
                    value={settings.googleDrive.backupTime}
                    onChange={(event) => {
                      const backupTime = event.target.value;
                      dispatchSettings({
                        type: "edit",
                        update: (current) => ({ ...current, googleDrive: { ...current.googleDrive, backupTime } })
                      });
                    }}
                  />
                </label>
              </div>
              <div className="drive-status">
                <span>{settings.googleDrive.accountEmail || "No Google account connected"}</span>
                <small>{settings.googleDrive.lastBackupAt ? `Last backup: ${new Date(settings.googleDrive.lastBackupAt).toLocaleString()}` : "No Google Drive backup yet"}</small>
                {settings.googleDrive.lastBackupStatus && (
                  <small>
                    {friendlyErrorMessage(
                      settings.googleDrive.lastBackupStatus,
                      "The last Google Drive backup did not complete. Reconnect Google Drive, then try again."
                    )}
                  </small>
                )}
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
              <button className="secondary" onClick={() => api.backup.exportEncrypted().then((path) => notify(`Backup exported: ${path}`)).catch((err) => notify(friendlyErrorMessage(err, "The encrypted backup could not be exported. Choose another location and try again."), "error"))}>
                Export Encrypted Backup
              </button>
              <button className="danger" disabled={user.role !== "admin"} onClick={importBackup}>
                Import Encrypted Backup
              </button>
              <button className="secondary" onClick={() => api.backup.exportCsv("products").then((path) => notify(`CSV exported: ${path}`)).catch((err) => notify(friendlyErrorMessage(err, "The products CSV could not be exported. Choose another location and try again."), "error"))}>
                Export Products CSV
              </button>
              <button className="secondary" onClick={() => api.backup.exportCsv("inventory").then((path) => notify(`CSV exported: ${path}`)).catch((err) => notify(friendlyErrorMessage(err, "The inventory CSV could not be exported. Choose another location and try again."), "error"))}>
                Export Inventory CSV
              </button>
              <button className="secondary" onClick={() => api.backup.exportCsv("sales").then((path) => notify(`CSV exported: ${path}`)).catch((err) => notify(friendlyErrorMessage(err, "The sales CSV could not be exported. Choose another location and try again."), "error"))}>
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
          <div className="settings-title panel">
            <div>
              <h2>Settings</h2>
              <p>Updates, printers, branding, labels, and backups</p>
            </div>
            <div className="settings-title-actions">
              <button className="secondary" type="button" disabled={user.role !== "admin"} onClick={() => void resetToDefaults()}>
                <RotateCcw size={16} /> Reset to defaults
              </button>
              <button className="primary" type="button" disabled={user.role !== "admin"} onClick={() => void save()}>
                <Settings size={16} /> Save Settings
              </button>
            </div>
          </div>

          <div className="panel preview-panel">
            <div className="screen-heading">
              <div>
                <h2>Receipt Preview</h2>
                <p>Live preview of logo, paper width, font, header, footer, and VAT display</p>
              </div>
              <button className="primary compact preview-test-btn" type="button" disabled={user.role !== "admin"} onClick={() => void testReceipt()}>
                <Printer size={15} /> Test receipt
              </button>
            </div>
            <div className="receipt-preview-shell">
              <ReceiptPreview html={previewReceipt} title="Receipt layout preview" />
            </div>
          </div>

          <div className="panel preview-panel">
            <div className="screen-heading">
              <div>
                <h2>Barcode Label Preview</h2>
                <p>Approximate sticker size and visible fields</p>
              </div>
              <button className="primary compact preview-test-btn" type="button" disabled={user.role !== "admin" || !selectedLabelProduct} onClick={() => void testLabels()}>
                <Printer size={15} /> Test label
              </button>
            </div>
            <div className="barcode-preview-shell">
              <div
                className="barcode-label-preview"
                style={{
                  width: `${settings.barcode.labelWidthMm * 3.7795}px`,
                  height: `${settings.barcode.labelHeightMm * 3.7795}px`,
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
