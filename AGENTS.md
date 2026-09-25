# AGENTS.md — JuanFiV2 Hotspot Portal

MikroTik hotspot portal (`hotspot/`) + RouterOS scripts (`README.md` §Scripts), tested against original JuanFi ESP firmware. No npm/build/test/lint — do not invent commands. No firmware in this repo (releases + `JuanFi-nodemcu/` removed); hardware verification is careful diff review, no test harness.

## Layout

- `hotspot/` — canonical hotspot portal (upload its **contents** to the router's `hotspot` dir), one self-rendering file: `portal.html` holds all UI (login+status+paused views, rates inline table, inline coin/member sections — no modals) and probes `/status` at boot to render the matching view (`?state=` forces one); `login.html` / `status.html` are thin router shells (refresh-timeout + MikroTik vars into `window.*`, CHAP secrets on login, `./assets/js/boot.js` injects the app), `logout.html` is a script-only redirect back to `login` (auto-login lands on status). Edit UI only in `portal.html`. Shared `assets/js/core.js` (`detectState()`/`render()`/`boot()`, focus-mode `showCoinPanel`/`toggleBlock`, 9s failsafe).
- `README.md` §Scripts — canonical RouterOS scripts, labeled A–F in paste order (On-Login/On-Logout, site publisher, portal upload).
- `.agents/skills/` + `skills-lock.json` are local-only (gitignored). Load `routeros-scripting` for `.rsc`/hotspot scripts.

## Vendo API quirks (would break the coin flow if missed)

- Portal ↔ vendo flow is `topUp → checkCoin → useVoucher` (`cancelTopUp` aborts). Voucher codes are issued by the vendo firmware (e.g. `VCxxxxxx` on the original firmware) — the portal passes them through opaquely, never assume a prefix.

## Previewing the portal (no hardware needed)

- Mock server: `node "C:\Users\pisowifi\AppData\Local\Temp\opencode\preview-webadmin.mjs" 8088`, then open `http://localhost:8088/portal/login|status|logout`. with `$(vars)` stubbed and `config.js` rewritten so vendo calls hit the mock engine (`/topUp`, `/checkCoin`, `/useVoucher`, `/cancelTopUp`, `/getRates`, `/data/*.txt` with firmware-identical JSON + greedy rate math). Mock coin sessions are keyed by voucher (phone + PC can test concurrently; same-voucher topUp retry is idempotent). Router login sessions are cookie-based: CONNECT (`/portal/done`) opens one with live countdown, pause keeps it, `erase-cookie` clears it. Simulate coins via `http://localhost:8088/mock` (insert ₱1/₱5/₱10 per session, reset).
- Live browser inspection: global `playwright` MCP is installed (`~/.config/opencode/opencode.jsonc`). After a config change, restart opencode, then use its `browser_navigate` / `browser_snapshot` tools on the localhost URL.

## Portal + RouterOS gotchas

- Portal config var is `vendorIpAddress` (with an **o**) in `hotspot/assets/js/config.js` — `README.md` §Scripts-F says `vendoIpAddress`, which is stale. Portal calls the vendo over plain HTTP with CORS (`/topUp`, `/checkCoin`, `/useVoucher`, `/cancelTopUp`, `/getRates`, `/health`). Local first-party asset URLs carry `?v=N` (no version var — `PORTAL_VERSION` was removed as redundant) — bump the query on every portal change or phones keep running stale JS. Vendored libs (bootstrap/jquery/md5) stay pinned at `?v=26`.
- On-Login script `HSFilePath` is `flash/hotspot` on hEX/hAP-ax, `hotspot` on hAP lite. Script paste order in `README.md` §Scripts (A→F) matters (scripts before schedulers that reference them).
- Hotspot Server Profile → Login tab: enable **HTTP CHAP + HTTP PAP only** (portal uses CHAP when `$(chap-id)` exists, PAP plain-submit otherwise; MAC off, Trial off). Never enable HTTPS login — the page would load over TLS and browsers block its plain-HTTP vendo calls as mixed content, silently killing the coin flow.
- If Keepalive Timeout never logs out idle users: suspect the defconf **FastTrack** firewall rule first (fasttracked hotspot traffic skips idle accounting — accept hotspot traffic before it), then a wrong server profile or a per-user-profile `keepalive-timeout`/`idle-timeout` override. Note the status page's own autorefresh hits count as traffic, so `status-autorefresh` shorter than keepalive keeps sessions alive forever while the page is open.
- Default network is `10.0.0.0/16` (vendo `.254`, router `.1`); defaults `admin/admin` + MikroTik API `pisonet/abc123` must match on both sides.
- Standing rule before every push: restore `hotspot/assets/js/config.js` to the committed BROBRO defaults (`git checkout -- hotspot/assets/js/config.js` if dirty). Per-site branding (e.g. homeowner names) must never be committed — customize on the router copy only.
