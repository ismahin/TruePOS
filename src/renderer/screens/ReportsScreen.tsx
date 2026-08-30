import { Printer, Receipt, RotateCcw, Search, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  InventoryValueReport,
  ProductSalesReport,
  Sale,
  SalesReport,
  SalesTrendGranularity,
  User
} from "../../shared/contracts";
import { emitProductsChanged } from "../../shared/cart-sync";
import { formatBdt } from "../../shared/pos";
import { api } from "../api";
import { friendlyErrorMessage, type Notify } from "../errors";
import { DataTable, HighlightText, Metric, ProductThumb, ReceiptPreview, saleStatusMeta } from "../ui";

export function ReportsScreen({ notify, user }: { notify: Notify; user: User }) {
  const today = toDateInput(new Date());
  const [dateFrom, setDateFrom] = useState(toDateInput(addDays(new Date(), -6)));
  const [dateTo, setDateTo] = useState(today);
  const [trendReports, setTrendReports] = useState<SalesReport[]>([]);
  const [trendGranularity, setTrendGranularity] = useState<SalesTrendGranularity>("day");
  const [rangeDayCount, setRangeDayCount] = useState(7);
  const [rangeReport, setRangeReport] = useState<SalesReport | null>(null);
  const [topProducts, setTopProducts] = useState<ProductSalesReport[]>([]);
  const [inventoryValue, setInventoryValue] = useState<InventoryValueReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [receiptQuery, setReceiptQuery] = useState("");
  const [receiptResults, setReceiptResults] = useState<Sale[]>([]);
  const [receiptSearchComplete, setReceiptSearchComplete] = useState(false);
  const [receiptSearching, setReceiptSearching] = useState(false);
  const [billPreview, setBillPreview] = useState<{ sale: Sale; html: string } | null>(null);
  const [reprintingSaleId, setReprintingSaleId] = useState("");
  const [reversingSaleId, setReversingSaleId] = useState("");
  const totals = rangeReport ?? emptyReport();
  const bestProduct = topProducts[0];
  const inventoryProfit = inventoryValue ? inventoryValue.retailValue - inventoryValue.costValue : 0;
  const inventoryMargin = inventoryValue?.retailValue ? (inventoryProfit / inventoryValue.retailValue) * 100 : 0;

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      api.reports.getSalesTrend(dateFrom, dateTo),
      api.reports.getSalesSummary(dateFrom, dateTo),
      api.reports.getProductSales(dateFrom, dateTo),
      api.reports.getInventoryValue()
    ])
      .then(([trend, summary, products, inventory]) => {
        if (!active) return;
        setTrendReports(trend.points);
        setTrendGranularity(trend.granularity);
        setRangeDayCount(trend.dayCount);
        setRangeReport(summary);
        setTopProducts(products);
        setInventoryValue(inventory);
      })
      .catch((err) => {
        if (active) notify(friendlyErrorMessage(err, "Reports could not be loaded. Please try again."), "warning");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dateFrom, dateTo, notify]);

  const setPreset = (days: number) => {
    setDateTo(today);
    setDateFrom(toDateInput(addDays(new Date(), -(days - 1))));
  };

  const searchReceipts = async (rawQuery = receiptQuery) => {
    const query = rawQuery.trim();
    if (!query) {
      setReceiptResults([]);
      setReceiptSearchComplete(false);
      return;
    }
    setReceiptSearching(true);
    try {
      setReceiptResults(await api.sales.searchReceipts(query));
      setReceiptSearchComplete(true);
    } catch (err) {
      setReceiptResults([]);
      setReceiptSearchComplete(false);
      notify(friendlyErrorMessage(err, "Bills could not be searched. Try receipt number, customer name, or phone."), "error");
    } finally {
      setReceiptSearching(false);
    }
  };

  useEffect(() => {
    const query = receiptQuery.trim();
    if (!query) {
      setReceiptResults([]);
      setReceiptSearchComplete(false);
      return;
    }
    const timer = window.setTimeout(() => {
      void searchReceipts(query);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [receiptQuery]);

  const viewBill = async (sale: Sale) => {
    try {
      const html = await api.sales.previewSavedReceipt(sale.id);
      setBillPreview({ sale, html });
    } catch (err) {
      notify(friendlyErrorMessage(err, "The saved bill preview could not be opened. Please try again."), "error");
    }
  };

  const reprintBill = async (sale: Sale) => {
    if (reprintingSaleId) return;
    setReprintingSaleId(sale.id);
    try {
      await api.printing.printReceipt(sale.id);
      notify(`Receipt ${sale.receiptNo} sent to the printer.`);
    } catch (err) {
      notify(friendlyErrorMessage(err, "The bill could not be reprinted. Check the printer connection and receipt mode, then try again."), "error");
    } finally {
      setReprintingSaleId("");
    }
  };

  const reverseBill = async (sale: Sale, mode: "return" | "cancel") => {
    if (sale.status !== "completed" || reversingSaleId) return;
    if (mode === "return" && user.role !== "admin") {
      notify("Admin permission is required to return a sale.", "error");
      return;
    }
    if (mode === "cancel" && user.role !== "admin" && sale.cashierId !== user.id) {
      notify("You can only cancel your own sale.", "error");
      return;
    }
    const confirmed = window.confirm(
      mode === "return"
        ? `Return sale ${sale.receiptNo}? Stock will be restored and the bill marked returned.`
        : `Cancel sale ${sale.receiptNo}? Stock will be restored and the bill marked cancelled.`
    );
    if (!confirmed) return;
    setReversingSaleId(sale.id);
    try {
      const updated = mode === "return" ? await api.sales.returnSale(sale.id) : await api.sales.cancelSale(sale.id);
      setReceiptResults((current) => current.map((item) => (item.id === updated.id ? { ...item, status: updated.status } : item)));
      if (billPreview?.sale.id === updated.id) {
        setBillPreview({ sale: { ...billPreview.sale, status: updated.status }, html: billPreview.html });
      }
      emitProductsChanged();
      notify(mode === "return" ? `Sale ${sale.receiptNo} returned. Stock restored.` : `Sale ${sale.receiptNo} cancelled. Stock restored.`);
    } catch (err) {
      notify(friendlyErrorMessage(err, mode === "return" ? "The sale could not be returned." : "The sale could not be cancelled."), "error");
    } finally {
      setReversingSaleId("");
    }
  };

  return (
    <section className="screen reports-screen">
      <div className="panel report-hero">
        <div className="screen-heading">
          <div>
            <h2>Sales and analytics</h2>
            <p>Revenue, profit, products, VAT, and stock health</p>
          </div>
          <div className="report-presets">
            <button className="secondary compact" onClick={() => setPreset(1)}>Today</button>
            <button className="secondary compact" onClick={() => setPreset(7)}>7 days</button>
            <button className="secondary compact" onClick={() => setPreset(30)}>30 days</button>
            <button className="secondary compact" onClick={() => setPreset(90)}>90 days</button>
            <button className="secondary compact" onClick={() => setPreset(365)}>1 year</button>
          </div>
        </div>
        <div className="report-filters">
          <label>
            From
            <input type="date" value={dateFrom} max={dateTo} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={dateTo} min={dateFrom} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          <div className="range-note">
            <span>
              {rangeDayCount} day{rangeDayCount === 1 ? "" : "s"} · {trendReports.length} {trendGranularity}
              {trendReports.length === 1 ? "" : "s"}
            </span>
            <small>{trendGranularityNote(trendGranularity, rangeDayCount)}</small>
          </div>
        </div>
        {loading && <div className="notice neutral">Loading report data...</div>}
        <div className="metric-grid report-metrics">
          <Metric label="Net sales" value={formatBdt(totals.grandTotal)} />
          <Metric label="Profit estimate" value={formatBdt(totals.profitEstimate)} />
          <Metric label="Transactions" value={String(totals.salesCount)} />
          <Metric label="Average sale" value={formatBdt(totals.salesCount ? totals.grandTotal / totals.salesCount : 0)} />
          <Metric label="VAT collected" value={formatBdt(totals.vatTotal)} />
          <Metric label="Discounts" value={formatBdt(totals.discountTotal)} />
        </div>
      </div>

      <div className="panel receipt-lookup-panel">
        <div className="screen-heading">
          <div>
            <h2>Find a bill</h2>
            <p>Receipt number, customer name, or phone</p>
          </div>
          <Receipt />
        </div>
        <div className="receipt-search-bar">
          <div className="movement-search receipt-live-search">
            <Search size={17} />
            <input
              value={receiptQuery}
              onChange={(event) => setReceiptQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void searchReceipts();
                }
              }}
              placeholder="Receipt, customer name, or phone"
              aria-label="Search bills by receipt, name, or phone"
            />
            {receiptQuery && (
              <button type="button" className="icon-button" onClick={() => setReceiptQuery("")} aria-label="Clear bill search">
                <X size={17} />
              </button>
            )}
          </div>
          <button type="button" className="primary" onClick={() => void searchReceipts()} disabled={receiptSearching || !receiptQuery.trim()}>
            <Search size={17} /> {receiptSearching ? "Searching..." : "Search Bill"}
          </button>
        </div>
        {receiptSearchComplete && receiptResults.length === 0 && (
          <div className="empty-state">No bill matched that receipt number, name, or phone.</div>
        )}
        {receiptResults.length > 0 && (
          <div className="receipt-search-results">
            <div className="receipt-result-row receipt-result-header">
              <span>Receipt</span><span>Customer</span><span>Date</span><span>Cashier</span><span>Total</span><span>Status</span><span>Action</span>
            </div>
            {receiptResults.map((sale) => {
              const customer = [sale.customerName, sale.customerPhone].filter(Boolean).join(" · ") || "Walk-in";
              return (
                <div className="receipt-result-row has-customer" key={sale.id}>
                  <strong><HighlightText text={sale.receiptNo} query={receiptQuery} /></strong>
                  <span>
                    <HighlightText text={customer} query={receiptQuery} />
                  </span>
                  <span>{new Date(sale.createdAt).toLocaleString()}</span>
                  <span><HighlightText text={sale.cashierName} query={receiptQuery} /></span>
                  <strong>{formatBdt(sale.totals.grandTotal)}</strong>
                  {(() => { const meta = saleStatusMeta(sale.status); return <span className={`status-pill ${meta.pill}`}>{meta.label}</span>; })()}
                  <div className="row-actions receipt-actions">
                    <button type="button" className="secondary compact" onClick={() => void viewBill(sale)}>
                      <Receipt size={15} /> View Bill
                    </button>
                    <button type="button" className="secondary compact" disabled={Boolean(reprintingSaleId)} onClick={() => void reprintBill(sale)}>
                      <Printer size={15} /> {reprintingSaleId === sale.id ? "Printing..." : "Reprint"}
                    </button>
                    {sale.status === "completed" && user.role === "admin" && (
                      <button
                        type="button"
                        className="danger compact"
                        disabled={Boolean(reversingSaleId)}
                        onClick={() => void reverseBill(sale, "return")}
                      >
                        <Undo2 size={15} /> {reversingSaleId === sale.id ? "Working..." : "Return"}
                      </button>
                    )}
                    {sale.status === "completed" && (user.role === "admin" || sale.cashierId === user.id) && (
                      <button
                        type="button"
                        className="ghost compact"
                        disabled={Boolean(reversingSaleId)}
                        onClick={() => void reverseBill(sale, "cancel")}
                      >
                        <RotateCcw size={15} /> Cancel
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="report-grid">
        <div className="panel chart-panel">
          <div className="screen-heading">
            <div>
              <h2>Sales Trend</h2>
              <p>{trendSubtitle(trendGranularity)}</p>
            </div>
            <strong>{formatBdt(totals.grandTotal)}</strong>
          </div>
          <TrendChart reports={trendReports} granularity={trendGranularity} />
        </div>
        <div className="panel chart-panel">
          <div className="screen-heading">
            <div>
              <h2>Profit Snapshot</h2>
              <p>Estimated gross profit against net sales</p>
            </div>
            <span className="status-pill active">{formatPercent(totals.grandTotal ? (totals.profitEstimate / totals.grandTotal) * 100 : 0)}</span>
          </div>
          <ProgressChart
            rows={[
              { label: "Net sales", value: totals.grandTotal, color: "var(--brand-blue)" },
              { label: "Profit", value: totals.profitEstimate, color: "var(--brand-light-blue)" },
              { label: "VAT", value: totals.vatTotal, color: "#c2410c" },
              { label: "Discount", value: totals.discountTotal, color: "#be123c" }
            ]}
          />
        </div>
      </div>

      <div className="report-grid">
        <div className="panel chart-panel">
          <div className="screen-heading">
            <div>
              <h2>Top Products</h2>
              <p>Revenue leaders for selected range</p>
            </div>
            {bestProduct && <strong>{bestProduct.name}</strong>}
          </div>
          <ProductRevenueChart products={topProducts.slice(0, 12)} />
        </div>
        <div className="panel chart-panel">
          <div className="screen-heading">
            <div>
              <h2>Inventory Health</h2>
              <p>Stock value, margin, and low-stock pressure</p>
            </div>
            {inventoryValue && <span className="status-pill warning">{inventoryValue.lowStockCount} low</span>}
          </div>
          {inventoryValue ? (
            <>
              <div className="inventory-value-cards">
                <Metric label="Products" value={String(inventoryValue.products)} />
                <Metric label="Units" value={String(inventoryValue.units)} />
                <Metric label="Cost value" value={formatBdt(inventoryValue.costValue)} />
                <Metric label="Retail value" value={formatBdt(inventoryValue.retailValue)} />
              </div>
              <ProgressChart
                rows={[
                  { label: "Retail value", value: inventoryValue.retailValue, color: "var(--brand-blue)" },
                  { label: "Cost value", value: inventoryValue.costValue, color: "#475467" },
                  { label: "Stock margin", value: Math.max(0, inventoryProfit), color: "var(--brand-light-blue)" },
                  { label: "Low stock items", value: inventoryValue.lowStockCount, color: "#c2410c" }
                ]}
              />
              <div className="report-insight">
                <strong>{formatPercent(inventoryMargin)}</strong>
                <span>estimated margin in current inventory value</span>
              </div>
            </>
          ) : (
            <div className="empty-state">Inventory value is not available.</div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="screen-heading">
          <div>
            <h2>Product Sales Detail</h2>
            <p>Quantity and revenue by product</p>
          </div>
        </div>
        <DataTable
          headers={["Product", "SKU", "Qty sold", "Revenue", "Share"]}
          rows={topProducts.map((product) => [
            product.name,
            product.sku,
            product.quantity,
            formatBdt(product.revenue),
            formatPercent(totals.grandTotal ? (product.revenue / totals.grandTotal) * 100 : 0)
          ])}
        />
      </div>
      {billPreview && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="saved-bill-preview-title">
          <div className="invoice-modal">
            <div className="modal-heading">
              <div>
                <h2 id="saved-bill-preview-title">Bill Preview</h2>
                <p>
                  {billPreview.sale.receiptNo}
                  {" · "}
                  {new Date(billPreview.sale.createdAt).toLocaleString()}
                  {(billPreview.sale.customerName || billPreview.sale.customerPhone) && (
                    <>
                      {" · "}
                      {[billPreview.sale.customerName, billPreview.sale.customerPhone].filter(Boolean).join(" · ")}
                    </>
                  )}
                </p>
              </div>
              <button className="icon-button" type="button" onClick={() => setBillPreview(null)} aria-label="Close bill preview"><X size={20} /></button>
            </div>
            <div className="invoice-preview-area">
              <ReceiptPreview html={billPreview.html} title={`Bill ${billPreview.sale.receiptNo}`} />
            </div>
            <div className="modal-actions">
              {(() => { const meta = saleStatusMeta(billPreview.sale.status); return <span className={`status-pill ${meta.pill}`}>{meta.billLabel}</span>; })()}
              <button type="button" className="secondary" disabled={Boolean(reprintingSaleId)} onClick={() => void reprintBill(billPreview.sale)}>
                <Printer size={16} /> {reprintingSaleId === billPreview.sale.id ? "Printing..." : "Reprint"}
              </button>
              <button type="button" className="primary" onClick={() => setBillPreview(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function TrendChart({
  reports,
  granularity
}: {
  reports: SalesReport[];
  granularity: SalesTrendGranularity;
}) {
  const max = Math.max(...reports.map((report) => report.grandTotal), 0);
  if (reports.length === 0 || max === 0) return <div className="empty-state">No sales found for this date range.</div>;

  const dense = reports.length > 14;
  const mid = max / 2;
  const yTicks = [
    { label: compactBdt(max), pct: 100 },
    { label: compactBdt(mid), pct: 50 },
    { label: "0", pct: 0 }
  ];

  return (
    <div
      className={`trend-chart${dense ? " is-dense" : ""}`}
      role="img"
      aria-label={`${granularity} net sales trend`}
      style={{ ["--trend-days" as string]: String(reports.length) }}
    >
      <div className="trend-y-axis" aria-hidden="true">
        {yTicks.map((tick) => (
          <span key={tick.pct} className="trend-y-tick" style={{ bottom: `${tick.pct}%` }}>
            {tick.label}
          </span>
        ))}
      </div>
      <div className="trend-main">
        <div className="trend-plot">
          <div className="trend-grid" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          {reports.map((report) => {
            const heightPct = (report.grandTotal / max) * 100;
            const hasSales = report.grandTotal > 0;
            return (
              <div
                className={`trend-day${hasSales ? "" : " is-empty"}`}
                key={report.date}
                title={`${trendTooltipLabel(report.date, granularity)} · ${formatBdt(report.grandTotal)} · ${report.salesCount} sale${report.salesCount === 1 ? "" : "s"}`}
              >
                {hasSales && <span className="trend-value">{compactBdt(report.grandTotal)}</span>}
                <div className="trend-bar-track">
                  {hasSales && <span className="trend-bar" style={{ height: `${Math.max(heightPct, dense ? 4 : 3)}%` }} />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="trend-labels">
          {reports.map((report) => (
            <div className={`trend-label${report.grandTotal > 0 ? "" : " is-empty"}`} key={`${report.date}-label`}>
              <small>{trendAxisLabel(report.date, granularity, dense)}</small>
              {!dense && <b>{report.salesCount} tx</b>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProductRevenueChart({ products }: { products: ProductSalesReport[] }) {
  const max = Math.max(...products.map((product) => product.revenue), 0);
  if (products.length === 0 || max === 0) return <div className="empty-state">No product sales found for this range.</div>;
  return (
    <div className="bar-list">
      {products.map((product) => (
        <div className="bar-row" key={product.productId}>
          <div className="bar-row-product">
            <ProductThumb src={product.imageDataUrl} alt={product.name} size="sm" />
            <div>
              <strong>{product.name}</strong>
              <small>{product.quantity} sold · {product.sku}</small>
            </div>
          </div>
          <div className="bar-track">
            <span style={{ width: `${Math.max(4, (product.revenue / max) * 100)}%` }} />
          </div>
          <b>{formatBdt(product.revenue)}</b>
        </div>
      ))}
    </div>
  );
}

function ProgressChart({ rows }: { rows: Array<{ label: string; value: number; color: string }> }) {
  const max = Math.max(...rows.map((row) => row.value), 0);
  if (max === 0) return <div className="empty-state">No values to graph yet.</div>;
  return (
    <div className="progress-chart">
      {rows.map((row) => (
        <div className="progress-row" key={row.label}>
          <div>
            <span>{row.label}</span>
            <strong>{row.label.includes("items") ? row.value : formatBdt(row.value)}</strong>
          </div>
          <div className="bar-track">
            <span style={{ width: `${Math.max(4, (row.value / max) * 100)}%`, background: row.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function emptyReport(): SalesReport {
  return { date: "range", salesCount: 0, subtotal: 0, discountTotal: 0, vatTotal: 0, grandTotal: 0, profitEstimate: 0 };
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shortDate(date: string) {
  const [, month, day] = date.split("-");
  return `${month}/${day}`;
}

function shortDay(date: string) {
  const [, , day] = date.split("-");
  return String(Number(day) || day);
}

function shortMonth(date: string) {
  const [year, month] = date.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const index = Number(month) - 1;
  return `${names[index] ?? month} ${String(year).slice(-2)}`;
}

function trendAxisLabel(date: string, granularity: SalesTrendGranularity, dense: boolean) {
  if (granularity === "year") return date;
  if (granularity === "month") return dense ? (date.split("-")[1] ?? date) : shortMonth(date.includes("-") && date.length === 7 ? `${date}-01` : date);
  if (granularity === "week") return dense ? shortDay(date) : shortDate(date);
  return dense ? shortDay(date) : shortDate(date);
}

function trendTooltipLabel(date: string, granularity: SalesTrendGranularity) {
  if (granularity === "year") return date;
  if (granularity === "month") return shortMonth(date.includes("-") && date.length === 7 ? `${date}-01` : date);
  return shortDate(date);
}

function trendSubtitle(granularity: SalesTrendGranularity) {
  if (granularity === "week") return "Weekly net sales and transaction count";
  if (granularity === "month") return "Monthly net sales and transaction count";
  if (granularity === "year") return "Yearly net sales and transaction count";
  return "Daily net sales and transaction count";
}

function trendGranularityNote(granularity: SalesTrendGranularity, dayCount: number) {
  if (granularity === "day") return "Daily bars for the full selected range.";
  if (granularity === "week") return `Grouped by week so all ${dayCount} days fit on screen.`;
  if (granularity === "month") return `Grouped by month so all ${dayCount} days fit on screen.`;
  return `Grouped by year so all ${dayCount} days fit on screen.`;
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function compactBdt(value: number) {
  const amount = Math.max(0, Number(value) || 0);
  if (amount >= 100_000) return `${(amount / 1000).toFixed(0)}k`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(amount >= 10_000 ? 0 : 1)}k`;
  if (amount >= 100) return amount.toFixed(0);
  return amount.toFixed(amount % 1 === 0 ? 0 : 2);
}
