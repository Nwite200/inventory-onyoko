# OpenPOS

An offline-first, white-label point of sale, inventory and accounting platform (React + TypeScript
PWA + Node/SQLite sync server). All code is original; it is a clean-room build, not a copy of any
existing POS.

See `docs/AUDIT.md` for the architecture review, `docs/UI-UX-AUDIT-2026.md` for this redesign,
`docs/PHASE-1-REPORT.md` and `docs/PHASE-5-8-REPORT.md` for delivery notes, and
`docs/DEPLOYMENT.md` for hosting. Screenshots: `docs/screenshots/`.

## Run it

```bash
npm install
npm run dev        # development
npm test           # 272 tests (264 pass, 8 environment-dependent skips)
npm run get-model  # one-time: install the offline speech model (about 100 MB) for on-device voice
npm run build      # production build in dist/ (installable PWA)
npm run preview    # serve the production build
```

Open the app, go to **Settings → Load demo data**, then try the **Assistant** icon in the top bar.

## Latest build

- **Premium application shell** — deep-navy sidebar, indigo accent, inline SVG icons, light/dark
  themes, command palette (`⌘K`), branch selector, notification centre, mobile bottom navigation.
- **Business dashboard** — net sales, gross/net profit, cash position, payment mix, best sellers,
  low stock, receivables/payables and recent tickets from real local data, with range and branch
  filters and dependency-free SVG charts.
- **Rebuilt POS** — category filtering, held sales, cart discounts (% or amount), cash/change,
  payment methods, F2/F4 shortcuts, mobile cart CTA and a redesigned receipt. Sale lines capture
  the cost at sale time so profit is historically accurate.
- **Refund integrity** — refunds cannot exceed what was sold (including earlier refunds), voided
  sales are refused, restock movements are idempotent, and the server re-checks the same rules.
- **Double-entry accounting** — chart of accounts, automatic balanced postings from sales,
  purchases, supplier payments, expenses, refunds and stock adjustments, manual journals with
  validations and reversals, trial balance, profit & loss, balance sheet, account ledger and CSV
  export. Accounting/expenses are hidden from cashiers.
- **New reporting centre** — sales trend, payment mix, product and category performance, stock and
  expiry, branch comparison, CSV/print, and explicit sync status on the figures.
- **Sync coverage** — expenses, refunds, cash-register shifts and journals now sync; retries are
  idempotent; cashiers never receive cost prices, expenses or journals.
- **Catalogue and sales screens** — searchable/filterable product catalogue with inline pricing,
  stock adjustments and batches; full sales ledger with filters, receipts, voiding and CSV.
- **Serial-enforced POS** — products can require a serial for every unit; the till blocks a sale without one, and voids/refunds return or damage the exact serial.
- **Bin-enforced picking** — managers can require products with binned stock to be sold from those bins; the till blocks an over-pick and records the bin source.
- **Server-verified approvals** — set `APPROVAL_THRESHOLD` on the server; refunds and voids above it are rejected unless an approved request from a manager exists.
- **Foreign-currency purchasing** — receive goods in a configured currency; costs, stock valuation and payables are stored in base currency with the foreign amount retained.
- **Advanced operations suite** — warehouse bins and picking, serial numbers, multi-component BOMs
  and production orders, fixed assets with straight-line depreciation, budgets with variance,
  payroll and payslips, currency rates, tax rules, bank reconciliation and an approval queue.
- **Documents and credit** — quotations and sales orders with conversion to sales, customer
  payments allocated to invoices, and printable customer statements.
- **POS upgrades** — split payments, tax-inclusive/exclusive totals, foreign-currency tenders and
  a camera barcode scanner with manual fallback.
- **Platform administration** — a separate super-owner workspace for tenant metadata, sync volume,
  health and audit events, never exposing tenant business data.
- **Branding & receipts studio** — application/business identity, logos, colors, contact details,
  navigation customization, live thermal receipt (58/80 mm, three templates), QR codes and an A4
  invoice designer with print-to-PDF. A4 invoices can be printed from the sales ledger.
- **Copilot** — floating assistant, persistent conversation, suggestions, offline indicator,
  deterministic commands for sales/stock/purchases/transfers/reports, confirmation previews and
  audit logging. Online reasoning is proxied by the server so provider keys never reach the browser.
- **Navigation studio** — hide, reorder and preview sidebar items, with permission-aware filtering.
- **Dedicated categories, branches and employees screens** — plus quotations and stock transfers in
  primary navigation.
- **Extended approvals** — refunds, voids, expenses, stock adjustments and journals all support the
  threshold/approval queue, enforced locally and by the server where the amount is known.
- **Exports** — CSV, Excel (`.xls`) and print-to-PDF across sales, reports and accounting.

## What works today

- **Offline-first:** all data lives in the browser (IndexedDB). Selling, stock, reports work with no internet. The app shell is cached by a service worker, so it opens offline after the first visit.
- **POS:** product search, barcode-scanner support (scanner types the code + Enter), cart, customers, payment type, receipts (print-friendly), void sales (stock returns).
- **Inventory:** products with aliases and low-stock alerts; stock changes are recorded as movements, never overwritten.
- **Reports:** today / 7 days / 30 days, top sellers, low stock.
- **Roles:** cashier / manager / admin permissions (see "Security" below).
- **Purchases and suppliers:** receive goods from a supplier into a shop (stock goes up, the unit cost updates the product), record what you paid and what you still owe, pay later, cancel a purchase. Cashiers never receive prices, suppliers or purchases.
- **Several shops:** products are shared, stock is counted per shop. Each device belongs to one shop (Settings > Shops; the owner adds shops). Reports can show this shop or all shops.
- **Transfers between shops:** sending takes the goods out of the sending shop at once; the receiving shop adds them only when someone taps "Goods arrived", so nothing is counted twice or lost in transit.
- **Receipt printing:** the normal print dialog (58/80 mm), or straight to a USB, serial or Bluetooth LE receipt printer with ESC/POS, or through the RawBT app on Android (for the many cheap classic-Bluetooth printers). Cut, cash-drawer kick, address/phone/footer, automatic print after a sale.
- **Expiry dates and batches:** when receiving goods you can enter a batch number and expiry date; batches can also be added by hand (Products). Reports lists what has expired or expires in 30 days, the till marks products with expired stock, and you can ask "What's expiring?". How much of a batch is left is worked out from stock, assuming the oldest batch sells first.
- **Barcode labels:** Products > Print barcode labels. Code 128 barcodes on a sheet (label size and labels per row are adjustable) or on the receipt printer. The sheet's barcodes were decoded back from a browser-rendered page; physical scanners and printed paper were not tried.
- **Languages:** English, Hausa, Yoruba, Igbo and Nigerian Pidgin for the main screens (Settings > Language). The four Nigerian-language texts were written by an AI and have not been checked by native speakers; correct them in `src/i18n.ts`. Some less-used screens are still English only.
- **Several businesses on one server:** the first admin is the server owner and can open separate businesses (Settings > Businesses), each with its own admin, staff, products and sales. Businesses cannot see or change each other's data or accounts (covered by tests). Signing in to a different business on the same device clears that device's local data first.
- **Passwords:** everyone can change their own password (Settings); the owner can reset anyone's. Changing or resetting signs that account out of every other device.
- **White-label:** name, tagline, colour, currency, locale, language, feature switches and presets (Settings), or ship a `public/config.json` per deployment.
- **Voice assistant** (type or speak). Examples:
  - "Sell two bags of rice to Mama Ade, cash"
  - "Add fifty cartons of Indomie to stock"
  - "How many coke do I have left?" / "What's running low?" / "What did I sell today?"
  - "Change the price of sugar to 1,500"
  - Managers/owners can also say: "Received 20 bags of rice from Dangote at 41,000 each, paid 500,000" (or "on credit" / "paid in full"), "How much do I owe?" / "How much do I owe Dangote?", "Pay Dangote 100,000", "Transfer 5 bags of rice to Ikeja branch", "Transfer arrived". Cashiers are refused these. Payments and transfers cannot be undone by voice (use the Purchases / Transfers screens); a purchase can ("undo" cancels it).
  - Reads are instant. Sales, stock additions and price changes are **read back and need "yes"/Confirm**. "Undo" works for 60 seconds. Every command is written to an audit log.
  - Commands are understood by an offline rule-based parser; products are matched fuzzily ("indomie" → "Indomie Noodles Carton"), and it asks "Did you mean A or B?" when unsure.
- **Optional smart fallback** for unusual phrasing: local Ollama (offline) or Google Gemini free tier (online). Its output is validated and still goes through confirmation.

## Server, logins and multi-device sync

A small Node server (`server/`) keeps every device in step. It uses Node's built-in SQLite, so there is nothing else to install.

```bash
npm run build          # builds the app into dist/
npm run server         # serves the app AND the API on http://localhost:8787  (Node 22.18+)
```

Open it (https://localhost:8787 if you made a certificate, otherwise http://localhost:8787), and the first visit asks you to create the owner (admin) account. Then, in **Settings**, add staff accounts and set the server address on each device (the login screen has a "This website" button).
Or with Docker: `docker compose up -d` (data is kept in a volume).

- **Offline still works.** Sales are saved on the device first and sent when the connection is back. A device that was offline catches up on its own.
- **Real roles.** Roles come from the account and are enforced **on the server**: a cashier can sell but cannot push price, stock or product changes, even with a modified app, and does not receive cost prices. A cashier can void only their own sale made in the last 5 minutes (this is what voice "undo" needs). Sign-ins are rate-limited; disabling an account cuts that device off at its next sync.
- **Two devices selling the same stock** both end up correct, because stock is recorded as events (+10, -2...) and added up, never overwritten. Retries never duplicate anything. For prices, the latest change wins.
- Set `AUTH_SECRET`, `ADMIN_USER`/`ADMIN_PASSWORD`, `PORT`, `DB_PATH`, `APPROVAL_THRESHOLD` (base-currency amount above which refunds/voids need an approved manager request) as environment variables if you need to.
- **HTTPS on the shop network** (needed for voice, offline voice, app install and direct printing on other devices):
  1. On the server computer run `node scripts/make-cert.mjs` once (needs `openssl`; add your server's address if it is not detected, e.g. `node scripts/make-cert.mjs 192.168.1.20`). Restart the server: it now serves **https** on the main port, and a plain-http page on the next port (8788) with the certificate download and step-by-step install for Android, iPhone, Windows, Mac and Firefox.
  2. On each device open `http://<server>:8788`, install the certificate, then open the https address.
  The browser warns "not secure" until the certificate is installed; the app shows a clear banner on plain-http addresses instead of silently failing. On the internet, use Caddy or nginx with a normal certificate instead.

## Offline voice (works with no internet)

The assistant can understand speech **on the device itself** (OpenAI's Whisper model running in the browser). Nothing you say leaves the device, and it works with the internet off.

1. On the machine that runs the server, once: `npm run get-model` (downloads about 100 MB from GitHub; or `npm run get-model -- --archive FILE.tar.bz2` if you copied the file over). Then `npm run build` and restart. With Docker this happens during `docker compose build`.
2. On each phone/tablet/PC: open **Settings > Voice** and tap **Download offline voice** once (the server sends the model, so a shop network is enough; no outside internet needed). After that it works offline.
3. Tap the microphone and speak. **Automatic** mode uses the browser's online voice when connected (more accurate) and switches to on-device voice when offline; you can force either in Settings.

How it works: it listens until you pause, then the model writes down what you said. Your product and customer names are given to the model as a hint, so it spells "Indomie" and "Mama Ade" correctly. If the model is unsure (noise, mumbling) it says it could not hear you instead of guessing. Every action still needs your "yes".

- **Speed:** about 2.5 seconds from when you stop speaking to the answer (measured in a desktop browser; phones will differ).
- **Better with accents:** `npm run get-model -- base.en` installs a larger model (slower, usually more accurate). Not tested here.
- **Needs https.** Browsers only allow the microphone and offline storage on secure pages (https, or localhost on the same computer). See "HTTPS on the shop network" above. Tested: a page on a LAN address is refused without the certificate and works with it, and offline voice ran end to end over it.

## Honest limitations (read these)

1. **Offline voice has not been tested on real people.** I tested it with computer-generated voices (4 different ones) and a real browser with a simulated microphone, where it understood the sell, add stock, price and stock-check commands. Real Nigerian accents, background noise in a busy shop and cheap phone microphones are the unknown. The model is English only. Please try it and tell me what it mishears; the hint and the name matching can be tuned from real examples.
   Also untested: **Firefox, Safari and real phones.** No such browser could be run where this was built. What was done instead: the code was checked to avoid features that older Safari/Firefox cannot load (a test fails if one is added back). Two such problems were found and fixed: regex lookbehind, which stops Safari before 16.4 from loading the app at all, and `structuredClone` / `crypto.randomUUID`, missing on older iPhones and on plain-http pages (the app could not create a sale there). Chromium was also run with speech recognition, USB/serial/Bluetooth and those functions removed, with a Firefox user-agent, over https and plain http: no errors, and the microphone explains itself. That does **not** test rendering differences or Safari/Firefox's own audio and storage behaviour. Firefox has no browser speech recognition, so there the on-device model is the voice path; it should work but has not been tried.
2. **Selling more than exists:** if two offline devices together sell more than the real stock, the server accepts both (the sales really happened) and stock goes negative on every device. Check the Reports > Running low list. This is the right trade-off for a shop, but you should know it.
3. **Sync is not instant.** Devices pull every 30 seconds (and right after their own changes), not live.
4. **Without a server** the Cashier/Manager/Admin switch is only a convenience; anyone using that device can change it.
5. A device that stays offline with unsent changes after its account is disabled loses those changes (they are refused).
6. The Ollama and Gemini adapters (`src/voice/llm.ts`) are untested against the live services. Check the model names in Settings.
7. **Receipt printing is tested against a decoder and simulated printers, not real hardware.** The receipt layout and commands are verified byte by byte, and the USB, serial, Bluetooth LE and RawBT code was exercised with simulated devices, but no real printer was available. Try "Print test page" first. Direct USB/serial/Bluetooth printing works only in Chrome/Edge, over https. Bluetooth LE only finds printers that use one of the common printing services (listed in `src/printing/transport.ts`); a printer that does not show up should be used through RawBT or the normal print dialog. The RawBT hand-off follows RawBT's published `rawbt:` link format; Android may want a tap on the page before it opens RawBT, so if a receipt does not print by itself after a sale, tap "Print receipt". iPhone: only the normal print dialog (Safari has no USB/serial/Bluetooth access).
8. **Shops:** a device's shop is chosen by a manager/owner in Settings (cashiers see it but cannot change it). The server does not check that a "Goods arrived" tap came from the receiving shop's device; it checks that the transfer was really sent and uses the quantities that were sent.
9. A change the server refuses (for example a cashier's stock adjustment) is taken back out on that device, and recorded in the audit log.
10. Voice for purchases, suppliers and transfers works for the phrasings above (tested with typed text through the same parser; real accents and unusual wording are untested like the rest of voice). Anything it does not understand is simply not done, and every action is read back and needs "yes".
11. Expiry batches record only quantity and date; there is no per-batch selling (the oldest is assumed sold first). Voice cannot add batches. Business names and users are managed by the server owner only; there is no way to delete a business yet.
12. **Accounting is derived and consolidated.** Sales, purchases, expenses and refunds post automatically and always balance. Manual journals are business-wide (they are not allocated to a branch). Voided sales/purchases are excluded rather than reversed with a credit note, and supplier refunds/customer payment allocation are not yet modelled.
13. **Refunds** are limited to the quantity sold and are re-checked on the server, but there is no separate manager approval step. Refund totals use the line price; a discount is not apportioned back across returned lines.
14. **Advanced modules are deliberately scoped.** Bin picking is enforced only when the manager turns on the policy; serial tracking is enforced only for products marked “Track serial numbers”; manufacturing is single-level; payroll uses flat percentages; multi-currency covers POS tenders and purchases (not expenses); bank reconciliation uses manual statement lines; PDF is print-to-PDF and Excel is an HTML `.xls` workbook. Server-verified approvals apply when `APPROVAL_THRESHOLD` is set; without it the local policy is off.
15. **Platform admin** shows tenant metadata only and can create businesses. It does not yet include subscription billing, background task control or backup restore. It appears only when signed in to a server as the platform owner.

## Deploying for a client

1. Edit `public/config.json` (name, colour, currency…) or set it in Settings and use "Download config.json".
2. Easiest: run the server (above) on a small VPS or a PC in the shop with Docker. For one device only, `npm run build` and host `dist/` on any static host over HTTPS (needed for the PWA and microphone).

Receipt, purchase and transfer numbers include a short code for the device that made them (for example `INV-20261110-K7F-0003`), so two tills never print the same number.

## Layout

```
src/db.ts          IndexedDB schema (Dexie)
src/actions.ts     every state change (screens and voice both call these)
src/analytics.ts   reporting queries (pure, tested)
src/accounting.ts  double-entry posting and financial statements
src/returns.ts     refund rules and idempotent restocking
src/sync.ts        push/pull with the server
src/syncApply.ts   applies other devices' changes safely
src/auth.ts        client login
server/            Node + SQLite API: accounts, roles, change log
src/voice/         parser, matcher, agent, LLM fallback, speech
src/screens/       Dashboard, POS, Products, Sales, Returns, Purchases, Inventory,
                   Contacts, Expenses, Accounting, CashRegister, Reports, Settings
src/components/    inline SVG icons and dependency-free charts
src/purchases.ts   suppliers and purchases
src/transfers.ts   moving goods between shops
src/location.ts    shops; src/stock.ts is the one place stock numbers change
src/printing/      ESC/POS encoder, receipt layout, USB/serial/Bluetooth/RawBT transports
docs/              audit, delivery report, screenshots
```
