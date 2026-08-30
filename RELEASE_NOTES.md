# TruePOS v0.1.33

## Reliable form controls

- Fixed a Settings race condition where delayed logo, save, print-test, calibration, or backup responses could restore older values.
- New edits now always win over outdated asynchronous responses.
- Google Drive connection and backup status can update without reverting newer backup schedule changes.
- Removed disabled states from all input, select, textarea, checkbox, and range controls throughout the renderer.
- Xprinter-fixed values now appear as clear informational fields instead of disabled controls.
- Product code fields remain deliberately read-only because SKU and barcode values are assigned automatically; they are never disabled.

## Validation

- Added race-condition regression coverage for stale saves and delayed Google Drive responses.
- Added an automated guard that fails if a disabled data-entry control is introduced in the renderer.
- All interactive fields that are displayed remain usable; safety and permission rules continue to apply to action buttons.
