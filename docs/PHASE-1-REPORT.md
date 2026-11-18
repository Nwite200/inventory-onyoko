# Phase 1 & Core Finance — Delivery Report

Date: 17 November 2026
Scope delivered: audit, design system, application shell, dashboard, POS, catalogue, sales,
reporting centre, double-entry accounting, refund integrity, and sync coverage for the new modules.

Screenshots (freshly captured from the running app): `docs/screenshots/`.

---

## 1. What was inspected

- Full repository tree, `package.json`, Vite/PWA config, TypeScript configs.
- `src/db.ts` (Dexie schema and 16 tables), `src/actions.ts` (write path), `src/stock.ts`,
  `src/sync.ts`, `src/syncApply.ts`, `src/auth.ts`, `src/location.ts`, `src/lots.ts`,
  `src/purchases.ts`, `src/transfers.ts`, `src/numbering.ts`, `src/config.ts`, `src/i18n.ts`.
- Every screen under `src/screens/`, including the uncommitted Dashboard, Contacts, Expenses,
  Returns, Inventory Hub and Cash Register work.
- Server: `server/app.ts` (router, sync push/pull, RBAC payload filtering), `server/auth.ts`,
  `server/db.ts`, `server/tls.ts`, existing server tests.
- Existing test suite and build (`tsc --noEmit`, Vitest, Vite production build).

The uncommitted work was preserved. No table was dropped, no user file was discarded, and no
module was rewritten just to change its style.

## 2. What changed

### 2.1 Design system and shell

- Replaced the stylesheet with a token-based design system (light + dark), tabular numerals for
  money, restrained motion, reduced-motion support, print styles.
- New deep-navy shell with electric-indigo accent, inline SVG icon set (no emoji navigation).
- Collapsible desktop sidebar, mobile drawer, mobile bottom navigation, safe-area handling.
- Top bar: command palette (`⌘K`), branch selector, sync/offline status, notification centre with
  live counts (low stock, out of stock, expiring, pending sync, closed till), theme toggle,
  profile menu, voice assistant launcher.
- Branch switching recomputes stock from the movement ledger and refreshes live queries.
- Command palette searches pages and products; keyboard navigation (Enter opens the first hit).
- Login, receipt, label, modal, empty, loading and error states restyled.

### 2.2 Dashboard

- New `/src/analytics.ts` (pure, tested) and a rebuilt dashboard.
- Real data only: net sales, gross profit, net profit, cash position, trends, payment mix,
  best sellers, low stock, inventory value, recent tickets, receivables/payables, purchases,
  expenses, refund total.
- Range filter (today / 7 / 30 / 90 days) and branch filter.
- Previous-period comparison and SVG sparkline/area/donut charts with no chart dependency.
- Pending-sync indicator is hidden in local-only mode (an outbox with no server is not a problem).

### 2.3 POS

- Two-panel premium layout with product search, barcode/Enter matching, category chips,
  deterministic product monograms, stock status, held sales, customer selection, payment chips,
  cash received/change, cart discounts (% or amount), keyboard shortcuts (F2 search, F4 charge),
  mobile cart CTA and a redesigned receipt.
- Sale lines now capture **cost at the time of sale**, so historical profit is stable when a
  product's cost changes later.
- Cart-level discounts are stored as `subtotal`, `discount` and `total`; accounting posts the
  discounted revenue and never an invented tax.
- A credit sale requires a customer in the UI; the till remains fully usable offline.

### 2.4 Catalogue

- Rebuilt products screen: summary strip, search, category filter, stock filter, product table
  with category, price (editable inline), cost (managers only), stock status, batch/labels.
- Add-product and stock-adjustment modals with reasons and audit notes.
- Categories are optional free text so a shop can start without configuration; they are included
  in sync and used by POS filters and category reports.

### 2.5 Sales and reporting

- Sales ledger with range/branch/payment/status filters, search, CSV export, receipt view and
  controlled voiding.
- Reporting centre: summary strip, sales trend, payment mix, product performance, category sales,
  stock and expiry, branch comparison, CSV/print.
- Profit/receivables cards are hidden for cashiers; the report states whether local unsynced
  changes are included.

### 2.6 Refund integrity

- New `src/returns.ts` domain function:
  - refunds may never exceed the quantity sold, counting earlier refunds;
  - voided sales cannot be refunded again;
  - restock movements use deterministic ids, so a retry cannot restock twice;
  - refund, stock movement and sync event are written in one transaction;
  - the line records the cost at sale time so COGS is reversed correctly.
- Refund book calculates remaining refundable quantity and shows already-refunded units.
- Server independently validates refund totals against the original sale and prior refunds, so a
  modified client cannot over-refund.

### 2.7 Double-entry accounting

New `src/accounting.ts`, `src/screens/Accounting.tsx`, and a `journals` table.

- Chart of accounts: assets, liabilities, equity, revenue, COGS, operating expenses.
- Automatically derived, balanced postings from:
  - sales (cash/bank/receivable; revenue; COGS and inventory release),
  - purchases and every supplier payment,
  - expenses mapped to expense accounts,
  - refunds (returns contra-revenue, cash/bank movement, restock reversal),
  - opening stock and stock adjustments,
  - manual journals.
- Manual journals are validated (accounts exist, one side per line, debits = credits) and
  immutable. Corrections use a reversal entry; posted lines are never edited.
- Statements: trial balance, profit & loss, balance sheet, account ledger, with period filter,
  branch filter, CSV export and print.
- Balance sheet identity is visible on screen (`difference` must be zero).
- Cash/bank split, gross/net margin and asset mix are shown on the overview.
- Accounting and expenses are hidden from cashiers on the server feed and purged from a device
  when a cashier signs in.

### 2.8 Sync and server

- Added server entities: `expense`, `sale_return`, `cash_register`, `journal`.
- Payload validation for each; unbalanced journals are rejected.
- Idempotent retry detection: an already-seen change is acknowledged, never applied twice.
- Cumulative refund validation against the sale (including earlier refunds).
- Cashier permissions: may sell, refund within the rules, and open/close a register; may not
  push expenses or journals. Cashiers do not receive expenses/journals and no longer receive
  cost prices inside sale lines.
- `syncApply` now applies expenses, refunds (with restock), register open/close and journals, and
  can undo a refused refund/journal locally.
- Security headers: `nosniff`, `no-referrer`, `DENY` framing, permissions policy, `no-store` for API.
- `purgeForCashier` now clears expenses and journals as well as costs/suppliers/purchases.

### 2.9 Other screens

- Inventory hub: consistent page head, summary strip, ledger with readable reasons and truncated
  references, icon-based tabs.
- Purchases: page head, payables summary, proper line editor grid, supplier payment modal,
  consistent table and icons.
- Cash register, expenses, contacts and refund book received consistent headers and iconography.
- Mobile POS: cart CTA, touch targets, 2-column product grid.

## 3. Files added

```
docs/AUDIT.md
docs/PHASE-1-REPORT.md
docs/screenshots/*.png
src/analytics.ts            src/analytics.test.ts
src/accounting.ts           src/accounting.test.ts
src/returns.ts              src/returns.test.ts
src/components/Icon.tsx
src/components/charts.tsx
src/screens/Accounting.tsx
```

Key files modified: `src/db.ts`, `src/actions.ts`, `src/App.tsx`, `src/styles.css`, `src/config.ts`,
`src/syncApply.ts`, all redesigned screens (`Home`, `Pos`, `Products`, `Sales`, `Reports`,
`InventoryHub`, `Purchases`, `Contacts`, `Expenses`, `CashRegister`, `Returns`, `LineEditor`,
`Login`), `server/app.ts`, `server/auth.ts`, `server/app.test.ts`, `public/config.json`,
`vite.config.ts`.

## 4. Database migrations

Dexie `version(5)` (client-side, non-destructive):

- adds `journals: 'id, number, date'`;
- adds a `category` index to `products`;
- new optional fields: `Product.category`, `SaleItem.cost`, `Sale.subtotal`, `Sale.discount`,
  `Sale.cashier`, `Sale.note`, `SaleReturnItem.cost`.

No SQL migration was needed on the server: the change log is schema-free JSON by design.

## 5. What is working

Verified by tests and by running the built app:

- Offline sale, offline reload, receipt, persistence across reload (see section 7).
- Refund rules, restock idempotence, refund accounting.
- Balanced double-entry statements; manual journal posting and reversal.
- Cost-at-sale profit; branch and range filters; category reporting.
- Product catalogue and categories; discounts; held sales.
- Server acceptance/rejection of new entities; cashier data restrictions; retry de-duplication.
- Existing features: voice, barcode labels, receipts, transfers, purchases, lots, multi-business.

## 6. What remains incomplete (explicitly not claimed)

- Warehouse hierarchy (zone/aisle/row/shelf/bin), put-away/picking/packing, stock counts as
  dedicated documents, serial numbers, BOM/manufacturing, fixed assets, budgets, payroll,
  multi-currency, customer payment allocation/statements, approval workflows beyond RBAC.
- Manual journal numbering is per-device and may repeat across devices (the id is unique).
- Branch accounting includes business-wide manual journals; there is no allocation to branches.
- Voided sales/purchases are excluded from derived accounting rather than reversed with a
  documented credit note (a supplier refund/credit workflow is not implemented).
- Offline voice, printing and browser compatibility limitations documented in the README remain.
- PDF/Excel binaries are not generated; CSV and browser print are available.
- No CSP yet (inline styles and the optional external LLM make a safe policy a Phase 8 task).
- Tables are not virtualised; the ledger loads one device's data (fine at small business scale).
- Refund quantities are validated, but refund approvals are not a separate manager step.

## 7. Tests executed

### Automated

```
npx tsc --noEmit            clean
tsc -p tsconfig.server.json clean
npm test                    22 passed | 1 skipped (23 files)
                            241 passed | 8 skipped (249 tests)
npm run build               production PWA built successfully
```

New coverage:

- `src/accounting.test.ts` — balanced derived entries, cost captured at sale, discount netting,
  balance-sheet identity, stock-loss posting, journal validation, posting and reversal.
- `src/analytics.test.ts` — range/branch filters, bucketing, stock by location, cost fallback,
  cash-flow classification.
- `src/returns.test.ts` — refund, restock, over-refund rejection, damaged goods, voided sale,
  item not on the sale.
- `server/app.test.ts` — expenses/register/journal acceptance, unbalanced journal rejection,
  over-refund rejection, retry de-duplication, cashier financial-data isolation, security headers.

### Manual offline test (production build, Chrome, service worker)

1. Loaded the production build and installed the service worker (`controller: true`).
2. Seeded demo data through the UI.
3. Took a sale online.
4. Switched Chrome's network to **offline** and reloaded.
   Result: app shell loaded from cache (`navigator.onLine === false`, dashboard rendered).
5. Completed another sale with the network still off; receipt generated.
6. Reloaded again offline and opened Sales.
   Result: both sales were present; no data was lost.
7. Re-enabled the network.

This confirms the app shell and IndexedDB workflow offline. Multi-device sync was verified by the
automated two-device tests (`src/shops.test.ts`, `src/sync.test.ts`), not by physical devices.

## 8. How to try it

```bash
npm install
npm test
npm run dev                 # development, http://localhost:5173
# Settings → Load demo data
# Dashboard, POS (F2/F4), Products, Sales, Reports, Accounting
```

Production/local-network:

```bash
npm run build
npm run server              # app + API on :8787 (Node 22.18+)
# optional: node scripts/make-cert.mjs, then restart for HTTPS on the LAN
```

Scoped test checklist:

1. POS: add items, apply a % discount, pay cash, check the receipt and the dashboard figures.
2. Products: add a category, adjust stock by −2, confirm the ledger entry and the accounting posting.
3. Refund book: refund part of a sale, try to refund more than remains, confirm stock and COGS.
4. Accounting: open Statements → Profit & loss / Balance sheet / Trial balance. The difference
   must be zero and debits must equal credits.
5. Offline: install/load, go offline, reload, sell, reload again, confirm the sale persists.

## 9. Known issues

- Naira glyph rendering depends on the OS font; the configured symbol is used verbatim.
- Date-only inputs are parsed in local time in accounting (fixed), but older browser storage may
  still hold a timezone-shifted custom range until the field is changed.
- The POS cannot split one payment across methods yet (single method per sale).
- Manual journals are not associated with a branch.
- Voice flows are hidden on the POS screen (the assistant lives in the top bar elsewhere) to keep
  the checkout surface clean.

## 10. Deployment notes

- Keep the existing Node/SQLite server; deploy behind Caddy/nginx or plain HTTPS.
- Set `AUTH_SECRET`, `ADMIN_USER`/`ADMIN_PASSWORD`, `PORT`, `DB_PATH` in the environment.
- Back up `DB_PATH` (SQLite file) plus the app's IndexedDB is per-device only.
- The PWA must be served over HTTPS (or localhost) for service worker, microphone and direct
  printing. A LAN certificate is generated by `scripts/make-cert.mjs`.
- Rollback: deploy the previous `dist/` and server build; the client DB migration is additive and
  does not delete data.
