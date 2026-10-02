---
name: security-review
description: Use this skill when touching RouterOS scripts (.rsc), the ESP8266 firmware's /admin routes, the hotspot portal, or anything holding credentials. Covers RouterOS policy scoping, admin auth, firmware upload, and brand-HTML sanitising.
metadata:
  origin: ECC
  retargeted: JuanFiV2 hotspot portal
---

# Security Review — JuanFiV2 Hotspot Portal

Review checklist for this repo. Replaces the stock Next.js/Supabase/web3 checklist,
none of which applies here. **There is no npm, no database, no cloud provider, and
no test harness** (see `AGENTS.md`) — do not propose `npm audit`, coverage targets,
RLS policies, or a package-lock review.

## When to Activate

- Editing `juanfi-setup.rsc`, `OnLogin.txt`, `OnLogout.txt`
- Editing `firmware/JuanFi-nodemcu.ino` (admin auth, upload handler, credentials)
- Editing `hotspot/portal.html` or `hotspot/assets/js/core.js` (DOM sinks, HTTP calls)
- Editing `hotspot/settings.json` (holds `vendorIpAddress` and per-site branding)

## Threat model for this project

Everything is **plain HTTP on a private APIPA subnet** (`10.0.0.0/16`, router `.1`,
vendo `.254`). There is no TLS anywhere in the portal path — and there must not be,
see the mixed-content rule below. Consequences:

- HTTP Basic auth on the firmware admin panel sends credentials as **base64, not
  encryption**. Any device on the WLAN can replay them. Treat admin creds as
  "trusted LAN only" and say so plainly; do not claim Basic auth is secure here.
- The MikroTik API password defaults to `pisonet/abc123` and the firmware defaults to
  `admin/admin` (`AGENTS.md`). Both are public knowledge. Changing them is part of
  every install, so verify they were, or state that they were not.

## 1. RouterOS script policy scoping — highest-value check

RouterOS scripts run with a `policy=`. Over-broad policy is the most common real
defect in `.rsc` files.

- **`juanfi-setup.rsc:11`** and **`:163`** both use
  `policy=read,write,test,policy,ftp`.
  - `policy` is **not** needed by this script's logic. It grants read access to
    `/policy`, which returns every configured password in cleartext over the API.
    Unless the script genuinely reads `/policy`, **drop `policy`**.
  - `test` is legitimately required — `:126` checks
    `[:len [/ip hotspot active find user=$name]]`, which is a `test` action.
  - `ftp` is required for `/file` operations; keep only if the script writes files.
- Same check applies to any new `/system scheduler add` — the scheduled entry
  inherits its own policy and is an independent grant. Auditing the script but not
  the scheduler misses the persistent copy.

## 2. Firmware admin panel (`firmware/JuanFi-nodemcu.ino`)

- **`:345`** registers `handleFileUploadRequest, handleFileUploadStream` on
  `POST /admin/updateMainBin`. An unauthenticated or weakly authenticated path
  here is **arbitrary flash write**, i.e. remote code execution. Confirm
  `isAuthorized()` (`:389`, `:585`) gates it, and check upload size and extension
  bounds before the write.
- **`:103-104`** `ADMIN_USER` / `ADMIN_PW` and **`:148`** `adminAuth`.
  **`:573`** carries the comment `//PUT HERE YOUR USERNAME/PASSWORD` — verify no real
  credential was committed above it.
- **`:334-344`** exposes 14 `/admin/*` routes. List them and confirm each sensitive
  one (`saveSystemConfig`, `saveRates`, `resetStatistic`, `generateVouchers`,
  `logout`) is behind `isAuthorized()`.
- **`:553-554`** is HTTP Basic via `WWW-Authenticate`. No session, no expiry, no
  lockout. Note it as accepted risk on a trusted LAN, not as a pass.

## 3. Hotspot login must stay plain HTTP

Enabling HTTPS login on the Hotspot Server Profile loads the portal over TLS, and
browsers then block the portal's plain-HTTP calls to the vendo as **mixed
content** — which silently kills the coin flow (`AGENTS.md`). This is the single
easiest way to break the product, and it presents as "the coin insert does
nothing". If a review suggests hardening the portal with HTTPS, that is a **revert**,
not a fix. Also confirm only `http-chap` and `http-pap` are enabled, and that MAC
login and Trial are off.

## 4. Voucher codes are opaque

Voucher codes are issued by the vendo firmware (e.g. `VCxxxxxx`) and the portal
passes them through opaquely. **Never validate against a prefix or a regex**, and
never assume a length. A prefix check added "for safety" will reject valid codes
when the firmware changes. Any client-side voucher validation is a UX affordance
only — the vendo is the sole authority on whether a code is real.

## 5. DOM injection in the portal

There is exactly **one** genuine injection sink worth arguing about, and it is
already handled:

- `core.js:1161-1173` `brandSafe()` parses `brandHeaderHtml` into a detached
  `<div>`, then walks `childNodes` allowing only text nodes and `<em>`, stripping
  every other element. Used at `:1176` via `$("#brandHeader").html(...)`.
  This is correct. Preserve the whitelist when touching it — do not "simplify" it
  to a straight `$(...).html(value)`.
- `core.js:392` (`box.innerHTML = ""`) and `:417` (a constant SVG literal) are safe.
- `boot.js:47` moves `app.innerHTML` between nodes — a DOM relocation, not an
  injection.

Review rule: `brandHeaderHtml` in `hotspot/settings.json` is a **per-site operator
edit**, so it is attacker-reachable only if an operator can be socially engineered
into pasting HTML. That is exactly the threat `brandSafe()` exists for. Treat any
new `.html()` / `innerHTML` call as needing the same treatment.

## 6. Session and accounting behaviour

- `juanfi-setup.rsc:45` sets the `default` user profile to
  `idle-timeout=none keepalive-timeout=30s status-autorefresh=1m`.
  With `idle-timeout=none` and `status-autorefresh=1m` < `keepalive-timeout`, a
  user whose browser keeps the status page open **never logs out**. That is a
  revenue bug as much as a security one. If reviewing session behaviour, this line
  is the first thing to look at.
- `:47` adds a forward accept for `dst-port=80,443` from `10.0.0.0/16` placed
  before fasttrack. Accepting 443 is required for normal browsing but is also what
  would let a user hit an HTTPS login — see section 3.

## 7. Per-site data must not be committed

`hotspot/settings.json` carries `brandHeaderHtml` and `footerBrandText`. `AGENTS.md`
sets a standing rule: per-site branding (e.g. homeowner names) is customised **on
the router copy only**. Flag any diff to those fields as a commit blocker, and use
`git checkout -- hotspot/settings.json` to restore committed defaults before any push.

## 8. Out of scope

No SQL, no ORM, no cloud IAM, no blockchain/wallet, no container scanning, no
`package-lock.json` review, no RLS. If a finding in one of these categories seems
to apply, re-read `AGENTS.md` first — the dependency does not exist here.

## Reporting

For each finding give: file:line, the concrete attack it enables **in this
topology**, and the smallest change that closes it. Say "accepted risk on a
trusted LAN" out loud where that is the honest answer, rather than inflating it.