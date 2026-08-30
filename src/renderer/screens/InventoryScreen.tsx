import { AlertTriangle, Boxes, Search, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import type { InventoryMovement, Product, User } from "../../shared/contracts";
import { emitProductsChanged } from "../../shared/cart-sync";
import { formatBdt } from "../../shared/pos";
import { pickBestProductId, rankBySearchFields } from "../../shared/search";
import { api } from "../api";
import { friendlyErrorMessage, type Notify } from "../errors";
import { DataTable, HighlightText, Metric, NumberInput, ProductThumb } from "../ui";

export function InventoryScreen({ notify, user }: { notify: Notify; user: User }) {
  const canEditStock = user.role === "admin";
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [productId, setProductId] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [operation, setOperation] = useState<"stock_in" | "stock_out" | "adjustment">("stock_in");
  const [adjustMode, setAdjustMode] = useState<"increase" | "decrease" | "exact">("exact");
  const [quantity, setQuantity] = useState(0);
  const [note, setNote] = useState("");
  const [movementFilter, setMovementFilter] = useState("all");
  const [movementQuery, setMovementQuery] = useState("");
  const [movementPage, setMovementPage] = useState(1);
  const selectedProduct = products.find((product) => product.id === productId);
  const lowStockProducts = products.filter((product) => product.stock <= product.lowStockThreshold);
  const outOfStockProducts = products.filter((product) => product.stock <= 0);
  const inventoryMetrics = {
    products: products.length,
    units: products.reduce((sum, product) => sum + product.stock, 0),
    retailValue: products.reduce((sum, product) => sum + product.stock * product.price, 0),
    lowStock: lowStockProducts.length,
    outOfStock: outOfStockProducts.length
  };
  const delta =
    operation === "stock_in" ? quantity :
    operation === "stock_out" ? -quantity :
    adjustMode === "increase" ? quantity :
    adjustMode === "decrease" ? -quantity :
    selectedProduct ? quantity - selectedProduct.stock :
    0;
  const afterStock = selectedProduct ? selectedProduct.stock + delta : 0;
  const quantityLabel =
    operation === "stock_in" ? "Quantity to add" :
    operation === "stock_out" ? "Quantity to remove" :
    adjustMode === "increase" ? "Increase by" :
    adjustMode === "decrease" ? "Decrease by" :
    "Exact on-hand amount";
  const changeLabel =
    operation === "adjustment" && adjustMode === "exact" ? "Set to" : "Change";
  const normalizedMovementQuery = movementQuery.trim();
  const typedMovements =
    movementFilter === "all" ? movements : movements.filter((movement) => movement.type === movementFilter);
  const visibleMovements = normalizedMovementQuery
    ? rankBySearchFields(typedMovements, normalizedMovementQuery, (movement) => ({
        name: movement.productName,
        sku: movement.type.replace(/_/g, " "),
        barcode: String(movement.quantity),
        category: movement.note
      }))
    : typedMovements;
  const movementsPerPage = 20;
  const totalMovementPages = Math.max(1, Math.ceil(visibleMovements.length / movementsPerPage));
  const movementPageStart = (movementPage - 1) * movementsPerPage;
  const pagedMovements = visibleMovements.slice(movementPageStart, movementPageStart + movementsPerPage);

  const load = async () => {
    const found = await api.products.list({ query: productQuery, includeInactive: false });
    setProducts(found);
    setProductId((current) => pickBestProductId(found, productQuery, current));
    setMovements(await api.inventory.listMovements());
  };

  useEffect(() => {
    void load().catch((err) => notify(friendlyErrorMessage(err, "Inventory could not be loaded. Please try again."), "error"));
  }, [productQuery, notify]);

  useEffect(() => {
    setMovementPage(1);
  }, [movementFilter, movementQuery]);

  useEffect(() => {
    setMovementPage((current) => Math.min(current, totalMovementPages));
  }, [totalMovementPages]);

  useEffect(() => {
    if (operation === "adjustment" && adjustMode === "exact" && selectedProduct) {
      setQuantity(selectedProduct.stock);
    } else {
      setQuantity(0);
    }
  }, [operation, adjustMode, productId]);

  async function saveMovement(event: FormEvent) {
    event.preventDefault();
    if (!canEditStock) {
      notify("Admin permission is required to change inventory.", "error");
      return;
    }
    if (!selectedProduct) {
      notify("Select a product before saving a stock movement.", "error");
      return;
    }
    const needsPositiveQty = operation !== "adjustment" || adjustMode !== "exact";
    if (needsPositiveQty && quantity <= 0) {
      notify("Enter a quantity greater than zero before saving the stock movement.", "error");
      return;
    }
    if (operation === "adjustment" && adjustMode === "exact" && quantity < 0) {
      notify("Exact on-hand amount cannot be negative.", "error");
      return;
    }
    if (delta === 0) {
      notify(
        operation === "adjustment" && adjustMode === "exact"
          ? "Stock is already that amount. Enter a different exact quantity if you need to change it."
          : "Enter a quantity greater than zero before saving the stock movement.",
        "error"
      );
      return;
    }
    if (afterStock < 0) {
      notify("This movement would make the stock negative. Reduce the quantity and try again.", "error");
      return;
    }
    const defaultReason =
      operation === "stock_in" ? "Stock in" :
      operation === "stock_out" ? "Stock out" :
      adjustMode === "increase" ? `Adjustment increase by ${quantity}` :
      adjustMode === "decrease" ? `Adjustment decrease by ${quantity}` :
      `Adjustment set to ${quantity}`;
    const reason = note.trim() || defaultReason;
    try {
      await api.inventory.adjust(selectedProduct.id, delta, reason, operation);
      notify("Inventory updated.");
      emitProductsChanged();
      setNote("");
      setMovementPage(1);
      if (operation === "adjustment" && adjustMode === "exact") {
        setQuantity(afterStock);
      } else {
        setQuantity(0);
      }
      await load();
    } catch (err) {
      notify(friendlyErrorMessage(err, "Inventory could not be updated. Check the entered information and try again."), "error");
    }
  }

  return (
    <section className="screen inventory-screen">
      <div className="product-metrics">
        <Metric label="Products" value={String(inventoryMetrics.products)} />
        <Metric label="Units on hand" value={String(inventoryMetrics.units)} />
        <Metric label="Retail value" value={formatBdt(inventoryMetrics.retailValue)} />
        <Metric
          label="Low stock"
          value={String(inventoryMetrics.lowStock)}
          tone={inventoryMetrics.lowStock > 0 ? "warning" : undefined}
        />
        <Metric
          label="Out of stock"
          value={String(inventoryMetrics.outOfStock)}
          tone={inventoryMetrics.outOfStock > 0 ? "danger" : undefined}
        />
      </div>
      <div className="inventory-grid">
        <form className="panel stock-entry-panel" onSubmit={saveMovement}>
          <div className="screen-heading">
            <div>
              <h2>Stock Control</h2>
              <p>Receive, remove, or set the correct on-hand quantity</p>
            </div>
            <Boxes />
          </div>
          {!canEditStock && <div className="notice">Admin permission is required to save stock movements. You can still view stock and history.</div>}
          <div className="stock-op-group">
            <div className="stock-op-heading">
              <strong>1. Choose operation</strong>
              <span>Pick what kind of stock change you are making</span>
            </div>
            <div className="inventory-modes" role="group" aria-label="Stock operation">
              <button
                type="button"
                className={`mode mode-in ${operation === "stock_in" ? "active" : ""}`}
                onClick={() => setOperation("stock_in")}
                disabled={!canEditStock}
              >
                Stock In
              </button>
              <button
                type="button"
                className={`mode mode-out ${operation === "stock_out" ? "active" : ""}`}
                onClick={() => setOperation("stock_out")}
                disabled={!canEditStock}
              >
                Stock Out
              </button>
              <button
                type="button"
                className={`mode mode-adjust ${operation === "adjustment" ? "active" : ""}`}
                onClick={() => setOperation("adjustment")}
                disabled={!canEditStock}
              >
                Adjustment
              </button>
            </div>
          </div>
          {operation === "adjustment" && (
            <div className="stock-adjust-group">
              <div className="stock-op-heading">
                <strong>2. How to adjust</strong>
                <span>Increase, decrease, or set the exact shelf count</span>
              </div>
              <div className="inventory-modes adjust-modes" role="group" aria-label="Adjustment type">
                <button
                  type="button"
                  className={`mode mode-in ${adjustMode === "increase" ? "active" : ""}`}
                  onClick={() => setAdjustMode("increase")}
                  disabled={!canEditStock}
                >
                  Increase
                </button>
                <button
                  type="button"
                  className={`mode mode-out ${adjustMode === "decrease" ? "active" : ""}`}
                  onClick={() => setAdjustMode("decrease")}
                  disabled={!canEditStock}
                >
                  Decrease
                </button>
                <button
                  type="button"
                  className={`mode mode-exact ${adjustMode === "exact" ? "active" : ""}`}
                  onClick={() => setAdjustMode("exact")}
                  disabled={!canEditStock}
                >
                  Exact amount
                </button>
              </div>
              <p className="stock-adjust-hint">
                {adjustMode === "increase" && "Add to current stock (for example +5)."}
                {adjustMode === "decrease" && "Remove from current stock (for example −3)."}
                {adjustMode === "exact" && "Set stock to the real counted amount on the shelf."}
              </p>
            </div>
          )}
          <label>
            Scan barcode or search product
            <input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Barcode, SKU, or product name" />
          </label>
          <label>
            Product
            <select value={productId} onChange={(event) => setProductId(event.target.value)}>
              {products.map((product) => (
                <option key={product.id} value={product.id}>{product.name} - {product.sku}</option>
              ))}
            </select>
          </label>
          {selectedProduct && (
            <div className={`stock-summary ${delta > 0 ? "is-up" : delta < 0 ? "is-down" : ""}`}>
              <div><span>Current</span><strong>{selectedProduct.stock}</strong></div>
              <div className="stock-summary-change">
                <span>{changeLabel}</span>
                <strong>{operation === "adjustment" && adjustMode === "exact" ? quantity : delta}</strong>
              </div>
              <div><span>After</span><strong>{afterStock}</strong></div>
            </div>
          )}
          <div className="form-section stock-entry-fields">
            <NumberInput label={quantityLabel} value={quantity} onChange={setQuantity} min={0} allowDecimal={false} />
            <input placeholder="Reason / reference" value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <button
            className={`primary wide stock-save ${
              operation === "stock_in" || (operation === "adjustment" && adjustMode === "increase")
                ? "tone-in"
                : operation === "stock_out" || (operation === "adjustment" && adjustMode === "decrease")
                  ? "tone-out"
                  : "tone-exact"
            }`}
            type="submit"
            disabled={!canEditStock || !selectedProduct || afterStock < 0 || delta === 0}
          >
            Save Stock Movement
          </button>
        </form>
        <div className={`panel reorder-panel ${lowStockProducts.length > 0 ? "has-alerts" : ""}`}>
          <div className="screen-heading">
            <div>
              <h2>Needs restock</h2>
              <p>At or below the alert level</p>
            </div>
            <span className={`status-pill ${lowStockProducts.length > 0 ? (outOfStockProducts.length > 0 ? "danger" : "warning") : "active"}`}>
              {lowStockProducts.length}
            </span>
          </div>
          {lowStockProducts.length > 0 && (
            <div className={`stock-alert-banner ${outOfStockProducts.length > 0 ? "is-danger" : "is-warning"}`}>
              <AlertTriangle size={18} />
              <div>
                <strong>
                  {outOfStockProducts.length > 0
                    ? `${outOfStockProducts.length} out of stock · ${lowStockProducts.length} need reorder`
                    : `${lowStockProducts.length} product${lowStockProducts.length === 1 ? "" : "s"} below alert level`}
                </strong>
                <span>Restock these items before they block sales.</span>
              </div>
            </div>
          )}
          <div className="reorder-list">
            {lowStockProducts.length === 0 && <div className="empty-state">No low-stock products.</div>}
            {lowStockProducts.slice(0, 8).map((product) => {
              const isOut = product.stock <= 0;
              return (
                <div className={`reorder-row ${isOut ? "is-out" : "is-low"}`} key={product.id}>
                  <div className="reorder-product">
                    <ProductThumb src={product.imageDataUrl} alt={product.name} size="sm" />
                    <div>
                      <strong>{product.name}</strong>
                      <small>{product.sku} - Alert at {product.lowStockThreshold}</small>
                    </div>
                  </div>
                  <div className="reorder-stock">
                    <span className={`status-pill ${isOut ? "danger" : "warning"}`}>{isOut ? "Out" : "Low"}</span>
                    <b>{product.stock}</b>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="screen-heading">
          <div>
            <h2>Stock Overview</h2>
            <p>Real-time on-hand quantity and inventory value</p>
          </div>
          <input className="panel-search" placeholder="Filter products" value={productQuery} onChange={(event) => setProductQuery(event.target.value)} />
        </div>
        <div className="inventory-table">
          <div className="inventory-row inventory-row-header">
            <span>Product</span><span>On hand</span><span>Alert</span><span>Retail value</span><span>Status</span>
          </div>
          {products.map((product) => {
            const isOut = product.stock <= 0;
            const isLow = !isOut && product.stock <= product.lowStockThreshold;
            return (
              <div className={`inventory-row ${isOut ? "is-out" : isLow ? "is-low" : ""}`} key={product.id}>
                <div className="inventory-product">
                  <ProductThumb src={product.imageDataUrl} alt={product.name} size="sm" />
                  <div>
                    <strong><HighlightText text={product.name} query={productQuery} /></strong>
                    <small>
                      <HighlightText text={product.sku} query={productQuery} /> - <HighlightText text={product.category || "Uncategorized"} query={productQuery} />
                    </small>
                  </div>
                </div>
                <strong className={isOut || isLow ? "stock-alert-qty" : undefined}>{product.stock}</strong>
                <span>{product.lowStockThreshold}</span>
                <strong>{formatBdt(product.stock * product.price)}</strong>
                <span className={`status-pill ${isOut ? "danger" : isLow ? "warning" : "active"}`}>
                  {isOut ? "Out" : isLow ? "Low" : "OK"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="panel">
        <div className="screen-heading">
          <div>
            <h2>Movement History</h2>
            <p>Audit trail for receipts, removals, adjustments, sales, and returns</p>
          </div>
          <div className="movement-history-filters">
            <div className="movement-search">
              <Search size={17} />
              <input
                value={movementQuery}
                onChange={(event) => setMovementQuery(event.target.value)}
                placeholder="Search product, quantity, or note"
                aria-label="Search movement history"
              />
              {movementQuery && <button type="button" className="icon-button" onClick={() => setMovementQuery("")} aria-label="Clear movement search"><X size={17} /></button>}
            </div>
            <select value={movementFilter} onChange={(event) => setMovementFilter(event.target.value)}>
              <option value="all">All movements</option>
              <option value="stock_in">Stock in</option>
              <option value="stock_out">Stock out</option>
              <option value="adjustment">Adjustment</option>
              <option value="sale">Sales</option>
              <option value="return">Returns</option>
            </select>
          </div>
        </div>
        <DataTable
          headers={["Date", "Product", "Type", "Qty", "Note"]}
          rows={pagedMovements.map((movement) => [
            new Date(movement.createdAt).toLocaleString(),
            <HighlightText key={`${movement.id}-name`} text={movement.productName} query={movementQuery} />,
            movement.type === "stock_in" ? "Stock in" :
              movement.type === "stock_out" ? "Stock out" :
              movement.type === "adjustment" ? "Adjustment" :
              movement.type === "sale" ? "Sale" :
              movement.type === "return" ? "Return" :
              movement.type,
            movement.quantity,
            <HighlightText key={`${movement.id}-note`} text={movement.note} query={movementQuery} />
          ])}
        />
        {visibleMovements.length === 0 && <div className="empty-state">No inventory movements match this filter.</div>}
        {visibleMovements.length > 0 && (
          <div className="pagination-bar">
            <span>
              Showing {movementPageStart + 1}-{Math.min(movementPageStart + movementsPerPage, visibleMovements.length)} of {visibleMovements.length} movements
            </span>
            <div className="pagination-actions">
              <button type="button" className="secondary compact" disabled={movementPage === 1} onClick={() => setMovementPage((page) => Math.max(1, page - 1))}>
                Previous
              </button>
              <strong>Page {movementPage} of {totalMovementPages}</strong>
              <button type="button" className="secondary compact" disabled={movementPage === totalMovementPages} onClick={() => setMovementPage((page) => Math.min(totalMovementPages, page + 1))}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
