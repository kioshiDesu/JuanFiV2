---
description: Run this repo's real quality gates (JSON validity, secret sweep, asset versions, RouterOS sanity) and report pass/fail
subtask: true
---

# Quality Gate Command

Run the quality gates that actually exist in this repo: $ARGUMENTS

## Before you start

Load the **`verification-loop`** skill — it holds the runnable versions of every
check below. This command is the operator-facing wrapper around it.

**This repo has no formatter, no linter, no type checker, and no test suite**
(`AGENTS.md`). Do not add or suggest one. Steps that would normally be
"formatter / lint / typecheck" are replaced below by checks that can actually run.

## Usage

`/quality-gate [path|.] [--strict]`

- default target: repo root (`.`)
- `--strict`: treat MEDIUM findings as failures

## Gates

Run in order. Stop at the first FAIL unless `--strict` is off, in which case
report every result.

1. **JSON / data validity** — `hotspot/settings.json`, `hotspot/api.json` parse.
2. **Secret sweep** — no live keys, tokens, or real credentials in `*.json`,
   `*.rsc`, `*.ino`, `*.h`, `*.html`. The firmware's
   `//PUT HERE YOUR USERNAME/PASSWORD` marker must not have a credential above it.
3. **Asset cache-busting** — every local first-party asset URL carries `?v=N`;
   `N` bumped for files just changed; vendored bootstrap/jquery/md5 still `?v=26`.
4. **RouterOS sanity** — braces balanced; every `policy=` justified; writes stay
   idempotent-guarded; script A precedes B.
5. **Cross-file consistency** — `vendorIpAddress` spelling; `HSFilePath` matches
   target hardware; CHAP/PAP only, no HTTPS login introduced.
6. **Pre-push** — `git diff -- hotspot/settings.json` empty (no per-site branding
   committed). Skip if not a git repo.

Optionally, if a browser and the mock server are available, exercise the portal at
`http://localhost:8088/portal/login|status|logout`. If not available, report
`NOT RUN` — never infer a pass from a diff read.

## Output

```
QUALITY GATE
============
1 JSON validity    : PASS/FAIL
2 Secret sweep     : PASS/FAIL (n hits)
3 Asset ?v=        : PASS/FAIL (n stale)
4 RouterOS         : PASS/FAIL (brace delta, n policy grants)
5 Cross-file       : PASS/FAIL
6 Pre-push         : PASS/FAIL / SKIPPED (not a repo)
Portal smoke      : PASS / NOT RUN

Result: PASS / FAIL (n gates failed)
Blocking findings:
1. path:line — issue — fix
```

`NOT RUN` is an honest and expected result here — this project is verified
against real hardware, and no harness can stand in for that. Report what was
actually checked and stop.