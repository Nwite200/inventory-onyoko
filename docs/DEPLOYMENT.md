# Deployment Guide

OpenPOS is a **React PWA + Node/SQLite sync server**. It is not a Django/WSGI application.
This matters when choosing hosting: cPanel "Python app" installers cannot run this backend, and
MySQL/PostgreSQL are not used by the server.

## 1. Supported profiles

### A. Standalone device (no server)

```bash
npm install
npm run build
# serve dist/ over HTTPS (or localhost)
```

Suitable for one till/one phone. Data lives in IndexedDB on that device. Back up with
**Settings → Download full backup**.

### B. Local shop network (recommended for shops)

Run the Node server on one shop computer and open it from other devices on the same Wi-Fi.

```bash
npm run build
node scripts/make-cert.mjs        # optional but required for camera/voice/PWA on LAN
AUTH_SECRET=... PORT=8787 DB_PATH=./data/openpos.db node server/index.ts
```

The server serves the app and the sync API on one port, with SQLite in `DB_PATH`.
Devices use `https://<server-ip>:8787` (or the plain-http setup page at `:8788` to install the
certificate). The app's per-device shop is selected in Settings.

### C. VPS / hybrid cloud

Run the same Node server behind Caddy or nginx on a VPS. Give it a real certificate. Devices can
work offline; when connectivity returns, the change log synchronizes. Use Cloudflare DNS/CDN for
the HTTPS front door and Cloudflare Tunnel if the server is on a shop network without a public IP.

**Do not deploy the Node/SQLite server as a Cloudflare Worker.** It requires a persistent SQLite
file and a conventional Node runtime. Cloudflare can front the server but not replace it without a
data-layer rewrite.

### D. Docker

```bash
docker compose up -d
```

Mount a volume for `/app/data` so SQLite survives container recreation. Set `AUTH_SECRET`,
`ADMIN_USER`, `ADMIN_PASSWORD`, `APPROVAL_THRESHOLD`, `GEMINI_API_KEY`, `GEMINI_MODEL` in the
environment.

## 2. Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 8787) |
| `DB_PATH` | SQLite file path |
| `AUTH_SECRET` | HMAC signing secret (generated and stored if omitted) |
| `ADMIN_USER` / `ADMIN_PASSWORD` | bootstrap first platform owner |
| `BUSINESS_NAME` | first tenant name |
| `APPROVAL_THRESHOLD` | base-currency amount above which refunds, voids, expenses, adjustments and journals need approval |
| `GEMINI_API_KEY` | server-side AI provider key (never sent to browsers) |
| `GEMINI_MODEL` | optional model override |
| `CORS_ORIGIN` | restrict cross-origin API access |

## 3. Backups

- Stop writes or use SQLite's online backup; copy the `DB_PATH` file plus `-wal`/`-shm` if present.
- Device data is in IndexedDB; Settings → Download full backup exports all local tables and config.
- Back up uploaded logos and `dist/config.json` alongside the database.
- Test a restore on a separate copy before relying on it.

## 4. PWA / HTTPS

Service workers, camera scanning, microphone, install prompts and direct printing require a
secure context (HTTPS or localhost). On a LAN, use the generated certificate or a real domain.
The app displays a clear banner on plain HTTP instead of failing silently.

## 5. White-label deployment

- Edit `public/config.json` for deployment defaults (name, colour, currency, locale, server URL).
- Or configure everything in **Branding & receipts** on a device and export `config.json`.
- Logo/favicon are stored as data URLs in the device configuration; keep them under 300 KB.
- The installed PWA icon is controlled by the manifest at build/deploy time; the runtime favicon
  upload updates the browser icon, not an already-installed home-screen icon.

## 6. What is not supported

- Django/WSGI, MySQL or PostgreSQL without rewriting the server's data layer.
- cPanel Python hosting for this backend. A cPanel deployment can host only the static PWA while
  the Node API runs elsewhere.
- Cloudflare Workers for the Node/SQLite server.
- Clover hardware integration (no adapter is included).
- Silent direct printing on iPhone/Safari; use the browser print dialog or RawBT on Android.

## 7. Health and rollback

- Health check: `GET /api/health`.
- Platform metadata: `/api/admin/overview` (platform owner only).
- Roll back the previous `dist/` and server build together. Client Dexie migrations are additive
  (v5–v7); they do not delete data. If rolling back to a build that does not know a newer table,
  the extra IndexedDB stores are simply unused.
- Keep a database copy before upgrading.
