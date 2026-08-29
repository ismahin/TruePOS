import { Package } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Sale } from "../shared/contracts";
import { calculateTotals, formatBdt } from "../shared/pos";
import { findMatchRanges } from "../shared/search";
import { XP365B_SAFE_RECEIPT_WIDTH_DOTS } from "../shared/xprinter";

export function ProductThumb({ src, alt, size = "md" }: { src?: string; alt: string; size?: "sm" | "md" | "lg" | "xl" }) {
  if (src) {
    return (
      <span className={`product-thumb product-thumb-${size}`}>
        <img src={src} alt={alt} />
      </span>
    );
  }
  return (
    <span className={`product-thumb product-thumb-${size} product-thumb-empty`} aria-hidden="true">
      <Package size={size === "xl" ? 36 : size === "lg" ? 28 : size === "md" ? 20 : 16} />
    </span>
  );
}

export function HighlightText({ text, query }: { text: string; query: string }) {
  const ranges = findMatchRanges(text, query);
  if (!query.trim() || ranges.length === 0) return <>{text}</>;

  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    parts.push(
      <mark key={`${range.start}-${range.end}-${index}`} className="search-highlight">
        {text.slice(range.start, range.end)}
      </mark>
    );
    cursor = range.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export function saleStatusMeta(status: Sale["status"]) {
  if (status === "completed") return { label: "Completed", pill: "active" as const, billLabel: "Completed bill" };
  if (status === "cancelled") return { label: "Cancelled", pill: "inactive" as const, billLabel: "Cancelled bill" };
  return { label: "Returned", pill: "inactive" as const, billLabel: "Returned bill" };
}

export function ReceiptPreview({ html, title }: { html: string; title: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [paperSize, setPaperSize] = useState({ width: XP365B_SAFE_RECEIPT_WIDTH_DOTS, height: 720 });
  const [scale, setScale] = useState(1);

  const measurePaper = useCallback(() => {
    const document = frameRef.current?.contentDocument;
    if (!document) return;
    const paper = document.querySelector<HTMLElement>(".receipt") ?? document.body;
    const bounds = paper.getBoundingClientRect();
    const width = Math.max(1, Math.ceil(bounds.width));
    const height = Math.max(1, Math.ceil(Math.max(bounds.height, paper.scrollHeight)));
    setPaperSize((current) => current.width === width && current.height === height ? current : { width, height });
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const fitPaper = () => {
      const availableWidth = Math.max(1, viewport.clientWidth);
      setScale(Math.min(1, availableWidth / paperSize.width));
    };
    fitPaper();
    const observer = new ResizeObserver(fitPaper);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [paperSize.width]);

  return (
    <div ref={viewportRef} className="receipt-preview-viewport">
      <div
        className="receipt-preview-paper"
        style={{ width: paperSize.width * scale, height: paperSize.height * scale }}
      >
        <iframe
          ref={frameRef}
          className="receipt-preview-document"
          title={title}
          sandbox="allow-same-origin"
          srcDoc={html}
          onLoad={() => window.requestAnimationFrame(measurePaper)}
          style={{
            width: paperSize.width,
            height: paperSize.height,
            transform: `scale(${scale})`
          }}
        />
      </div>
    </div>
  );
}

function formatNumericDraft(value: number, allowDecimal: boolean) {
  if (!Number.isFinite(value)) return "0";
  if (!allowDecimal) return String(Math.trunc(value));
  return String(value);
}

function sanitizeNumericDraft(raw: string, allowDecimal: boolean, allowNegative: boolean) {
  let next = raw.replace(allowDecimal ? /[^\d.-]/g : /[^\d-]/g, "");
  if (!allowNegative) next = next.replace(/-/g, "");
  else {
    const negative = next.startsWith("-");
    next = `${negative ? "-" : ""}${next.replace(/-/g, "")}`;
  }
  if (allowDecimal) {
    const dot = next.indexOf(".");
    if (dot !== -1) {
      next = `${next.slice(0, dot + 1)}${next.slice(dot + 1).replace(/\./g, "")}`;
    }
  }
  // Keep a single zero before a decimal ("0.5"), but drop leading zeros for whole numbers ("05" -> "5").
  next = next.replace(/^(-?)0+(?=\d)/, "$1");
  return next;
}

function parseNumericDraft(draft: string, fallback: number) {
  const trimmed = draft.trim();
  if (!trimmed || trimmed === "-" || trimmed === "." || trimmed === "-.") return fallback;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: number, min?: number, max?: number) {
  let next = value;
  if (min !== undefined && next < min) next = min;
  if (max !== undefined && next > max) next = max;
  return next;
}

type NumericFieldProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  allowDecimal?: boolean;
  allowNegative?: boolean;
  className?: string;
  "aria-label"?: string;
};

export function NumericField({
  value,
  onChange,
  min,
  max,
  allowDecimal = true,
  allowNegative = false,
  className,
  "aria-label": ariaLabel
}: NumericFieldProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() => formatNumericDraft(value, allowDecimal));

  useEffect(() => {
    if (!focused) setDraft(formatNumericDraft(value, allowDecimal));
  }, [value, focused, allowDecimal]);

  const commitDraft = (text: string) => {
    const parsed = clampNumber(parseNumericDraft(text, min ?? 0), min, max);
    onChange(parsed);
    setDraft(formatNumericDraft(parsed, allowDecimal));
  };

  return (
    <input
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      className={className}
      aria-label={ariaLabel}
      value={focused ? draft : formatNumericDraft(value, allowDecimal)}
      onFocus={(event) => {
        setFocused(true);
        setDraft(formatNumericDraft(value, allowDecimal));
        event.currentTarget.select();
      }}
      onBlur={() => {
        setFocused(false);
        commitDraft(draft);
      }}
      onChange={(event) => {
        const next = sanitizeNumericDraft(event.target.value, allowDecimal, allowNegative);
        setDraft(next);
        if (next === "" || next === "-" || next === "." || next === "-.") return;
        const parsed = Number(next);
        if (!Number.isFinite(parsed)) return;
        // Live-update when the typed value is already valid; clamp only on blur so mid-typing stays free.
        if ((min === undefined || parsed >= min) && (max === undefined || parsed <= max)) {
          onChange(parsed);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  allowDecimal = true,
  allowNegative = false
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  allowDecimal?: boolean;
  allowNegative?: boolean;
}) {
  return (
    <label>
      {label}
      <NumericField value={value} onChange={onChange} min={min} max={max} allowDecimal={allowDecimal} allowNegative={allowNegative} />
    </label>
  );
}

export function Totals({ totals }: { totals: ReturnType<typeof calculateTotals> }) {
  return (
    <div className="totals">
      <span>Subtotal <b>{formatBdt(totals.subtotal)}</b></span>
      {totals.itemDiscountTotal > 0 && <span>Item discount <b>{formatBdt(totals.itemDiscountTotal)}</b></span>}
      {totals.billDiscountTotal > 0 && <span>Bill discount <b>{formatBdt(totals.billDiscountTotal)}</b></span>}
      {totals.itemDiscountTotal <= 0 && totals.billDiscountTotal <= 0 && (
        <span>Discount <b>{formatBdt(totals.discountTotal)}</b></span>
      )}
      <span>VAT <b>{formatBdt(totals.vatTotal)}</b></span>
      <strong className="totals-grand">Amount due <b>{formatBdt(totals.grandTotal)}</b></strong>
    </div>
  );
}

export function Metric({ label, value, tone }: { label: string; value: string; tone?: "warning" | "danger" }) {
  return (
    <div className={`metric ${tone ? `metric-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function DataTable({ headers, rows }: { headers: string[]; rows: Array<Array<ReactNode>> }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
