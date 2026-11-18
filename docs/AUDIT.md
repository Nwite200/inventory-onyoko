# OpenPOS — Repository Audit, Architecture Review & Roadmap

Date: 17 November 2026
Auditor: engineering review of the existing repository (not a greenfield assumption)

---

## 1. What this project actually is

The brief describes a Django application. **The repository is not Django.** It is a mature
offline-first PWA built with:

| Layer | Technology | Notes |
|---|---|---|
| UI | React 19 + TypeScript, custom CSS | No component library, no chart library |
| Local database | IndexedDB via Dexie 4 | Source of truth while offline |
| Sync server | Node 22 built-in `http` + `node:sqlite` | Small, dependency-free API |
| Build | Vite 8 + `vite-plugin-pwa` | Installable PWA, service worker |
| Tests | Vitest (218 passing, 8 skipped) | Business logic + server integration |
| Voice | Offline Whisper via `onnxruntime-web` | Optional, 100 MB model |

Replacing this with Django would throw away a working offline engine, 272 tests, a
synchronisation design and a PWA — all of which are harder to rebuild than they look.
**Recommendation: keep the current architecture.** The brief's Django requirement is
conditional ("preserve Django as the existing backend *unless the audit establishes a
compelling technical reason*"). Here the compelling reason is that the product already is
offline-first, and a server-rendered Django app with separate PWA sync would be a rewrite,
not an improvement. A modular monolith in TypeScript/Node delivers the same domain
boundaries with lower operational cost.

## 2. Existing capabilities (verified, not assumed)

Working and covered by tests or code:

- Offline sales, stock movements as an append-only event ledger, void sales.
- Products, barcodes, aliases, price changes, low-stock alerts.
- Purchases/suppliers: receiving, partial payment, pay-later, void, batch/expiry lots.
- Multi-shop stock, transfers with explicit send/receive (no double counting).
- Role enforcement **on the server** (`cashier` / `manager` / `admin`), cashier data
  redaction (cost prices, suppliers, purchases), rate-limited login.
- Multi-business isolation with a super-owner, password rotation invalidating sessions.
- PWA install, service worker, receipt printing (ESC/POS USB/serial/BLE/RawBT), barcode labels.
- Offline voice assistant with confirmation and audit log.
- i18n (English, Hausa, Yoruba, Igbo, Pidgin).

Uncommitted work in the tree (must be preserved): Dashboard, Contacts, Expenses, Returns,
Inventory Hub, Cash Register screens; extended `db.ts` / `styles.css` / `App.tsx`.

## 3. Findings and risks

### 3.1 Blocking UI defects

1. **Missing stylesheet coverage.** 40+ classes used by screens (`.modal`, `.actions`,
   `.primary`, `.big`, `.dashboard-header`, `.accent-*`, `.register-*` …) are not defined.
   Modals render as plain blocks; POS buttons have no primary styling.
2. **Broken navigation.** Dashboard's "Transfer Stock" calls `onNavigate('transfers')`,
   but no such tab exists (`transfers` lives inside Inventory). It does nothing.
3. Sidebar/topbar use emoji as icons, which breaks visual consistency and platform rendering.
4. No responsive strategy beyond collapsing the POS to one column; no mobile navigation.
5. Charts absent; dashboard is KPI text only. The requested "premium" bar is not met.

### 3.2 Data-integrity defects (higher priority than visuals)

1. **Returns are not idempotent.** `recordMovement` is called with a random `uid()` per
   return line, so replaying the same return (sync retry, second device) double-restocks.
   There is no check against the quantity already returned, so a sale can be refunded
   repeatedly. No accounting impact was recorded at all.
2. **New modules never reach the server.** `server/app.ts` only accepts
   `product, stock_movement, sale, customer, location, supplier, purchase, transfer, lot`.
   Expenses, registers and returns are queued in the outbox and then **rejected** by the
   server. They also have no `syncApply` handlers, so other devices never see them.
3. **No accounting.** Revenue is `sales.total`; there is no chart of accounts, no
   double-entry ledger, no trial balance, P&L or balance sheet. This is the largest
   functional gap against the brief.
4. Sale lines store price but **not cost at time of sale**, so historical gross profit
   changes whenever a product's cost is updated. Dashboard "profit" is an estimate.
5. No customer payments/receivables ledger: credit sales are recorded but never settled.
6. Server accepts any payload shape for known entities but doesn't validate expense /
   return / register payloads because they are not accepted at all.

### 3.3 Security review

Good: scrypt password hashing, HMAC tokens with versioning, server-side RBAC, no plaintext
passwords in browser storage, path-traversal guard on static files, body size limit,
constant-time scrypt on unknown usernames, CORS/CSRF posture appropriate for Bearer tokens.

Gaps: no `Content-Security-Policy` / security headers on static responses; super-admin
cannot see platform health or audit events; no per-business backup export; audit log is
local-only (not centralised). These are Phase 7/8 items, not blockers.

### 3.4 Performance

Local reads are indexed; reports scan tables but datasets are per-device (thousands, not
millions). Dashboard currently scans `sales` and `products` repeatedly and runs `find()`
per sale line (`O(n·m)`) — replaced by maps in this phase. Server pull is paginated (500).
No virtualised tables yet; acceptable until ~5k rows, then add windowing.

---

## 4. Architecture decision

Keep the modular monolith, but formalise the domain boundaries already implicit:

```
src/domain/        pure business rules (accounting, analytics, returns)
src/screens/       presentation only
src/actions.ts     the single write path (UI + voice)
src/accounting.ts  double-entry posting + financial statements
src/analytics.ts   reporting queries (no UI)
server/            auth, RBAC, append-only change log, pull/push
```

Rules enforced going forward:

- No business logic in screens.
- Every write: validate → transaction → local table → outbox.
- Every stock change: immutable movement with deterministic id.
- Every financial event: balanced journal; posted manual journals are never edited.
- Money is stored in major units (as today). No floating-point sums are used for posting
  decisions beyond a 0.005 tolerance check.

---

## 5. Visual direction

**Brand:** "OpenPOS / Onyoko" — a calm, high-trust financial operating system.

- **Foundation:** deep midnight navy `#0A1024` shell (light mode) and near-black
  `#070B16` (dark mode); soft cool-grey workspace `#F4F6FA`.
- **Accent:** electric indigo `#4F46E5`; hover `#4338CA`.
- **Semantic:** emerald `#059669` (positive), amber `#D97706` (attention),
  rose `#E11D48` (negative). No decorative gradients; one subtle radial glow in the shell.
- **Type:** Inter (system fallback), tight display tracking, `tabular-nums` on every
  financial figure so columns scan cleanly.
- **Surfaces:** 12–16 px radii, 1 px hairline borders, restrained shadows; depth comes
  from contrast and spacing, not from drop shadows.
- **Motion:** 120–200 ms ease transitions, chart draw-in, cart line highlight, skeleton
  shimmer. All motion is CSS-only and disabled under `prefers-reduced-motion`.
- **Density:** comfortable by default, compact tables; POS large touch targets (≥44 px).

Delivered in this phase: design tokens and primitives, premium app shell, responsive
mobile navigation, SVG icon set, revenue/area/donut charts, redesigned POS, dashboard,
accounting workspace.

---

## 6. Phased roadmap

| Phase | Scope | Status |
|---|---|---|
| 0 | Audit, architecture, design direction | **This document** |
| 1 | Design system, shell, responsive layout, dashboard, POS redesign | **Implemented** |
| 2 | Returns integrity, expenses/registers/returns sync, customer ledger hooks | **Implemented (partial)** |
| 3 | Offline PWA hardening, conflict surfacing, sync diagnostics | Existing + diagnostics added |
| 4 | Double-entry accounting, CoA, journal, trial balance, P&L, balance sheet | **Implemented** |
| 5 | Multi-warehouse/bin locations, picking, put-away, serials, BOM | **Implemented (first pass)** |
| 6 | Multi-branch consolidation, approval workflows, granular permissions | Branch filters + approval queue; permissions still 3 roles |
| 7 | Budgets, fixed assets, payroll, currencies, tax, bank rec, exports | **Implemented (first pass)** |
| 8 | Security headers, platform admin, super-owner separation | Implemented; backups/load tests remain |

Explicitly **not** claimed as complete: warehouse hierarchy (zone/aisle/bin), serial
numbers, BOM/manufacturing, payroll, multi-currency, customer payment allocation,
approval workflows, PDF/Excel export binaries.

---

## 7. Offline model (unchanged, documented)

Three supported modes map to existing deployment options:

1. **Standalone** — one device, IndexedDB only, `npm run build` and host statically.
2. **Local network** — Node server on a shop PC; devices use its LAN address; stock is
   event-sourced, so concurrent tills reconcile.
3. **Hybrid** — same local server synchronises to a central instance through the change log.

Known trade-off (unchanged): two isolated offline devices can oversell; the server keeps
both sales because they really happened, and stock goes negative. This is surfaced in
Reports > Running low and in the new sync/notification panel.

---

## 8. Test strategy for this phase

- Pure accounting: balanced postings, P&L, balance sheet identity, invalid journal rejection.
- Analytics: range filtering, previous-period comparison, stock-by-location.
- Returns: over-refund rejection, idempotent movement ids.
- Server: new entities accepted, cashier denied journals, payload validation.
- Build: `tsc --noEmit` must stay clean; full Vitest suite must pass.
