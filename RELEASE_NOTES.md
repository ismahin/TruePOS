# TruePOS v0.1.32

## Clearer receipt typography

- Replaced the Xprinter receipt font with Trebuchet MS, whose `I`, `i`, `l`, and `1` shapes remain distinct at small thermal-print sizes.
- Existing Xprinter installations automatically move from the old receipt font to the clearer thermal-safe font.
- Xprinter receipt previews now use the exact same font stack as the printed receipt.
- Disabled font-family selection in Xprinter SDK mode because the thermal-safe font is enforced for consistent hardware output.
- Windows printer mode retains its selectable font options.
- Disabled font ligatures and slightly increased character spacing to improve small-text clarity without making all text bold.

## Validation

- Added regression checks for the thermal receipt font and ligature settings.
