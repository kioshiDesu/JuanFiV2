---
name: coding-standards
description: Baseline conventions for this repo — readability, KISS, and code-smell pressure for the portal's vanilla-JS/HTML and the RouterOS scripts. Not a TypeScript or React guide.
metadata:
  origin: ECC
  retargeted: JuanFiV2 hotspot portal
---

# Coding Standards — JuanFiV2 Hotspot Portal

The shared floor. Language-agnostic. This repo is **vanilla ES5-ish JavaScript,
hand-written HTML/CSS, RouterOS script, and ESP8266 Arduino C++**. There is no
TypeScript, no React, no framework, no build step, and no linter. Anything about
`tsc`, hooks, JSX, `zod`, or `NextResponse` does not apply.

## When to Activate

- Adding or editing a function in `hotspot/assets/js/core.js`
- Editing markup in `hotspot/portal.html` or the `login.html` / `status.html` / `logout.html` shells
- Writing or editing RouterOS script (`juanfi-setup.rsc`, `OnLogin.txt`, `OnLogout.txt`)
- Editing `firmware/JuanFi-nodemcu.ino`

## Readability

- **KISS.** The portal is one self-rendering file. Prefer the direct expression
  over an abstraction with one caller.
- **DRY, but count the callers.** Two similar blocks are not yet duplication. The
  exception is the `server.on("/admin/api/...")` handlers in
  `firmware/JuanFi-nodemcu.ino:334-345` — fourteen near-identical SPIFFS
  read/write handlers, where a shared helper is worth it.
- **YAGNI.** No speculative options, config flags, or extension points.
- **Explain the non-obvious in a comment; do not narrate the obvious.** This file
  already carries high-value comments (e.g. `core.js:1159-1160` explaining *why*
  `brandSafe()` exists). Match that bar: state the constraint, not the mechanics.
- `var` over `let`/`const` in `core.js` — match surrounding code, do not mix styles
  within a function.

## State mutation: mutability is expected, not forbidden

An earlier version of this skill called immutability "CRITICAL". **That is wrong
for this codebase.** State here is mutated by design — RouterOS `:set` calls,
`element.value = ...`, and the firmware rewriting SPIFFS files are all
assignments. Do not introduce `const`-everything or object-spread rewrites to
"satisfy immutability"; it adds churn and can break the RouterOS `:set` idiom.

The rule that does apply: **do not mutate a shared object to communicate between
call sites.** If two functions must coordinate, pass a value or return one.

## Code smells to actually push on

These are the high-yield checks for this repo, in rough priority order.

- **Long functions.** `core.js` is 97 KB and `JuanFi-nodemcu.ino` is 55 KB.
  Treat **> 50 lines** as a smell worth naming in review, and **> 120 lines** as
  one to fix.
- **Deep nesting.** **5+ levels** of `if`/`for` is a smell. In RouterOS, collapse
  `:do {...} on-error={}` chains with `:if` guards rather than nesting deeper —
  `juanfi-setup.rsc:44-47` already does this correctly with `:do ... on-error={}`
  plus an `:if` length check.
- **Magic numbers.** Rates, timeouts, and addresses must come from
  `hotspot/settings.json` or a named RouterOS variable. A bare `30s`, `1m`, or
  `10.0.0.254` inline in `juanfi-setup.rsc` is a smell; `:44-47` gets this right.
- **Duplicated literals across files.** If a value appears in both
  `hotspot/settings.json` and a `.rsc` script, add a comment on both sides naming
  the other file, because they cannot be kept in sync automatically.
- **Long parameter lists** — prefer a single settings object.

## RouterOS conventions

- Use `:local` for intermediates and name them in lowerCamelCase.
- **Every write is idempotent-guarded.** `juanfi-setup.rsc:44-47` shows the house
  pattern: a `:find`/`[:len [...]] = 0` existence check, then the set/add, wrapped
  in `:do {...} on-error={ :log warning ... }`. Follow it — the script is
  re-imported on every install and must be safe to run twice.
- `/import`-able, no interactive prompts, no hardcoded absolute paths.
- Comment every `policy=` and justify it.

## Portal JS conventions

- `$("#id")` over `document.querySelector` to match the rest of `core.js`.
- `.textContent` for data, `.html()` only via `brandSafe()`.
- **Bump the `?v=N` query on every local first-party asset URL when you change the
  file** — phones cache aggressively and will otherwise keep running the old JS
  (`AGENTS.md`). Vendored bootstrap/jquery/md5 stay pinned at `?v=26`.
- Edit UI in `hotspot/portal.html` only. `login.html` / `status.html` are thin
  router shells; `logout.html` is a redirect. Do not fork the UI across them.
- Everything in `hotspot/assets/js/core.js` must run in the browser on a phone with
  no build step and no network beyond the router and the vendo.

## HTML/CSS conventions

- `hotspot/portal.html` holds **all** UI — login, status, and paused views, plus
  inline coin and member sections. No modals.
- No modals, no framework, no CDN — assets are vendored under `hotspot/assets/`.
- Plain CSS in `assets/css/core.css`; no preprocessor, no utility framework.

## Naming

- JS: camelCase functions and variables, PascalCase constructor-ish helpers.
- RouterOS: lowerCamelCase locals, `UPPER-CASE` for script-level constants
  (e.g. `$PROF`).
- C++ in the `.ino`: camelCase functions, `UPPER_SNAKE` macros.

## Comments

Prefer plain `//` comments that state *why*. There is no Doxygen pipeline and no
`@param` convention to follow here.

## Out of scope

Do not propose a linter, a formatter, a type checker, a pre-commit hook, or a test
harness. `AGENTS.md` states plainly: **"No npm/build/test/lint — do not invent
commands."** Verification is careful diff review against real hardware.