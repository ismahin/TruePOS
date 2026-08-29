# TruePOS v0.1.30

## Highlights

- More reliable product CSV import (updates existing SKUs instead of skipping them)
- Delete all products from Catalog (admin)
- Auto SKU / barcode after category is set; both fields are read-only
- Category is required when saving a product

## Catalog & products

- CSV import now **updates** matching products by SKU/barcode and restores stock / active status
- Import toast shows added, updated, and skipped counts, plus the first error when rows fail
- **Delete All** soft-deactivates every active product (sales history stays intact)
- CSV Export remains available next to Import
- New products get SKU/barcode automatically after you enter **Category** (prefix from category)
- SKU and barcode fields no longer accept manual typing
- Category is mandatory in the product form and on the server

## Billing & UX

- Empty cart no longer leaves a large gap above totals
- Park bill renamed to **Hold**; parked bills to **Held bills**
- Background failures show warning toasts instead of blocking the UI with an error modal

## Reports

- Sales trend chart uses real Y-axis scaling (no fake bar height for zero days)
- Long date ranges aggregate by day/week/month/year instead of a hard 31-day cap
- Faster trend loading via a single `getSalesTrend` query

## Stock & demo data

- Opening stock restored on Add Product
- Demo catalog seeding for local testing
