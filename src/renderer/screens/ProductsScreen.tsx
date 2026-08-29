import { Download, Edit3, ImagePlus, Plus, Printer, Trash2, Upload, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Product, ProductInput, User } from "../../shared/contracts";
import { emitProductsChanged, PRODUCTS_CHANGED_EVENT } from "../../shared/cart-sync";
import { formatBdt } from "../../shared/pos";
import { pickBestProductId } from "../../shared/search";
import { api } from "../api";
import { friendlyErrorMessage, type Notify } from "../errors";
import { HighlightText, Metric, NumberInput, ProductThumb } from "../ui";

const emptyProductForm: ProductInput = {
  sku: "",
  barcode: "",
  name: "",
  category: "",
  unit: "pcs",
  cost: 0,
  price: 0,
  vatRate: 0,
  stock: 0,
  lowStockThreshold: 0,
  isActive: true,
  imageDataUrl: ""
};

function createAutoCodes(category: string) {
  const prefix = category.replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase() || "TP";
  const suffix = `${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const sku = `${prefix}-${suffix}`;
  return { sku, barcode: sku };
}

function readProductImage(file: File | undefined, onReady: (dataUrl: string) => void, notify: Notify) {
  if (!file) return;
  if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
    notify("Choose a PNG, JPEG, or WebP image file.", "error");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const image = new window.Image();
    image.onload = () => {
      const maxSide = 480;
      const ratio = Math.min(1, maxSide / Math.max(image.width, image.height, 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * ratio));
      canvas.height = Math.max(1, Math.round(image.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) {
        notify("The product image could not be processed. Choose another image and try again.", "error");
        return;
      }
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      onReady(canvas.toDataURL("image/jpeg", 0.84));
    };
    image.onerror = () => notify("The selected file is not a readable image. Choose a PNG, JPEG, or WebP image and try again.", "error");
    image.src = String(reader.result);
  };
  reader.onerror = () => notify("The product image could not be read. Choose another image and try again.", "error");
  reader.readAsDataURL(file);
}

export function ProductsScreen({ user, notify }: { user: User; notify: Notify }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [dateFilterField, setDateFilterField] = useState<"createdAt" | "updatedAt">("updatedAt");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [productPage, setProductPage] = useState(1);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductInput>(emptyProductForm);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [stockQuery, setStockQuery] = useState("");
  const [stockMatches, setStockMatches] = useState<Product[]>([]);
  const [stockProductId, setStockProductId] = useState("");
  const [receiveQty, setReceiveQty] = useState(0);
  const [receiveNote, setReceiveNote] = useState("");
  const [labelQty, setLabelQty] = useState(1);
  const categories = Array.from(new Set(products.map((product) => product.category).filter(Boolean))).sort();
  const invalidDateRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const datedProducts = useMemo(() => {
    if (invalidDateRange) return [];
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
    return products.filter((product) => {
      const timestamp = new Date(product[dateFilterField]).getTime();
      return Number.isFinite(timestamp) && timestamp >= from && timestamp <= to;
    });
  }, [products, dateFilterField, dateFrom, dateTo, invalidDateRange]);
  const productsPerPage = 20;
  const totalProductPages = Math.max(1, Math.ceil(datedProducts.length / productsPerPage));
  const pageStart = (productPage - 1) * productsPerPage;
  const pagedProducts = datedProducts.slice(pageStart, pageStart + productsPerPage);
  const selectedStockProduct = stockMatches.find((product) => product.id === stockProductId);
  const metrics = {
    total: datedProducts.length,
    active: datedProducts.filter((product) => product.isActive).length,
    lowStock: datedProducts.filter((product) => product.stock <= product.lowStockThreshold).length,
    retailValue: datedProducts.reduce((sum, product) => sum + product.stock * product.price, 0)
  };
  const margin = form.price > 0 ? ((form.price - form.cost) / form.price) * 100 : 0;

  const load = () =>
    api.products
      .list({ query, includeInactive, lowStockOnly, category })
      .then(setProducts)
      .catch((err) => notify(friendlyErrorMessage(err, "Products could not be loaded. Please try again."), "error"));

  const refreshStockMatches = () =>
    api.products
      .list({ query: stockQuery, includeInactive: false })
      .then((found) => {
        setStockMatches(found);
        setStockProductId((current) => pickBestProductId(found, stockQuery, current));
      })
      .catch((err) => {
        setStockMatches([]);
        notify(friendlyErrorMessage(err, "Products could not be searched. Please try again."), "error");
      });

  const reloadProductViews = async () => {
    await Promise.all([load(), refreshStockMatches()]);
  };

  const applyProductSnapshot = (product: Product) => {
    setProducts((current) => {
      const index = current.findIndex((item) => item.id === product.id);
      if (index < 0) return current;
      const next = current.slice();
      next[index] = product;
      return next;
    });
    setStockMatches((current) => {
      const index = current.findIndex((item) => item.id === product.id);
      if (index < 0) return current;
      const next = current.slice();
      next[index] = product;
      return next;
    });
  };

  useEffect(() => void load(), [query, includeInactive, lowStockOnly, category]);

  useEffect(() => {
    setProductPage(1);
  }, [query, category, includeInactive, lowStockOnly, dateFilterField, dateFrom, dateTo]);

  useEffect(() => {
    setProductPage((current) => Math.min(current, totalProductPages));
  }, [totalProductPages]);

  useEffect(() => {
    void refreshStockMatches();
  }, [stockQuery, notify]);

  useEffect(() => {
    const onProductsChanged = () => {
      void reloadProductViews();
    };
    window.addEventListener(PRODUCTS_CHANGED_EVENT, onProductsChanged);
    return () => window.removeEventListener(PRODUCTS_CHANGED_EVENT, onProductsChanged);
  }, [query, includeInactive, lowStockOnly, category, stockQuery]);

  useEffect(() => {
    if (!productModalOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setProductModalOpen(false);
      setEditingProduct(null);
      setForm(emptyProductForm);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [productModalOpen]);

  const resetForm = () => {
    setEditingProduct(null);
    setForm(emptyProductForm);
  };

  const openNewProduct = () => {
    setEditingProduct(null);
    setForm({ ...emptyProductForm });
    setProductModalOpen(true);
  };

  const closeProductModal = () => {
    setProductModalOpen(false);
    resetForm();
  };

  const editProduct = (product: Product) => {
    setEditingProduct(product);
    setForm({
      sku: product.sku,
      barcode: product.barcode,
      name: product.name,
      category: product.category,
      unit: product.unit,
      cost: product.cost,
      price: product.price,
      vatRate: product.vatRate,
      stock: product.stock,
      lowStockThreshold: product.lowStockThreshold,
      isActive: product.isActive,
      imageDataUrl: product.imageDataUrl
    });
    setProductModalOpen(true);
  };

  const applyCategoryCodes = (categoryValue: string) => {
    if (editingProduct) {
      setForm((current) => ({ ...current, category: categoryValue }));
      return;
    }
    const category = categoryValue.trim();
    if (!category) {
      setForm((current) => ({ ...current, category: categoryValue, sku: "", barcode: "" }));
      return;
    }
    setForm((current) => ({ ...current, category: categoryValue, ...createAutoCodes(category) }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (user.role !== "admin") return;
    const category = form.category.trim();
    if (!category) {
      notify("Category is required.", "error");
      return;
    }
    let payload = { ...form, category, barcode: form.barcode || form.sku };
    if (!editingProduct && (!payload.sku.trim() || !payload.barcode.trim())) {
      payload = { ...payload, ...createAutoCodes(category) };
    }
    try {
      if (editingProduct) {
        const { stock: _stock, ...updatePayload } = payload;
        const updated = await api.products.update(editingProduct.id, updatePayload);
        applyProductSnapshot(updated);
        notify("Product updated.");
      } else {
        const created = await api.products.create({ ...payload, stock: payload.stock ?? 0 });
        setProducts((current) => [created, ...current]);
        notify("Product saved.");
      }
      emitProductsChanged();
      closeProductModal();
      await reloadProductViews();
    } catch (err) {
      notify(friendlyErrorMessage(err, "The product could not be saved. Check the entered information and try again."), "error");
    }
  }

  async function receiveStock(event: FormEvent) {
    event.preventDefault();
    if (user.role !== "admin") return;
    if (!selectedStockProduct || receiveQty <= 0) {
      notify("Select a product and enter a quantity greater than zero before receiving stock.", "error");
      return;
    }
    try {
      const updated = await api.inventory.adjust(
        selectedStockProduct.id,
        receiveQty,
        receiveNote || `Stock received: ${receiveQty}`,
        "stock_in"
      );
      applyProductSnapshot(updated);
      notify(`${receiveQty} ${selectedStockProduct.unit} added to ${selectedStockProduct.name}.`);
      emitProductsChanged();
      setReceiveQty(0);
      setReceiveNote("");
      await reloadProductViews();
    } catch (err) {
      notify(friendlyErrorMessage(err, "The stock could not be received. Check the quantity and try again."), "error");
    }
  }

  async function printLabelsForStock() {
    if (user.role !== "admin") {
      notify("Admin permission is required to print labels.", "error");
      return;
    }
    if (!selectedStockProduct) {
      notify("Select a product before printing labels.", "error");
      return;
    }
    await api.printing
      .printBarcode(selectedStockProduct.id, Math.max(1, labelQty))
      .catch((err) => notify(friendlyErrorMessage(err, "The barcode labels could not be printed. Check the printer mode and try again."), "error"));
  }

  const importCsv = async (file: File | undefined) => {
    if (user.role !== "admin") {
      notify("Admin permission is required to import products.", "error");
      return;
    }
    if (!file) return;
    try {
      const csv = await file.text();
      const result = await api.products.importCsv(csv);
      const parts = [
        result.imported ? `${result.imported} added` : "",
        result.updated ? `${result.updated} updated` : "",
        result.skipped ? `${result.skipped} skipped` : ""
      ].filter(Boolean);
      const detail = result.errors.length ? ` ${result.errors[0]}` : "";
      notify(
        parts.length ? `CSV import: ${parts.join(", ")}.${detail}` : `No products were imported.${detail}`,
        result.imported + result.updated > 0 ? "success" : "warning"
      );
      emitProductsChanged();
      await reloadProductViews();
    } catch (err) {
      notify(friendlyErrorMessage(err, "The product CSV could not be imported. Check the file format and try again."), "error");
    }
  };

  const exportCsv = async () => {
    if (user.role !== "admin") {
      notify("Admin permission is required to export products.", "error");
      return;
    }
    try {
      const path = await api.backup.exportCsv("products");
      notify(`Products CSV exported: ${path}`);
    } catch (err) {
      notify(friendlyErrorMessage(err, "The products CSV could not be exported. Choose another location and try again."), "error");
    }
  };

  const deleteAllProducts = async () => {
    if (user.role !== "admin") {
      notify("Admin permission is required to delete all products.", "error");
      return;
    }
    const confirmed = window.confirm(
      "Delete ALL active products?\n\nThey will be deactivated (not permanently erased) so sales history stays intact. You can re-import a CSV to restore them."
    );
    if (!confirmed) return;
    try {
      const result = await api.products.deleteAll();
      notify(result.deleted ? `${result.deleted} products deleted.` : "No active products to delete.");
      emitProductsChanged();
      closeProductModal();
      await reloadProductViews();
    } catch (err) {
      notify(friendlyErrorMessage(err, "Products could not be deleted. Please try again."), "error");
    }
  };

  const deleteProduct = async (product: Product) => {
    if (user.role !== "admin") return;
    const confirmed = window.confirm(`Delete ${product.name}? This will deactivate the product but keep sales and stock history.`);
    if (!confirmed) return;
    try {
      const deleted = await api.products.delete(product.id);
      applyProductSnapshot(deleted);
      notify(`${product.name} deleted.`);
      emitProductsChanged();
      if (editingProduct?.id === product.id) closeProductModal();
      await reloadProductViews();
    } catch (err) {
      notify(friendlyErrorMessage(err, `${product.name} could not be deleted. Please try again.`), "error");
    }
  };

  return (
    <section className="screen products-screen">
      <div className="product-metrics">
        <Metric label="Products" value={String(metrics.total)} />
        <Metric label="Active" value={String(metrics.active)} />
        <Metric label="Low stock" value={String(metrics.lowStock)} tone={metrics.lowStock > 0 ? "warning" : undefined} />
        <Metric label="Retail value" value={formatBdt(metrics.retailValue)} />
      </div>
      <div className="product-primary-action">
        <button type="button" className="primary compact" onClick={openNewProduct} disabled={user.role !== "admin"}>
          <Plus size={17} /> Add New Product
        </button>
      </div>
      <div className="product-management-grid">
      {productModalOpen && (
      <div className="modal-backdrop product-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="product-modal-title">
      <form className="product-setup-modal product-form" onSubmit={submit}>
        <div className="screen-heading">
          <div>
            <h2 id="product-modal-title">{editingProduct ? "Edit Product" : "Add New Product"}</h2>
            <p>Identity, barcode, price, VAT, and reorder alert</p>
          </div>
          <button type="button" className="icon-button" onClick={closeProductModal} aria-label="Close product setup"><X size={20} /></button>
        </div>
        {user.role !== "admin" && <div className="notice">Admin permission is required to save products.</div>}
        <div className="notice neutral">For new products, set opening stock here or receive more later in Stock Entry.</div>
        <div className="product-image-field">
          <ProductThumb src={form.imageDataUrl} alt={form.name || "Product image"} size="xl" />
          <div className="product-image-actions">
            <label className="logo-upload product-image-upload">
              <ImagePlus size={16} />
              <span>{form.imageDataUrl ? "Change image" : "Add product image"}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                onChange={(event) => {
                  const input = event.currentTarget;
                  const file = input.files?.[0];
                  readProductImage(file, (imageDataUrl) => {
                    setForm((current) => ({ ...current, imageDataUrl }));
                    notify("Product image ready. Save the product to keep it.");
                  }, notify);
                  input.value = "";
                }}
              />
            </label>
            {form.imageDataUrl && (
              <button type="button" className="secondary compact" onClick={() => setForm((current) => ({ ...current, imageDataUrl: "" }))}>
                Remove image
              </button>
            )}
            <small>Image is resized to fit billing, cart, and product lists.</small>
          </div>
        </div>
        <div className="form-section">
          <label>
            Product name
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required autoFocus />
          </label>
          <label>
            Category
            <input
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
              onBlur={(event) => applyCategoryCodes(event.currentTarget.value)}
              list="product-categories"
              required
            />
          </label>
          <label>
            Unit
            <input value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} />
          </label>
        </div>
        <datalist id="product-categories">
          {categories.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
        <div className="form-section">
          <label>
            SKU
            <input
              value={form.sku}
              readOnly
              required={!editingProduct}
              tabIndex={-1}
              placeholder={editingProduct ? undefined : "Assigned after category"}
              title={editingProduct ? "SKU cannot be changed" : "Assigned automatically after category"}
            />
          </label>
          <label>
            Barcode
            <input
              value={form.barcode}
              readOnly
              required={!editingProduct}
              tabIndex={-1}
              placeholder={editingProduct ? undefined : "Assigned after category"}
              title={editingProduct ? "Barcode cannot be changed" : "Assigned automatically after category"}
            />
          </label>
        </div>
        <div className="form-section">
          <NumberInput label="Cost" value={form.cost} onChange={(value) => setForm({ ...form, cost: value })} min={0} />
          <NumberInput label="Price" value={form.price} onChange={(value) => setForm({ ...form, price: value })} min={0} />
          <NumberInput label="VAT %" value={form.vatRate} onChange={(value) => setForm({ ...form, vatRate: value })} min={0} max={100} />
          <div className="computed-field">
            <span>Margin</span>
            <strong>{Number.isFinite(margin) ? margin.toFixed(1) : "0.0"}%</strong>
          </div>
        </div>
        <div className="form-section">
          {editingProduct ? (
            <div className="computed-field">
              <span>Current stock</span>
              <strong>{editingProduct.stock}</strong>
            </div>
          ) : (
            <NumberInput label="Opening stock" value={form.stock ?? 0} onChange={(value) => setForm({ ...form, stock: value })} min={0} />
          )}
          <NumberInput label="Low stock alert" value={form.lowStockThreshold} onChange={(value) => setForm({ ...form, lowStockThreshold: value })} min={0} />
          <label className="checkbox product-active">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
            Active product
          </label>
        </div>
        <div className="form-actions">
          <button className="primary" type="submit" disabled={user.role !== "admin"}>
            {editingProduct ? "Update Product" : "Save Product"}
          </button>
          <button type="button" className="secondary" onClick={closeProductModal}>
            Cancel
          </button>
        </div>
      </form>
      </div>
      )}
      <form className="panel stock-entry-panel" onSubmit={receiveStock}>
        <div className="screen-heading">
          <div>
            <h2>Stock Entry</h2>
            <p>Scan/select one product, enter received quantity, then print labels if needed</p>
          </div>
        </div>
        {user.role !== "admin" && <div className="notice">Admin permission is required to receive stock.</div>}
        <label>
          Scan barcode or search product
          <input value={stockQuery} onChange={(event) => setStockQuery(event.target.value)} placeholder="Scan barcode, SKU, or product name" />
        </label>
        <label>
          Product
          <select value={stockProductId} onChange={(event) => setStockProductId(event.target.value)}>
            {stockMatches.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} - {product.sku}
              </option>
            ))}
          </select>
        </label>
        {selectedStockProduct && (
          <div className="stock-selected-product">
            <ProductThumb src={selectedStockProduct.imageDataUrl} alt={selectedStockProduct.name} size="lg" />
            <div className="stock-summary">
              <div>
                <span>Product</span>
                <strong><HighlightText text={selectedStockProduct.name} query={stockQuery} /></strong>
              </div>
              <div>
                <span>Current stock</span>
                <strong>{selectedStockProduct.stock}</strong>
              </div>
              <div>
                <span>After entry</span>
                <strong>{selectedStockProduct.stock + receiveQty}</strong>
              </div>
              <div>
                <span>Barcode</span>
                <strong><HighlightText text={selectedStockProduct.barcode} query={stockQuery} /></strong>
              </div>
            </div>
          </div>
        )}
        <div className="form-section stock-entry-fields">
          <NumberInput label="Quantity received" value={receiveQty} onChange={setReceiveQty} min={0} />
          <input placeholder="Reference / note" value={receiveNote} onChange={(event) => setReceiveNote(event.target.value)} />
        </div>
        <div className="stock-actions">
          <button className="primary" type="submit" disabled={user.role !== "admin" || !selectedStockProduct || receiveQty <= 0}>
            Add Stock
          </button>
          <NumberInput label="Labels" value={labelQty} onChange={setLabelQty} min={1} allowDecimal={false} />
          <button type="button" className="secondary" onClick={printLabelsForStock} disabled={user.role !== "admin" || !selectedStockProduct}>
            <Printer size={16} /> Print Labels
          </button>
        </div>
      </form>
      </div>
      <div className="panel product-list-panel">
        <div className="screen-heading">
          <div>
            <h2>Catalog</h2>
            <p>Search, edit, labels, and CSV import/export</p>
          </div>
          <div className="catalog-csv-actions">
            {user.role === "admin" ? (
              <>
                <button type="button" className="danger compact" onClick={() => void deleteAllProducts()}>
                  <Trash2 size={15} /> Delete All
                </button>
                <button type="button" className="secondary compact" onClick={() => void exportCsv()}>
                  <Download size={15} /> CSV Export
                </button>
                <label className="secondary compact import-button">
                  <Upload size={15} /> CSV Import
                  <input type="file" accept=".csv,text/csv" onChange={(event) => {
                    const input = event.currentTarget;
                    void importCsv(input.files?.[0]).finally(() => {
                      input.value = "";
                    });
                  }} />
                </label>
              </>
            ) : (
              <>
                <span className="secondary compact import-button" aria-disabled="true" title="Admin permission required">
                  <Trash2 size={15} /> Delete All
                </span>
                <span className="secondary compact import-button" aria-disabled="true" title="Admin permission required">
                  <Download size={15} /> CSV Export
                </span>
                <span className="secondary compact import-button" aria-disabled="true" title="Admin permission required">
                  <Upload size={15} /> CSV Import
                </span>
              </>
            )}
          </div>
        </div>
        <div className="product-filters">
          <input placeholder="Search name, SKU, barcode" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {categories.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <label className="checkbox">
            <input type="checkbox" checked={lowStockOnly} onChange={(event) => setLowStockOnly(event.target.checked)} />
            Low stock
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} />
            Include inactive
          </label>
        </div>
        <div className="product-date-filters">
          <label>
            Filter date by
            <select value={dateFilterField} onChange={(event) => setDateFilterField(event.target.value as "createdAt" | "updatedAt")}>
              <option value="updatedAt">Last updated</option>
              <option value="createdAt">Created date</option>
            </select>
          </label>
          <label>
            From date
            <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label>
            To date
            <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          <button type="button" className="secondary" disabled={!dateFrom && !dateTo} onClick={() => {
            setDateFrom("");
            setDateTo("");
          }}>
            Clear Dates
          </button>
        </div>
        {invalidDateRange && <div className="notice">The From date must be before or the same as the To date.</div>}
        <div className="product-table">
          <div className="product-row product-row-header">
            <span>Product</span>
            <span>Codes</span>
            <span>Price</span>
            <span>Stock</span>
            <span>Status</span>
            <span>History</span>
            <span>Actions</span>
          </div>
          {pagedProducts.map((product) => (
            <div className="product-row" key={`${product.id}-${product.updatedAt}-${product.stock}`}>
              <div className="product-identity">
                <ProductThumb src={product.imageDataUrl} alt={product.name} size="sm" />
                <div>
                  <strong><HighlightText text={product.name} query={query} /></strong>
                  <small>
                    <HighlightText text={product.category || "Uncategorized"} query={query} /> - {product.unit}
                  </small>
                </div>
              </div>
              <div>
                <span><HighlightText text={product.sku} query={query} /></span>
                {product.barcode && product.barcode !== product.sku && (
                  <small><HighlightText text={product.barcode} query={query} /></small>
                )}
              </div>
              <div>
                <strong>{formatBdt(product.price)}</strong>
                <small>Cost {formatBdt(product.cost)} - VAT {product.vatRate}%</small>
              </div>
              <div>
                <strong className={product.stock <= 0 ? "stock-alert-qty" : product.stock <= product.lowStockThreshold ? "stock-alert-qty" : undefined}>
                  {product.stock}
                </strong>
                <small className={product.stock <= product.lowStockThreshold ? "stock-alert-meta" : undefined}>
                  Alert at {product.lowStockThreshold}
                </small>
              </div>
              <span className={`status-pill ${product.isActive ? "active" : "inactive"}`}>{product.isActive ? "Active" : "Inactive"}</span>
              <div className="product-history-date">
                <span>{new Date(product.updatedAt).toLocaleDateString()}</span>
                <small>Created {new Date(product.createdAt).toLocaleDateString()}</small>
              </div>
              <div className="row-actions">
                <button className="secondary compact" onClick={() => editProduct(product)}><Edit3 size={15} /> Edit</button>
                <button className="secondary compact" onClick={() => api.printing.printBarcode(product.id, 1).catch((err) => notify(friendlyErrorMessage(err, "The barcode label could not be printed. Check the printer mode and try again."), "error"))}><Printer size={15} /> Label</button>
                <button className="danger compact" onClick={() => void deleteProduct(product)} disabled={user.role !== "admin" || !product.isActive}><Trash2 size={15} /> Delete</button>
              </div>
            </div>
          ))}
          {!invalidDateRange && pagedProducts.length === 0 && (
            <div className="empty-state">No products match the selected filters.</div>
          )}
        </div>
        {!invalidDateRange && datedProducts.length > 0 && (
          <div className="pagination-bar">
            <span>
              Showing {pageStart + 1}-{Math.min(pageStart + productsPerPage, datedProducts.length)} of {datedProducts.length} products
            </span>
            <div className="pagination-actions">
              <button type="button" className="secondary compact" disabled={productPage === 1} onClick={() => setProductPage((page) => Math.max(1, page - 1))}>
                Previous
              </button>
              <strong>Page {productPage} of {totalProductPages}</strong>
              <button type="button" className="secondary compact" disabled={productPage === totalProductPages} onClick={() => setProductPage((page) => Math.min(totalProductPages, page + 1))}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
