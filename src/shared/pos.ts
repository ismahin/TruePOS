import type { AppSettings, CartLine, ReceiptSettings, Sale, SaleTotals } from "./contracts.js";

export const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

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

export function buildReceiptText(sale: Sale, settings: AppSettings): string {
  const receipt = settings.receipt;
  const lineWidth = receipt.widthMm === 80 ? 42 : 32;
  const divider = "-".repeat(lineWidth);
  const center = (value: string) => value.slice(0, lineWidth).padStart(Math.floor((lineWidth + value.length) / 2));
  const row = (left: string, right: string) => {
    const cleanLeft = left.slice(0, Math.max(0, lineWidth - right.length - 1));
    return `${cleanLeft}${" ".repeat(Math.max(1, lineWidth - cleanLeft.length - right.length))}${right}`;
  };

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
    row("Paid", formatBdt(sale.payment.amount)),
    row("Change", formatBdt(Math.max(0, sale.payment.amount - sale.totals.grandTotal))),
    divider,
    ...receipt.footer.split("\n").filter(Boolean).map(center)
  ];

  return lines.join("\n");
}

export function receiptStyle(settings: ReceiptSettings): string {
  return `
    body {
      width: ${settings.widthMm}mm;
      margin: 0;
      padding: ${settings.padding}px;
      font-family: ${settings.fontFamily}, Arial, sans-serif;
      font-size: ${settings.fontSize}px;
      color: #111827;
    }
    pre { white-space: pre-wrap; margin: 0; }
    img.logo { display:block; max-width: 44mm; max-height: 22mm; margin: 0 auto 8px; object-fit: contain; }
  `;
}
