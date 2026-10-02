---
description: Update AGENTS.md and RouterOS script comments to match recent changes
agent: doc-updater
subtask: true
---

# Update Docs Command

Update documentation to reflect recent changes: $ARGUMENTS

## Before you start

This repo has exactly **two** documentation surfaces: `AGENTS.md` and the comments
inside the RouterOS scripts and portal code. There is no README, no API doc
site, no ADRs, no JSDoc convention. **Do not create them.**

## Your task

1. `git diff --name-only` — identify what actually changed
2. For each change, ask: does `AGENTS.md` now describe something untrue?
3. Edit only what's wrong. Documentation drift is a bug, not a rewrite.

## What is documentation here

### `AGENTS.md` — the primary doc
Sections that go stale silently and must be checked after a change:

- **Layout** — file roles. Adding or removing a file under `hotspot/`,
  `firmware/`, or root scripts requires updating this section.
- **Vendo API quirks** — the `topUp → checkCoin → useVoucher` order, and the rule
  that voucher codes are opaque. If the flow changes, this changes.
- **Portal + RouterOS gotchas** — `vendorIpAddress` spelling, `?v=N` cache-busting
  rule, `HSFilePath` per model, CHAP/PAP-only login, the FastTrack/keepalive
  diagnosis, default network and credentials.
- **Previewing the portal** — mock server path and the `/mock` coin endpoints.

Verify every factual claim still holds against the files; do not copy text forward
on trust.

### RouterOS script comments
`juanfi-setup.rsc`, `OnLogin.txt`, `OnLogout.txt` carry inline comments explaining
each block. A behaviour change **must** update the adjacent comment, including
every `policy=` justification — see the `security-review` skill §1.

### Portal code comments
`core.js` sets the bar: comments state *why*, not *what*. `brandSafe()`'
s comment at `core.js:1159-1160` is the reference example. If a comment described
behaviour that has since changed, fix or delete it — a stale comment is worse than
none.

## Update checklist

- [ ] Every changed file is still described accurately in `AGENTS.md`
- [ ] No filename, path, or paste-order reference is stale
- [ ] Every `policy=` justification still accurate
- [ ] Comments adjacent to changed code updated in the same commit
- [ ] No `JSDoc`/README/API-doc/ADR scaffolding created
- [ ] **Per-site branding NOT documented anywhere.** Owner names and
      `brandHeaderHtml` values stay on the router copy and must never enter
      `AGENTS.md`, `README`, or any committed file
- [ ] `.agents/skills/` and `skills-lock.json` still described as local-only and
      gitignored

## Quality

Accurate and current beats comprehensive. Delete a doc section rather than let it
lie. If you cannot verify a claim, mark it — do not assert it.

---

**Doc changes ship in the same commit as the code change they describe.**