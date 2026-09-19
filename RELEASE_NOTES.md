# JuanFiV2 v1 Release Notes

> Release tag: `v1` (commit `b98aede`)  
> Scope: portal-only release. Firmware and release binaries are no longer shipped in this repo; the portal targets the original JuanFi ESP firmware.

## Portal architecture

- Reorganized the repo around a single-file hotspot portal (`hotspot/`) with thin router shells (`login.html`, `status.html`, `logout.html`, `error.html`) and shared `assets/js/core.js`.
- Removed the firmware build/release pipeline and local release bins; kept attribution to the original JuanFi project.
- Boot loader now falls back to XMLHttpRequest when `fetch` is unavailable, so older captive-portal browsers still load the portal.

## Site isolation

- Added serial-based site isolation: the scheduler publishes the board serial to `hotspot/data/site-id.txt`, and the portal scopes storage keys to it.
- Added ESP-MAC site isolation with scoped storage wipe, and a suffix-agnostic cleanup so renames and ESP swaps cannot strand or orphan keys.
- Venue-scoped voucher isolation prevents neighbouring clients from reusing or leaking each other's vouchers.
- Footer shows the effective scope (site tag) for support diagnostics.
- README documents the site-id snippet, including rewriting empty files and ensuring the data directory exists.

## Portal UX

- Truthful loaders, icons, and rate messages (distinguishes empty setup from fetch failures).
- Countdown UI: segmented day/hour/min/sec boxes, urgency tints, low-time notices, and no clipping on narrow phones.
- Relative expiry formatting and Wi-Fi Rates table styling (centered, gridlines, dark bold header, peso-sign numeric extraction).
- Dot status pill (Offline / Connected / Paused), left-aligned brand, wrap-safe header, and per-site branding via `config.js`.
- Verifying toast replaces the notice box; coin panel moves in place without reflow.
- File-based sounds with a per-coin sting; synth chimes removed.
- Wi-Fi rates stay fully lit under the coin-focus veil.

## Reliability and coin flow

- Explicit AJAX timeouts (router-local 3000ms, vendo 5000ms), XHR guards, and no-timeout polling where appropriate.
- Voucher POST bodies are URL-encoded.
- Auto-login fresh voucher after Done instead of reload.
- Fixed double-topUp on timeout and faster coin reveal on login.
- Handle transient `coin.is.reading` and abort races in `checkCoin`.
- Cancel with coins now confirms forfeiture, always sends `/cancelTopUp` to release the ESP slot, and resets the counter.
- Wait-expiry with coins now auto-finalizes via the same `/useVoucher` path as Done instead of reloading and hoping.
- Success toast + blip deduped per coin total.
- Dead storage flags removed (`ignoreSaveCode`, `insertCoinRefreshed`, stored `totalCoinReceived`); keys remain in the wipe/migration lists so residue still cleans up.
- Stray `console.log`s routed through the gated debug buffer; `portalDebug` controls console output.
- Leading space fixed in `secondsToDhms` output.

## Versioning

- `PORTAL_VERSION = "1"` in `config.js` is the single source of truth and is rendered as a subtle footer tag.
- All first-party `?v=` URLs are unified to `?v=1`; vendored libs stay pinned at `?v=26`.
- Release flow: bump `PORTAL_VERSION`, mirror it into the `?v=` URLs, commit, tag (`v1`, `v2`, `v1.1`), push + push tag.
