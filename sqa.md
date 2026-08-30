# TruePOS Software Quality Assurance Report (Retest)

| Field | Value |
|--------|--------|
| **Product** | TruePOS offline desktop POS |
| **Version under test** | `0.1.28` |
| **Report date** | 30 August 2026 |
| **Cycle** | **Retest** after defect fix pass |
| **Baseline report** | Prior `sqa.md` (initial full sweep) |
| **Tester role** | Senior SQA |
| **Automated suite** | `npm test` → **38/38 passed** (6 files; +2 new cart-sync cases) |
| **Typecheck** | `tsc` (app + node) → **clean** |

---

## 1. Scope

Same as baseline:
- **In scope:** Auth, Checkout, Products, Inventory, Reports, Settings (non-backup), printing logic, roles, shared math, shell UX  
- **Out of scope:** Database Backup / Google Drive / encrypted import-export  

**Retest focus:** All defects DEF-01 … DEF-14 from the baseline report, plus regression of recently fixed scroll/stock-sync items.

---

## 2. Executive summary

| Item | Baseline | Retest |
|------|----------|--------|
| **Overall (excl. backup)** | Conditional Pass | **Pass** |
| Critical open | 1 | **0** |
| High open | 4 | **0** |
| Medium open | 6 | **0** (1 accepted design) |
| Low open | 5 | **2 residual** (E2E gap, hardware lab) |
| Unit tests | 36/36 | **38/38** |

**Production recommendation:** Suitable for single-register admin + cashier use **excluding backup features** (still untested by request). Hardware print paths remain environment-blocked until XP-365B / Windows printer lab is available. Full Electron restart recommended after preload/`services` changes.

---

## 3. Fix verification matrix

| ID | Severity | Defect (baseline) | Fix summary | Retest |
|----|----------|-------------------|-------------|--------|
| DEF-01 | Critical | Parked soft-reserve not enforced at charge | Charge pre-check + `createAndPrintSale(..., reservedStockByProductId)` validates free = on-hand − parked | **Pass** |
| DEF-02 | High | Resume auto-park skipped customer rule | `resumeCart` requires name/phone + stock check before auto-park | **Pass** |
| DEF-03 | High | Inventory UI not admin-gated | Notice + disabled ops/save for cashier; early return in `saveMovement` | **Pass** |
| DEF-04 | High | Enter blocked outside Checkout | Global Enter capture removed from `App.tsx` | **Pass** |
| DEF-05 | Medium | Cashier CSV / label print | CSV control admin-only; label print gated UI + handler | **Pass** |
| DEF-06 | Medium | Login case-sensitive vs reset NOCASE | Login uses `COLLATE NOCASE` + trim | **Pass** |
| DEF-07 | Medium | Bill discount after VAT | **Accepted design** — UI hint + receipt label `Bill discount (after VAT)` | **Pass (accepted)** |
| DEF-08 | Medium | Return/cancel API only | Reports Find a bill: Return (admin), Cancel (own/admin) | **Pass** |
| DEF-09 | Medium | cart-sync ignored parked | Sync clamps with reservations; held carts claim stock newest-first | **Pass** (+ unit tests) |
| DEF-10 | Low | Print abort logged as `return` | Abort restock uses `adjustment` + `Print aborted …` note | **Pass** |
| DEF-11 | Low | No E2E suite | Not in this fix cycle | **Open (deferred)** |
| DEF-12 | Low | Printer hardware unverified | Still no XP-365B in this environment | **Blocked (env)** |
| DEF-13 | Low | Walk-in parks hard to tell apart | Label `#N · customer` | **Pass** |
| DEF-14 | Low | 31-day trend vs range metrics | Unchanged; UI already explains | **Pass (accepted)** |

### Regression (prior cycle)

| Issue | Retest |
|--------|--------|
| Non-Checkout screens could not scroll | **Pass** (no regression) |
| Checkout stale stock after stock-in | **Pass** (no regression) |

---

## 4. Module retest results

Legend: **P** Pass · **B** Blocked · **N/A** Excluded · **A** Accepted design

### 4.1 Auth / roles
| Scenario | Result |
|----------|--------|
| Login with mixed-case username (NOCASE) | P (code) |
| Admin vs cashier product/settings gates | P |
| Cashier Inventory save disabled | P |
| Cashier CSV / labels blocked | P |

### 4.2 Checkout
| Scenario | Result |
|----------|--------|
| Park requires customer; resume switch requires customer | P |
| Charge blocked when qty + parked > on-hand (UI) | P |
| Charge blocked server-side with reserved map | P |
| Catalog sync clamps active cart for parked | P |
| Held list shows `#hold · name` | P |
| Stock-in then add from open search | P |
| F2 / F4 / F8 | P |

### 4.3 Products / Inventory
| Scenario | Result |
|----------|--------|
| Admin stock control / movements | P (logic) |
| Cashier view-only stock control | P |
| Print abort movement type adjustment | P (code) |

### 4.4 Reports
| Scenario | Result |
|----------|--------|
| Enter in Find a bill works (Enter no longer global-blocked) | P |
| Return (admin) / Cancel (cashier own) on completed bills | P |
| Metrics / 31-day trend note | A |

### 4.5 Settings / print
| Scenario | Result |
|----------|--------|
| Non-backup settings admin gates | P |
| Database Backup | N/A |
| XP-365B / Windows silent print lab | B |

### 4.6 Shared / automation
| Suite | Result |
|--------|--------|
| pos / search / billing-session / xprinter | P |
| held-carts (label + reservation) | P |
| cart-sync (parked clamp + held claim) | P (6 tests) |

---

## 5. Residual risks

1. **Parked reservations remain renderer-owned** (`localStorage`). Charge sends the map to main for enforcement on this terminal; a second TruePOS process on the same DB would not see another machine’s parks. Acceptable for single-register; multi-terminal needs DB-backed holds.  
2. **No Playwright/Electron E2E** (DEF-11) — IPC paths covered by review + unit tests only.  
3. **Print hardware** (DEF-12) — confirm on target printers before production cutover.  
4. **Bill discount after VAT** (DEF-07) — intentional; ensure shop SOP matches receipt wording.  
5. **Preload/main changes** require a full Electron restart (HMR alone is insufficient).

---

## 6. Exit criteria status

| Criterion | Status |
|-----------|--------|
| DEF-01 … DEF-04 closed | **Done** |
| Cashier: Checkout + Reports Enter + no Inventory save | **Done** |
| Print lab Windows + XP-365B + fail rollback | **Pending hardware** |
| Stock-in → Checkout add without clearing search | **Done** |
| Parked stock cannot be oversold via charge | **Done** |
| Return/cancel UI or documented | **Done** (UI on Reports) |
| Backup SQA | **Still excluded** |

---

## 7. Sign-off

| Item | Decision |
|------|----------|
| **Overall (excl. backup)** | **Pass** |
| **Production recommendation** | Approve for single-register pilot after printer smoke test on site |
| **Backup / Drive** | Not tested (excluded) |
| **Next SQA** | Optional E2E smoke + dedicated backup suite + multi-terminal hold design if needed |

*— End of retest SQA report —*
