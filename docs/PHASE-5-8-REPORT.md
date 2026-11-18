# Phase 5–8 Delivery Report — Advanced Operations, Finance & Platform

Date: 18 November 2026
Build: 0.2.0

This phase closes the gaps listed after the Phase 1 delivery, as far as is honest for an
offline-first local application.

---

## 1. Delivered modules

| Area | What is implemented | Notes / boundary |
|---|---|---|
| Warehouse bins | Bin register, put-away, bin stock, pick lists, **optional enforced bin picking at checkout**, bin source recorded on the sale and restored on void/refund | Bin stock is an allocation of on-hand stock; never a second stock count |
| Serial numbers | Register, warranty expiry, status, uniqueness, **enforced at POS**, exact serial restored on void/refund | Damaged returns mark the serial damaged |
| Manufacturing | Multi-component BOMs, output qty, labour/overhead, production orders, component issue + finished receipt, WIP accounting | Single-level BOM; no work centres or routings |
| Fixed assets | Register, straight-line monthly depreciation, immutable depreciation journals, accumulated depreciation | One month per posting; no disposals workflow |
| Budgets | Budget lines per account, budget-vs-actual variance from the posted ledger | No approval/commitment accounting |
| Payroll | Employees, PAYE/pension rates, monthly payroll run, draft/paid payslips, ledger posting | Simple percentage rates; no tax bands or payslip PDF |
| Multi-currency | Currency register, POS tenders, and **foreign-currency purchases** converted to base costs/payables | Expenses remain base currency |
| Customer payments | Payment allocation to oldest credit invoices, statements, AR reduction, ledger posting | Credit invoices only; cash invoices are not statements |
| Split payments | Any combination of cash/transfer/card/POS/credit, validation that tenders equal the total, per-tender accounting | Change is calculated for the single-cash flow |
| Quotations / sales orders | Create, send/draft, print, convert to a real sale, cancel | Stock moves only on conversion |
| Tax configuration | Multiple rules, inclusive/exclusive, active/inactive, per-product assignment, tax breakdown, tax payable posting, proportional tax reversal on refunds | No effective dates or per-jurisdiction filing |
| Bank reconciliation | Bank accounts, statement lines, cleared toggle, ledger-vs-statement difference | Manual statement lines; no bank feed integration |
| Approval workflows | Threshold policy, request queue, approve/reject, automatic request on blocked refund/void, amount-aware check, **server enforcement via `APPROVAL_THRESHOLD`**, cashier requests sync to managers | Approver identity is an authenticated manager/admin session |
| PDF / Excel | CSV, Excel (`.xls` HTML table), PDF via browser print with print styles | No server-side PDF renderer; print dialog can save PDF |
| Camera barcode scanning | `BarcodeDetector` camera scanner with manual fallback; wired into POS | Browser support varies; USB/Bluetooth scanners still work |
| Super-admin dashboard | Separate Platform screen for the platform owner: tenant metadata, users, sync volume, uptime/memory/DB size, recent events, create business | Never exposes tenant sales, products, customers or ledger payloads |

Manual journals remain business-wide; this is documented. Refunds are quantity-validated and
now optionally approval-gated.

## 2. Files added

```
src/advanced.ts              generic advanced sync envelope + table allow-list
src/operations.ts            bins, picking, serials, BOM, production
src/financeOps.ts            assets, budgets, payroll, currencies, bank reconciliation
src/documents.ts             quotations/orders, customer credit/payments/statements
src/approvals.ts             approval queue and threshold checks
src/tax.ts                   inclusive/exclusive sale totals
src/export.ts                CSV, Excel, print-to-PDF
src/components/BarcodeScanner.tsx
src/components/ErrorBoundary.tsx
src/screens/Advanced.tsx     10-tab operations suite
src/screens/SalesDocuments.tsx
src/screens/Platform.tsx
src/advanced.test.ts
docs/PHASE-5-8-REPORT.md
```

Modified: `src/db.ts` (v6 + v7 schema), `src/actions.ts` (tax, split tenders, FX, approvals),
`src/returns.ts` (tax reversal, approval), `src/accounting.ts` (tax, payroll, customer payments,
production, depreciation accounts), `src/analytics.ts` (tenders, AR), `src/syncApply.ts` (advanced
records, cashier purge), `server/app.ts` (advanced sync + platform APIs + headers),
`server/auth.ts`, POS, Sales, Contacts, Products, Reports, Accounting, App navigation, CSS.

## 3. Migrations

Dexie `version(6)` adds 17 tables (documents, payments, tax, currencies, serials, bins, picking,
BOMs, production orders, assets, budgets, employees, payslips, bank accounts/lines, approvals).
Dexie `version(7)` adds `at` indexes to `serials` and `payslips`.

All migrations are additive. No table or column was removed. The server change log remains
schema-free; advanced records travel in `{ table, record }` envelopes with a table allow-list.

## 4. Tests

```
tsc --noEmit                         clean
tsc -p tsconfig.server.json          clean
npm test                             264 passed | 8 skipped (272 tests)
npm run build                        production PWA built
```

### Deep enforcement added after the first pass

- Products marked **Track serial numbers** require exactly one in-stock serial per unit at checkout.
  Serials are marked sold, linked to the sale, and restored (or marked damaged) on void/refund.
  The serial picker is part of the POS cart and survives held sales.
- With **Enforce bin picking** enabled in Advanced → Warehouse, a product with binned stock must
  be sold from bins; over-picking is blocked. The sale stores `binPicks`; void and refund return
  units to the same bins.
- The server reads `APPROVAL_THRESHOLD` and rejects refunds/voids above it unless an approved
  request from a manager/admin exists. Cashiers may submit pending requests, but cannot approve.
  The client reads the same policy from `/api/policy`.
- Purchases can be entered in a foreign currency. Unit costs are converted to base for product
  cost, inventory valuation and payables; the foreign total and foreign unit costs are retained.

New coverage in `src/advanced.test.ts`:
- inclusive/exclusive tax extraction;
- split tenders with balanced postings;
- quotation → sale conversion moves stock only at conversion;
- customer payment allocation, statement, overpayment rejection;
- bin put-away limits, pick completion, bin stock separate from product stock;
- serial uniqueness and status changes;
- BOM production consuming components and producing finished goods with balanced ledger;
- straight-line depreciation and payroll postings;
- budget variance, currency conversion, bank reconciliation;
- approval threshold blocking and manager approval;
- tax sale/refund ledger balance;
- serial enforcement, void/refund restoration and missing-serial rejection;
- bin over-pick rejection, bin source capture and refund-to-bin;
- foreign purchase conversion (cost, total, payable and foreign total).

Server tests add advanced-record sync, cashier exclusion and platform admin authorisation.

## 5. Still deliberately limited

- Bin enforcement and serial enforcement are opt-in per policy/product.
- Serial pickers are implemented in the POS; quotations containing serial-tracked items still need
  to be converted through a serial-aware flow.
- Manufacturing is single-level and does not track labour time or machine costs.
- Payroll uses flat percentages and does not generate bank files or payslip PDFs.
- Multi-currency covers POS tender conversion, not foreign purchases/bills.
- Approval enforcement is local (the server records approvals but cannot know an offline
  device's threshold policy unless configured identically).
- Bank reconciliation is manual statement entry, not a bank API feed.
- Excel export is an HTML `.xls` workbook; PDF is print-to-PDF.
- Platform admin can see metadata and create businesses; it does not include subscription
  billing, background task control or backup restore.
- Customer statements cover credit invoices only.

## 6. Local demo

See the link supplied in the chat. It runs the production build with the local Node server and a
demo admin account. Data is stored per browser in IndexedDB (business data) and on the server
(change log), exactly as in production.
