# UI/UX Audit & Redesign — 18 November 2026

## 0. Important architecture note

The brief describes a Django application. **This repository is not Django.** It is an
offline-first React 19 + TypeScript PWA backed by a small Node 22/SQLite sync server, with
IndexedDB as the local source of truth. The audit confirmed that keeping this stack is the right
engineering decision: it preserves working offline sales, the append-only stock ledger, the PWA,
260+ original tests and the sync engine. Replacing it with Django would be a rewrite, not a
redesign, and would weaken the offline guarantees.

The redesign therefore preserves the backend and business logic, and rebuilds the experience in
the existing stack.

## 1. Pages and navigation inspected

| Area | Current implementation | Audit finding |
|---|---|---|
| Dashboard | Premium BI dashboard with real sales, profit, cash, payment mix, stock and activity | Strong; replaced the old generic admin cards |
| POS | Two-panel catalogue/cart, barcode, held sales, discounts, tax, split tender, serials, camera scanner | Strong; mobile first-class with cart CTA |
| Sales | Ledger with filters, receipts, void, invoice, CSV/Excel | Strong after redesign |
| Quotations | Quotation/order builder, serial-aware conversion | Added to primary navigation |
| Refund book | Quantity-validated refunds, serial/bin restoration, approvals | Strong |
| Products | Search/filter catalogue, inline price, stock, batches, tax and serial flags | Strong |
| Categories | Category directory with product counts and safe rename | New dedicated screen |
| Inventory | Movement ledger, adjustments, batches/expiry, transfers | Strong; bin enforcement added |
| Warehouses | Bins, put-away, bin stock, picking, manufacturing | Reachable from primary navigation |
| Purchases | Receive goods, supplier balances, payment modal, foreign currency | Strong |
| Contacts | Customers/suppliers, customer payments and statements | Strong |
| Expenses | Real ledger postings with approval workflow | Strong |
| Cash register | Open/close, expected cash, discrepancies, shift history | Functional; visual polish complete |
| Accounting | CoA, journal, trial balance, P&L, balance sheet, ledger | Strong |
| Banking | Bank accounts, statement lines, cleared reconciliation | Functional |
| Reports | Unified report centre with charts and exports | Strong |
| Employees | Dedicated staff directory | New |
| Branches | Branch directory and device branch selection | New |
| Branding | Brand identity, logo, colors, receipt/A4 designer, navigation | New |
| AI Copilot | Deterministic offline commands + optional server AI, confirmations, audit log | Upgraded |
| Settings | Server, shops, printing, voice, backups | Functional; branding studio extracted |
| Platform admin | Tenant metadata, sync volume, health, audit events | Strong |

Screenshots in `docs/screenshots/`: dashboard, POS, accounting, products, reports, platform,
advanced suite, split payment and serial picker.

## 2. Problems found in the pre-redesign interface

1. **Generic admin presentation.** Bootstrap-like cards, emoji navigation and inconsistent
   spacing did not communicate a premium financial product.
2. **Broken styling coverage.** Over 40 classes used by screens had no CSS; modals and POS
   primary buttons rendered unstyled.
3. **Navigation did not match retail workflows.** Quotations, categories, warehouses, branches and
   employees were buried inside other screens.
4. **No branding or receipt studio.** A client could change only a handful of config fields; no
   logo, invoice layout, live receipt preview or navigation customization.
5. **Receipt/invoice output was fixed.** No template choice, QR, A4 invoice or live preview.
6. **The copilot was hidden and reset on every screen.** No floating affordance, no persistent
   history and no server-side AI key boundary.
7. **AI provider key was stored in browser configuration.** That violates the brief's security
   requirement.
8. **No visual system for data density.** Tables, filters and forms were inconsistent between
   modules, and mobile behaviour was mostly a collapsed desktop.
9. **No consolidated report centre.** Reporting was a small card page, not an operational tool.
10. **Missing cross-module polish.** Bin/serial enforcement, approvals, foreign purchasing and
    multi-level BOMs were incomplete or table-stakes only.

## 3. Redesign direction delivered

### Design language
- Midnight navy shell, electric indigo primary, restrained sky/emerald/amber semantics.
- Inter/system typography with tabular numerals for money.
- 14–18 px surfaces, hairline borders, restrained shadows, 120–200 ms motion.
- Light and dark themes, reduced-motion support, print styles.
- Mobile bottom navigation and touch-sized POS controls rather than a shrunken desktop.

### Design system
Tokens for colour, spacing, radii, shadows and typography; reusable buttons, icon buttons, pills,
badges, cards, panels, tables, filters, modals, popovers, segmented controls, empty/error/loading
states, charts (SVG area, donut, sparkline, meter) and an inline icon set.

### Navigation
- Operations, Catalogue & stock, Finance, Insights, People, System.
- Permission-aware items; manager/owner-only modules are filtered server-side and in navigation.
- Branding → Navigation lets an authorized user hide, reorder and preview the sidebar.
- Mobile bottom navigation remains focused on Home, Sell, Stock, Reports and More.

### Dashboard
Real-data KPI cards, previous-period comparison, trend chart, payment mix, best sellers, stock
attention, recent transactions, receivables/payables, branch and date filters.

### POS
Split-screen, search/barcode/camera, categories, product monograms, cart, discounts, tax,
currency, split payments, held sales, serial picker, bin-aware checkout, F2/F4, mobile cart CTA.

### Tables and operations
Search, filters, sorting within modules, compact data tables, row actions, CSV/Excel, print,
pagination where relevant, bulk label printing, stock valuation and reorder alerts.

### Reports
Unified report centre with date/branch filters, sales/payment trends, product/category
performance, stock/expiry, branch comparison and export/print.

## 4. Branding Studio and Receipt Designer

- Application name, business name, tagline, primary/secondary colors.
- Main logo, login logo, favicon/PWA icon upload (under 300 KB data URL).
- Address, phone, email, website, footer and invoice terms.
- Live sidebar and login preview.
- Thermal receipt designer: 58/80 mm, three templates, logo/address/phone/tax/QR toggles,
  auto-print, receipt footer, QR content and live preview.
- A4 invoice designer: live branded invoice, terms, totals, QR, print-to-PDF.
- A4 invoice action on the Sales ledger.
- Navigation studio: hide/reorder items and preview the result.
- All values remain white-label; no brand is hardcoded.

## 5. Copilot

- Floating Copilot button plus top-bar launcher.
- Expandable panel with conversation persistence, clear history, suggestions, typing and mic.
- Confirmation previews and the existing audited action layer; the model never writes records.
- Offline indicator and deterministic rule parser remain fully functional offline.
- Added read-only commands for top sellers and business summaries.
- Online AI is now proxied by the server (`/api/ai/parse`), so the provider key is never in
  frontend configuration. The server uses `GEMINI_API_KEY`/`GEMINI_MODEL`.
- If AI is unavailable, the deterministic parser handles normal commands.

## 6. Remaining gaps / honest limits

- The app is Node/SQLite, not Django/MySQL/PostgreSQL; deployment profiles explain supported paths.
- PWA install icons use the deployment manifest; runtime favicon upload changes the browser icon,
  not the already-installed app icon.
- Thermal ESC/POS receipts do not render the QR or logo raster; browser receipts/A4 do.
- Bank reconciliation is manual statement-line matching, not a bank feed.
- Manufacturing is multi-level by BOM explosion, but work centres/routings are not modelled.
- Approvals cover refunds, voids, expenses, stock adjustments and journals; not every conceivable
  transaction type (for example purchases remain manager-only with no second approval).
- Copilot supports a curated deterministic command set; arbitrary natural language requires the
  optional server AI provider.
- Clover integration and Python WSGI hosting are not implemented because the runtime is Node.
