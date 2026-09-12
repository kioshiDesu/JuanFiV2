# AGENTS.md — JuanFiV2

Coinslot vendo system: ESP firmware (`JuanFi-nodemcu/`) + MikroTik hotspot portal (`hotspot/`) + RouterOS scripts (`README.md` §3–4). No npm/build/test/lint — do not invent commands. Firmware CI lives in `.github/workflows/firmware-release.yml` (push a `v*` tag → compiles ESP8266+ESP32 with pinned cores, zips bins, attaches to the GitHub Release); hardware verification is still compile-in-Arduino-IDE + careful diff review, no test harness.

## Layout

- `JuanFi-nodemcu/JuanFi-nodemcu.ino` — entire firmware, single ~1800-line sketch. Entry points: `setup()`, `loop()`.
- `JuanFi-nodemcu/lan_definition.h` — ESP32-only (`#error` on other boards). W5500 Ethernet wiring/pins.
- `JuanFi-nodemcu/data/admin/` — SPIFFS filesystem image flashed alongside the sketch (`system-config.html`, `voucher-generate.html`, `config/system.data`, `config/rates.data`, `js/`). Portal/admin UI reads these at runtime.
- `hotspot/` — canonical hotspot portal (upload its **contents** to the router's `hotspot` dir), one self-rendering file: `portal.html` holds all UI (login+status+paused views, rates inline table, inline coin/member/QR sections — no modals) and probes `/status` at boot to render the matching view (`?state=` forces one); `login.html` / `status.html` are thin router shells (refresh-timeout + MikroTik vars into `window.*`, CHAP secrets on login, `./assets/js/boot.js` injects the app), `logout.html` is a script-only redirect back to `login` (auto-login lands on status). Edit UI only in `portal.html`. Shared `assets/js/core.js` (`detectState()`/`render()`/`boot()`, focus-mode `showCoinPanel`/`toggleBlock`, 9s failsafe).
- `README.md` §3–4 — canonical RouterOS scheduler/script + hotspot On-Login/On-Logout snippets. Root `NodeMCU-PyFlasher.exe` flashes ESP8266 (FlashFile1 @ 0x000000, FlashFile2 @ 0x200000).
- `.agents/skills/` + `skills-lock.json` are local-only (gitignored). Load `arduino-code-generator` or `platformio` for `.ino` work, `routeros-scripting` for `.rsc`/hotspot scripts.

## Firmware quirks (would break hardware if missed)

- Board select changes code via `#ifdef ESP32`: ESP32 = LAN (W5500, `EthernetWebServer`, `initializeLANSetup()`), ESP8266 = wireless (`ESP8266WebServer`, WiFi STA; falls back to softAP `JuanFiV2 Setup` at `172.217.28.1` when offline). Compile against the matching board.
- `populateSystemConfiguration()` parses `config/system.data` as **positional, 31 `|`-delimited fields**; `populateRates()` parses `rates.data` as `|` rows of `#` columns (`name#price#minutes#validity#dataLimit#profile`). Never reorder/add fields without updating both the parser and `system-config.html`.
- `handleFileWrite()` silently fails if the target file does not already exist in SPIFFS — new config files must ship in `data/` first.
- `sendCommand()` drops MikroTik telnet commands >400 chars. Keep generated RouterOS one-liners short.
- Voucher format is `VOUCHER_PREFIX` (default `1FI`) + 5 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. Portal ↔ firmware flow is `topUp → checkCoin → useVoucher` (`cancelTopUp` aborts); endpoints enforce single-session via `currentActiveVoucher` + `sessionIp`. Preserve the guards: Basic-auth 5-fail/60s lockout, `isValidVoucherCode`/`isValidKickTarget`, `handleFileRead` `..` traversal block, busy-restart refusal in `handleAdminRestart`.

## Previewing the admin UI (no hardware needed)

- Mock server: `node "C:\Users\pisowifi\AppData\Local\Temp\opencode\preview-webadmin.mjs" 8088`, then open `http://localhost:8088/admin`. It serves `data/admin/` and fakes `/admin/api/*` (`dashboard`, `getSystemConfig`, `getRates`, `issuedUsers`); SAVE/kick/generate endpoints reply `ok` without writing. Re-run after editing the HTML — no rebuild.
- Portal preview: `http://localhost:8088/portal/login|status|logout` serves `hotspot/` with `$(vars)` stubbed and `config.js` rewritten so vendo calls hit the mock engine (`/topUp`, `/checkCoin`, `/useVoucher`, `/cancelTopUp`, `/getRates`, `/data/*.txt` with firmware-identical JSON + greedy rate math). Mock coin sessions are keyed by voucher (phone + PC can test concurrently; same-voucher topUp retry is idempotent). Router login sessions are cookie-based: CONNECT (`/portal/done`) opens one with live countdown, pause keeps it, `erase-cookie` clears it. Simulate coins via `http://localhost:8088/mock` (insert ₱1/₱5/₱10 per session, reset).
- Live browser inspection: global `playwright` MCP is installed (`~/.config/opencode/opencode.jsonc`). After a config change, restart opencode, then use its `browser_navigate` / `browser_snapshot` tools on the localhost URL.

## Portal + RouterOS gotchas

- Portal config var is `vendorIpAddress` (with an **o**) in `hotspot/assets/js/config.js` — `README.md` §5 says `vendoIpAddress`, which is stale. Portal calls the vendo over plain HTTP with CORS (`/topUp`, `/checkCoin`, `/useVoucher`, `/cancelTopUp`, `/getRates`, `/health`). Local asset URLs carry `?v=N` — bump it on every portal change or phones keep running stale JS.
- On-Login script `HSFilePath` is `flash/hotspot` on hEX/hAP-ax, `hotspot` on hAP lite. Scheduler/script paste order in `README.md` §3 matters (scripts before schedulers that reference them).
- Hotspot Server Profile → Login tab: enable **HTTP CHAP + HTTP PAP only** (portal uses CHAP when `$(chap-id)` exists, PAP plain-submit otherwise; MAC off, Trial off). Never enable HTTPS login — the page would load over TLS and browsers block its plain-HTTP vendo calls as mixed content, silently killing the coin flow.
- If Keepalive Timeout never logs out idle users: suspect the defconf **FastTrack** firewall rule first (fasttracked hotspot traffic skips idle accounting — accept hotspot traffic before it), then a wrong server profile or a per-user-profile `keepalive-timeout`/`idle-timeout` override. Note the status page's own autorefresh hits count as traffic, so `status-autorefresh` shorter than keepalive keeps sessions alive forever while the page is open.
- Default network is `10.0.0.0/16` (vendo `.254`, router `.1`); defaults `admin/admin` + MikroTik API `pisonet/abc123` must match on both sides.
