---
name: verification-loop
description: Verify portal, RouterOS, and firmware changes before claiming done. Replaces the stock build/typecheck/lint/test/coverage loop with the checks that actually exist in this repo.
license: MIT
metadata:
  origin: ECC
  retargeted: JuanFiV2 hotspot portal
---

# Verification Loop — JuanFiV2 Hotspot Portal

Verification for a repo with **no npm, no build, no type checker, no linter, and
no test harness** (`AGENTS.md`). The stock loop's phases — `npm run build`,
`npx tsc --noEmit`, `ruff check`, 80% coverage — are all unrunnable here and
proposing them wastes the operator's time. The phases below are the checks that
*do* apply.

Shells below are PowerShell, which is what this repo is worked on from.

## When to Use

- After any change to `hotspot/`, `juanfi-setup.rsc`, `OnLogin.txt`, `OnLogout.txt`, or `firmware/`
- Before reporting any change as done
- Before any push (there is a standing pre-push rule — see Phase 6)

## Phase 1: JSON and data-file validity

```powershell
foreach ($f in @("hotspot\settings.json","hotspot\api.json")) {
  try { Get-Content $f -Raw | ConvertFrom-Json | Out-Null; "OK  $f" }
  catch { "FAIL $f : $_" }
}
```

`hotspot/errors.txt` is plain text, not JSON — read it, do not parse it.

## Phase 2: Secret sweep

```powershell
Select-String -Path (Get-ChildItem -Recurse -File -Include *.json,*.rsc,*.ino,*.h,*.html,*.jsonc |
  Where-Object { $_.FullName -notmatch 'node_modules' }).FullName `
  -Pattern 'sk-[a-z0-9]|apiKey|api_key|PASSWORD\s*=\s*".+"|secret'
```

Any hit is a **blocker** until explained. `firmware/JuanFi-nodemcu.ino:573` carries
the marker comment `//PUT HERE YOUR USERNAME/PASSWORD` — a real credential above
it is a leak. Also confirm `.opencode/opencode.jsonc` holds no `apiKey`.

## Phase 3: Asset cache-busting consistency — most-skipped check, highest real-world impact

Phones cache aggressively. Every local first-party asset URL must carry `?v=N`,
and **`N` must have been bumped for the files you just changed** — otherwise
users keep running stale JS and the fix appears not to work.

```powershell
Select-String -Path "hotspot\*.html","hotspot\assets\js\*.js" -Pattern '(src|href)\s*=\s*["''][^"'']*?["'']' -AllMatches |
  ForEach-Object { $_.Matches.Value } | Where-Object { $_ -notmatch '\?v=' -and $_ -notmatch 'http' }
```

Then confirm vendored bootstrap/jquery/md5 are still pinned at `?v=26` and were
**not** bumped along with first-party assets. If you changed `core.js`, the
`?v=N` on every reference to it must have changed.

## Phase 4: RouterOS script sanity

```powershell
$c = Get-Content "juanfi-setup.rsc" -Raw
"braces: " + (($c.ToCharArray() | Where-Object {$_ -eq '{'}).Count) + " open / " + (($c.ToCharArray() | Where-Object {$_ -eq '}'}).Count) + " close"
Select-String -Path "juanfi-setup.rsc","OnLogin.txt","OnLogout.txt" -Pattern "policy="
```

- Brace counts must balance.
- Every `policy=` must be justified in a comment. `policy` (the RouterOS one, not
  the `policy=` key on `/system script add`) grants cleartext access to every
  configured password — drop it unless genuinely needed. See the `security-review`
  skill, section 1.
- Every write stays wrapped in a `:do {...} on-error={}` or `:if` existence
  guard. `juanfi-setup.rsc` is re-imported on every install and **must be
  idempotent**.
- `OnLogin.txt` expects `data/site-id.txt` to exist, which `juanfi-setup.rsc`
  creates — so script **A must be imported before B**. Confirm the order you
  documented matches what you shipped.

## Phase 5: Portal smoke test (the closest thing to a test suite)

```powershell
node "C:\Users\pisowifi\AppData\Local\Temp\opencode\preview-webadmin.mjs" 8088
```

Then open `http://localhost:8088/portal/login`, `/portal/status`, `/portal/logout`,
and drive the coin flow. Insert test coins via `http://localhost:8088/mock`.
If the mock server is unavailable, **say the portal was not exercised** — do not
report a UI change as verified on the strength of a diff read alone.

## Phase 6: Pre-push rules

1. `git diff -- hotspot/settings.json` — must be **empty**. Per-site branding
   (homeowner names, `brandHeaderHtml`, `footerBrandText`) is customised on the
   router copy only and must never be committed. Restore with
   `git checkout -- hotspot/settings.json`. This is a standing rule.
2. `git diff --stat` — confirm only intended files changed.
3. Confirm no `.agents/` or `skills-lock.json` staged — both are gitignored
   local-only.

Skip git phases entirely if this folder is not a git repo; do not report a failure.

## Phase 7: Cross-file consistency

Two documented traps — check both:

- The portal config key is **`vendorIpAddress`** (with an **o**) in
  `hotspot/settings.json`. Any script or doc saying `vendoIpAddress` is stale.
- `HSFilePath` in the On-Login script is `flash/hotspot` on hEX / hAP-ax but
  `hotspot` on hAP lite. Confirm the value matches the target hardware.

## Output Format

```
VERIFICATION REPORT
===================
JSON/data files : PASS/FAIL
Secrets         : PASS/FAIL (n hits)
Asset ?v= bumps : PASS/FAIL (n stale refs)
RouterOS        : PASS/FAIL (brace delta, policy grants)
Portal smoke    : PASS / NOT RUN — no browser or mock server
Cross-file      : PASS/FAIL

Overall: READY / NOT READY
```

**Report `NOT RUN` honestly.** "Not exercised on hardware" is a legitimate and
useful result. Claiming a hardware-dependent change is verified because the diff
looked right is the one failure mode this skill exists to prevent.

## Continuous Mode

Checkpoint after each coherent change — not on a timer. In this repo a "change"
is a coherent portal edit, a script edit, or a firmware edit; re-verify after
each rather than every 15 minutes.

No PostToolUse hooks are configured, and none should be assumed.