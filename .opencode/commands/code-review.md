---
description: Review portal, RouterOS, or firmware changes for correctness and maintainability
agent: code-reviewer
subtask: true
---

# Code Review Command

Review changes for correctness and maintainability: $ARGUMENTS

## Before you start

Load the **`coding-standards`** skill for this repo's conventions. This repo is
vanilla JS + hand-written HTML/CSS + RouterOS script + ESP8266 Arduino C++.
**No TypeScript, no React, no framework, no linter, no test suite.** Skip
`file.ts` file-extension examples and every React- or TS-specific rule.

Do not require JSDoc, type annotations, immutability, or missing tests — see the
skill's notes on why each is wrong for this codebase.

## Get the diff

```powershell
git diff --name-only HEAD
git diff --stat
```

If this folder is not a git repo, review the named files directly and say so.

## Check categories

### Correctness (CRITICAL)
- [ ] Vendo flow order intact: `topUp` → `checkCoin` → `useVoucher`
      (`cancelTopUp` to abort). Reordering or skipping a step breaks the coin flow.
- [ ] Voucher codes passed through opaquely — no prefix/length validation added.
- [ ] On-Login still assumes `data/site-id.txt` exists (script **A** before **B**).
- [ ] `brandSafe()` whitelist intact — no new un-sanitised `.html()` sink.
- [ ] RouterOS writes stay idempotent-guarded; re-import must be safe.

### Breaking changes (CRITICAL)
- [ ] Portal config key is `vendorIpAddress` (**with an o**), not `vendoIpAddress`.
- [ ] No HTTPS login introduced — breaks plain-HTTP vendo calls as mixed content.
- [ ] `HSFilePath` matches target hardware (`flash/hotspot` vs `hotspot`).
- [ ] Local first-party asset `?v=N` bumped for every changed file; vendored
      bootstrap/jquery/md5 still pinned at `?v=26`.
- [ ] UI edited in `portal.html` only — not forked into `login.html` /
      `status.html` / `logout.html`.
- [ ] No per-site branding (`brandHeaderHtml`, `footerBrandText`) added to
      `hotspot/settings.json`.

### Code quality (HIGH)
- [ ] Functions > 50 lines (fix at > 120)
- [ ] Nesting > 5 levels — in RouterOS prefer `:if` guards over deeper `:do` chains
- [ ] Magic numbers that belong in `hotspot/settings.json` or a named RouterOS var
- [ ] Duplicated literals across `settings.json` and a `.rsc` file, uncross-referenced
- [ ] Missing `:log warning` on an `on-error={}` branch that hides a real failure

### Comment quality (MEDIUM)
- [ ] Comments explain *why* (see `core.js:1159-1160` as the bar), not *what*
- [ ] No comments describing removed behaviour

### Accessibility (MEDIUM)
Delegate to the **`web-design-guidelines`** skill for the portal UI. Highest-risk:
labels vs placeholders on the login and voucher inputs, 44px tap targets, focus
visibility, `aria-live` on errors.

### Style (LOW)
- [ ] camelCase JS/RouterOS locals, `UPPER_SNAKE` macros, `var` in `core.js`

## Report format

Per finding:

```
[SEVERITY] path:line
Issue: <what is wrong>
Why it matters here: <concrete effect in this topology>
Fix: <smallest change>
```

## Decision

- **CRITICAL** — block. Do not report done.
- **HIGH** — fix before committing.
- **MEDIUM** — recommend, do not block.
- **LOW** — optional.

Say plainly when a hardware-dependent change is **unverified** — a clean diff
read is not hardware verification. `AGENTS.md` is explicit that this repo has no
test harness.