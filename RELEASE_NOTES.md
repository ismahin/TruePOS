# TruePOS v0.1.31

## Product catalog cleanup

- Removed the automatic 15-product demo catalog from new installations.
- Added a one-time cleanup for demo products already created by older versions.
- Unused, unchanged demo products are removed together with their generated images and opening-stock records.
- Demo products referenced by real sales or edited by the user are safely deactivated instead of deleting historical data.
- User-created products, inventory records, and sales history are preserved.

## Reliability

- The cleanup is recorded after it runs so future user-created products cannot be mistaken for legacy demo data.
- Receipt-preview sample content remains preview-only and is never inserted into the product catalog.
