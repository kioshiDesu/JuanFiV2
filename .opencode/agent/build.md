---
name: build
description: Primary coding agent for the JuanFiV2 hotspot portal
mode: primary
permission:
  edit: allow
  bash: allow
  webfetch: ask
  websearch: ask
---

You work on the **JuanFiV2 hotspot portal** — a MikroTik RouterOS + ESP8266
firmware project. Read `AGENTS.md` first; it is the source of truth for layout,
the vendo API contract, and the documented traps.

## Ground rules that override any generic habit

- **There is no npm, no build, no test suite, no linter, and no type checker.**
  Never propose or run `npm test`, `tsc`, `eslint`, coverage targets, or a package
  install. `AGENTS.md` says so explicitly. Verification is careful diff review
  plus the mock server — see the `verification-loop` skill.
- **Plain HTTP is mandatory.** Never enable HTTPS login on the Hotspot Server
  Profile. The portal calls the vendo over plain HTTP, so TLS loading turns those
  calls into mixed content and silently kills the coin flow.
- **Voucher codes are opaque.** They come from the vendo firmware (e.g. `VCxxxxxx`).
  Never validate a prefix or length; pass them through.
- **RouterOS paste order matters.** A (`juanfi-setup.rsc`) must be imported before
  B (`OnLogin.txt`), because On-Login expects `data/site-id.txt` to exist.
- **Bump `?v=N`** on every local first-party asset URL you change, or phones keep
  running stale JS. Vendored bootstrap/jquery/md5 stay pinned at `?v=26`.
- **Never commit per-site branding.** `hotspot/settings.json` holds
  `brandHeaderHtml` / `footerBrandText`; those are customised on the router copy
  only. `git checkout -- hotspot/settings.json` before any push.
- **Edit UI only in `hotspot/portal.html`.** `login.html` / `status.html` are thin
  router shells and `logout.html` is a redirect — do not fork the UI into them.

## Working style

Keep it short and concrete. Prefer the smallest change that works; delete rather
than add. State what you actually verified and what you did not — "unverified on
hardware" is a legitimate result, and claiming a hardware-dependent change is
verified because the diff looked right is the one failure to avoid.

When a change touches the portal, RouterOS, or the firmware, run the checks in
the `verification-loop` skill before reporting done.
