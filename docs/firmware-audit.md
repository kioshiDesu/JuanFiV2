# JuanFiV2 Firmware Audit — 2026-09-10

Scope: `JuanFi-nodemcu/JuanFi-nodemcu.ino` (~1,943 lines), `lan_definition.h`,
`data/admin/` web UI. Ran as security + quality audits; Critical items below
were spot-verified against the code. Original project: JuanFi by Ivan Julius
Alayan — this fork (JuanFiV2, kioshiDesu) keeps full attribution (see README).

## Critical (fix first)

1. **MikroTik login failure masked as success** — `.ino:574-581`
   `else { mikrotekConnectionSuccess = true; }` hides failed logins; vendo
   accepts coins with no router link. Fix: keep `false`, show error on LCD,
   refuse coins.
2. **OTA upload completion has no auth check** — `.ino:361-383` vs `:389`
   Only the upload-start handler checks `isAuthorized()`; the completion
   handler that runs `Update`/restart doesn't. Fix: enforce auth in both +
   CSRF token.
3. **Default creds shipped + leaked** — `.ino:144-145`, `system.data:1`
   `pisonet`/`abc123` and `admin`/`admin` in repo; `GET /getSystemConfig`
   returns passwords verbatim; `isAuthorized()` (`.ino:790-800`) prints
   expected credentials to serial. Fix: no shipped defaults, never return
   passwords via API, remove credential logging.
4. **`split()` has no bounds check** — `.ino:1432-1449`
   `rows[count]` never validated against array size; malformed
   `system.data`/`rates.data` corrupts memory. Fix: pass capacity, stop at cap.
5. **Stack buffers sized by HTTP input** — `.ino:1126-1129,1268-1274`
   `char buf[voucher.length()+1]` from `server.arg()` can blow the ~4KB
   ESP8266 stack. Fix: length cap + fixed buffer with `snprintf`.

## High

6. **RouterOS command injection** — `.ino:1211-1274`
   Voucher/prefix/profile concatenated into `/ip hotspot user add` with no
   sanitization. Fix: allowlist `^[A-Z0-9]{1,12}$`.
7. **Unauthenticated coin/voucher APIs, spoofable MAC ban** — `/topUp`,
   `/checkCoin`, `/useVoucher` open; ban key is client-supplied `mac`.
   Fix: bind to session/IP + rate-limit.
8. **Open setup AP, no WPA2** — `.ino:287-292` plus wildcard-DNS captive
   portal. Fix: WPA2 with unique per-device password; kill AP after setup.
9. **Heap fragmentation from `String`** — pervasive `+=`/`concat()`;
   expect OOM reboots on ESP8266. Fix: `reserve()`, `char[]`+`snprintf`.
10. **Predictable vouchers** — no `randomSeed()` anywhere;
    `PREFIX+random(1000,9999)` ≈ 9k space, repeats every boot.
    Fix: seed + longer alphabet.
11. **Basic-auth over plaintext HTTP, no lockout** — every admin AJAX sends
    creds on port 80. Fix: session cookie + lockout.

## Medium and below

- Stored XSS in admin UI (`innerHTML` with rate/voucher names).
- Wildcard CORS + state-changing GETs.
- Unrestricted SPIFFS file serve.
- 30 s blocking `delay()` in fault path (WDT reset loop).
- `millis()` truncated into `int`.
- EEPROM wear from 3 commits/sale.
- 1,943-line monolith with `goto` and 6× duplicated LCD blocks.

## Suggested order

**#1 → #2 → #4 → #3 → #6** — all small, all high-impact.

## Completed removals (2026-09-10, uncommitted)

- LCD display support removed: `LiquidCrystal_I2C` include/objects,
  `LCD_TYPE`, `initializeLCD()`, all `print*` LCD functions,
  `startCenterIndex()`. Kept: thank-you cooldown timing (`lastSaleTime`),
  insert-button manual-voucher logic, coin-debounce `goto` label.
  Config pipe format unchanged (slots 15/19 ignored, admin UI sends
  defaults). `LiquidCrystal_I2C` library no longer required to compile.
- Charging-station + e-load removed from 4.3 and v3.3 portals: buttons,
  modals, `eload.js` (deleted), charging/eload JS, config flags, and the
  dead Rate-Type→Charging option (firmware never read `rateType`).
  Normal voucher top-up flow untouched and verified (`node --check` clean,
  all firmware error codes still mapped).
