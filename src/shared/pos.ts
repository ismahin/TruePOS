import type { AppSettings, CartLine, Sale, SaleTotals } from "./contracts.js";

export const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculatePaymentBalance(grandTotal: number, amountPaid: number) {
  return {
    due: money(Math.max(0, grandTotal - amountPaid)),
    change: money(Math.max(0, amountPaid - grandTotal))
  };
}

export function calculateTotals(lines: CartLine[]): SaleTotals {
  return lines.reduce<SaleTotals>(
    (totals, line) => {
      const lineSubtotal = money(line.quantity * line.unitPrice);
      const lineDiscount = money(line.quantity * line.discount);
      const taxable = Math.max(0, money(lineSubtotal - lineDiscount));
      const vat = money(taxable * (line.vatRate / 100));

      totals.subtotal = money(totals.subtotal + lineSubtotal);
      totals.discountTotal = money(totals.discountTotal + lineDiscount);
      totals.taxableTotal = money(totals.taxableTotal + taxable);
      totals.vatTotal = money(totals.vatTotal + vat);
      totals.grandTotal = money(totals.grandTotal + taxable + vat);
      return totals;
    },
    { subtotal: 0, discountTotal: 0, taxableTotal: 0, vatTotal: 0, grandTotal: 0 }
  );
}

export function validateCode128Value(value: string): string {
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > 48) {
    throw new Error("Barcode must be 1-48 characters.");
  }
  if (!/^[\x20-\x7E]+$/.test(cleaned)) {
    throw new Error("Code128 barcode can only contain printable ASCII characters.");
  }
  return cleaned;
}

export function formatBdt(value: number): string {
  return new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    minimumFractionDigits: 2
  }).format(value);
}

export function formatReceiptAmount(value: number): string {
  return new Intl.NumberFormat("en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true
  }).format(money(value));
}

function escapeReceiptHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]!);
}

export function buildReceiptHtml(
  sale: Sale,
  settings: AppSettings,
  options: { widthPx?: number; thermal?: boolean } = {}
): string {
  const receipt = settings.receipt;
  const thermal = options.thermal ?? false;
  const compact = !options.widthPx && receipt.widthMm === 58;
  const width = options.widthPx ? `${options.widthPx}px` : `${receipt.widthMm}mm`;
  const baseFontSize = thermal ? Math.max(19, Math.min(25, Math.round(receipt.fontSize * 1.7))) : Math.max(11, receipt.fontSize);
  const configuredFont = ["Arial", "Segoe UI", "Consolas"].includes(receipt.fontFamily) ? receipt.fontFamily : "Arial";
  const fontFamily = thermal ? "Verdana" : configuredFont;
  const padding = thermal ? Math.max(16, Math.min(26, Math.round(receipt.padding * 2.25))) : Math.max(6, receipt.padding);
  const metaLabelWidth = thermal ? 112 : compact ? 62 : 78;
  const quantityColumnWidth = thermal ? 52 : compact ? 30 : 40;
  const amountColumnWidth = thermal ? 128 : compact ? 72 : 90;
  const logoWidth = options.widthPx
    ? Math.max(64, Math.round(receipt.logoWidthMm * 8 * (receipt.logoScale / 100)))
    : Math.max(8, receipt.logoWidthMm * (receipt.logoScale / 100));
  const logoHeight = options.widthPx
    ? Math.max(32, Math.round(receipt.logoHeightMm * 8 * (receipt.logoScale / 100)))
    : Math.max(4, receipt.logoHeightMm * (receipt.logoScale / 100));
  const logoUnit = options.widthPx ? "px" : "mm";
  const createdAt = new Date(sale.createdAt);
  const date = createdAt.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = createdAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  const paymentBalance = calculatePaymentBalance(sale.totals.grandTotal, sale.payment.amount);
  const paymentMethod = sale.payment.method === "mobile" ? "Mobile banking" : `${sale.payment.method[0].toUpperCase()}${sale.payment.method.slice(1)}`;
  const headerLines = receipt.header.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const footerLines = receipt.footer.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const logo = receipt.logoDataUrl.startsWith("data:image/")
    ? `<div class="logo-wrap"><img class="logo" src="${escapeReceiptHtml(receipt.logoDataUrl)}" alt="" /></div>`
    : "";
  const items = sale.lines.map((item) => {
    const taxable = money((item.unitPrice - item.discount) * item.quantity);
    const itemTotal = money(taxable + taxable * (item.vatRate / 100));
    const detail = [
      `${formatReceiptAmount(item.unitPrice)} each`,
      item.discount > 0 ? `${formatReceiptAmount(item.discount)} discount` : "",
      item.vatRate > 0 ? `${formatReceiptAmount(item.vatRate)}% VAT` : ""
    ].filter(Boolean).join(" · ");
    return `<div class="item-row">
      <div class="item-description"><strong>${escapeReceiptHtml(item.name)}</strong><small>${escapeReceiptHtml(detail)}</small></div>
      <strong class="quantity">${formatReceiptAmount(item.quantity).replace(/\.00$/, "")}</strong>
      <strong class="amount">${formatReceiptAmount(itemTotal)}</strong>
    </div>`;
  }).join("");
  const summaryRow = (label: string, value: string, className = "") =>
    `<div class="summary-row ${className}"><span>${escapeReceiptHtml(label)}</span><strong>${escapeReceiptHtml(value)}</strong></div>`;

  return `<!doctype html><html><head><meta charset="UTF-8"><style>
    @page{margin:0}
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;width:${width};background:#fff;color:#000;overflow:hidden}
    body{font-family:"${fontFamily}",Tahoma,Arial,sans-serif;font-size:${baseFontSize}px;font-weight:400;line-height:1.24;letter-spacing:.05px;text-rendering:geometricPrecision;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .receipt{width:100%;padding:${padding}px}
    .logo-wrap{width:100%;display:flex;justify-content:center;align-items:center;margin:${Math.max(0, receipt.logoOffsetY * 2)}px auto ${thermal ? 16 : 8}px;transform:translateX(${thermal ? 0 : receipt.logoOffsetX}px)}
    .logo{display:block;margin:0 auto;width:${logoWidth}${logoUnit};height:${logoHeight}${logoUnit};max-width:100%;object-fit:contain;object-position:center center;filter:grayscale(1) contrast(1.4)}
    .shop{text-align:center;margin:0;font-size:1.42em;line-height:1.08;font-weight:700;overflow-wrap:anywhere}
    .header-lines,.footer-lines{text-align:center}
    .header-lines{margin-top:7px;font-weight:400}
    .header-lines div,.footer-lines div{margin:2px 0;overflow-wrap:anywhere}
    .rule{border-top:2px dashed #000;margin:13px 0}
    .meta{display:grid;gap:6px}
    .meta-row{display:grid;grid-template-columns:${metaLabelWidth}px minmax(0,1fr);column-gap:10px;align-items:start}
    .meta-row span{font-weight:400}
    .meta-row strong{text-align:right;font-weight:400;overflow-wrap:anywhere}
    .date-time{display:grid;grid-template-columns:${compact ? "1fr" : "1fr 1fr"};gap:${compact ? 6 : 14}px}
    .date-time .meta-row{grid-template-columns:auto minmax(0,1fr)}
    .table-head,.item-row{display:grid;grid-template-columns:minmax(0,1fr) ${quantityColumnWidth}px ${amountColumnWidth}px;column-gap:${compact ? 5 : 8}px;align-items:start}
    .table-head{padding:0 0 8px;border-bottom:2px solid #000;font-weight:700}
    .table-head span:nth-child(2),.quantity{text-align:center}
    .table-head span:last-child,.amount{text-align:right}
    .item-row{padding:11px 0;border-bottom:1px dashed #000}
    .item-description{min-width:0}
    .item-description strong{display:block;font-size:1.04em;font-weight:700;overflow-wrap:anywhere}
    .item-description small{display:block;margin-top:4px;font-size:.76em;font-weight:400;line-height:1.2;overflow-wrap:anywhere}
    .quantity,.amount{font-weight:700;white-space:nowrap}
    .currency-note{text-align:right;margin:7px 0 0;font-size:.74em;font-weight:400}
    .summary{margin-top:10px;padding-top:6px;border-top:3px double #000}
    .summary-row{display:flex;justify-content:space-between;gap:18px;padding:3px 0}
    .summary-row span{font-weight:400}
    .summary-row strong{text-align:right;font-weight:400;white-space:nowrap}
    .summary-row.payable{margin:5px 0;padding:8px 0;border-top:2px solid #000;border-bottom:2px solid #000;font-size:1.18em}
    .summary-row.payable span,.summary-row.payable strong{font-weight:700}
    .summary-row.due span,.summary-row.due strong{font-weight:700}
    .summary-row.method{margin-top:3px;padding-top:7px;border-top:1px dashed #000}
    .footer-lines{margin-top:14px;padding-top:12px;border-top:2px dashed #000;font-weight:400}
    .receipt-credit{display:flex;justify-content:center;align-items:baseline;gap:.35em;margin-top:7px;font-size:.68em;font-weight:400;line-height:1.15;white-space:nowrap}
    .receipt-credit .credit-by{font-size:.72em}
  </style></head><body><main class="receipt">
    ${logo}
    <h1 class="shop">${escapeReceiptHtml(settings.shopName)}</h1>
    <div class="header-lines">${headerLines.map((line) => `<div>${escapeReceiptHtml(line)}</div>`).join("")}</div>
    <div class="rule"></div>
    <section class="meta">
      <div class="meta-row"><span>Receipt</span><strong>${escapeReceiptHtml(sale.receiptNo)}</strong></div>
      <div class="date-time">
        <div class="meta-row"><span>Date</span><strong>${escapeReceiptHtml(date)}</strong></div>
        <div class="meta-row"><span>Time</span><strong>${escapeReceiptHtml(time)}</strong></div>
      </div>
      <div class="meta-row"><span>Cashier</span><strong>${escapeReceiptHtml(sale.cashierName)}</strong></div>
    </section>
    <div class="rule"></div>
    <div class="table-head"><span>Description</span><span>Qty</span><span>Amount</span></div>
    <section class="items">${items}</section>
    <div class="currency-note">All amounts in BDT</div>
    <section class="summary">
      ${summaryRow("Subtotal", formatReceiptAmount(sale.totals.subtotal))}
      ${summaryRow("Discount", formatReceiptAmount(sale.totals.discountTotal))}
      ${receipt.showVatBreakdown ? summaryRow("VAT", formatReceiptAmount(sale.totals.vatTotal)) : ""}
      ${summaryRow("Payable", formatReceiptAmount(sale.totals.grandTotal), "payable")}
      ${summaryRow("Paid", formatReceiptAmount(sale.payment.amount))}
      ${summaryRow("Due", formatReceiptAmount(paymentBalance.due), paymentBalance.due > 0 ? "due" : "")}
      ${summaryRow("Change", formatReceiptAmount(paymentBalance.change))}
      ${summaryRow("Pay mode", paymentMethod, "method")}
    </section>
    <div class="footer-lines">${footerLines.map((line) => `<div>${escapeReceiptHtml(line)}</div>`).join("")}</div>
    <div class="receipt-credit"><span>TruePOS</span><span class="credit-by">develop by</span><span>BUBT Innovation HUB</span></div>
  </main></body></html>`;
}

export function buildReceiptText(sale: Sale, settings: AppSettings): string {
  const receipt = settings.receipt;
  const lineWidth = receipt.widthMm === 80 ? 42 : 32;
  const divider = "-".repeat(lineWidth);
  const center = (value: string) => value.slice(0, lineWidth).padStart(Math.floor((lineWidth + value.length) / 2));
  const row = (left: string, right: string) => {
    const cleanLeft = left.slice(0, Math.max(0, lineWidth - right.length - 1));
    return `${cleanLeft}${" ".repeat(Math.max(1, lineWidth - cleanLeft.length - right.length))}${right}`;
  };

  const paymentBalance = calculatePaymentBalance(sale.totals.grandTotal, sale.payment.amount);
  const paymentMethod = sale.payment.method === "mobile" ? "Mobile banking" : `${sale.payment.method[0].toUpperCase()}${sale.payment.method.slice(1)}`;
  const lines = [
    center(settings.shopName),
    ...receipt.header.split("\n").filter(Boolean).map(center),
    divider,
    row("Receipt", sale.receiptNo),
    row("Date", new Date(sale.createdAt).toLocaleString("en-BD")),
    row("Cashier", sale.cashierName),
    divider,
    ...sale.lines.flatMap((item) => [
      item.name.slice(0, lineWidth),
      row(`${item.quantity} x ${formatBdt(item.unitPrice)}`, formatBdt(item.quantity * item.unitPrice))
    ]),
    divider,
    row("Subtotal", formatBdt(sale.totals.subtotal)),
    row("Discount", formatBdt(sale.totals.discountTotal)),
    ...(receipt.showVatBreakdown ? [row("VAT", formatBdt(sale.totals.vatTotal))] : []),
    row("Total", formatBdt(sale.totals.grandTotal)),
    row("Payment", paymentMethod),
    row("Paid", formatBdt(sale.payment.amount)),
    row("Due", formatBdt(paymentBalance.due)),
    row("Change", formatBdt(paymentBalance.change)),
    divider,
    ...receipt.footer.split("\n").filter(Boolean).map(center),
    center("TruePOS develop by BUBT Innovation HUB")
  ];

  return lines.join("\n");
}
