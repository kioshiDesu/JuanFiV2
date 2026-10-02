---
description: Security review of the portal, RouterOS scripts, or firmware admin panel
agent: security-reviewer
subtask: true
---

# Security Review Command

Conduct a security review of: $ARGUMENTS

## Before you start

Load the **`security-review`** skill and work from its checklist. Do not use a
generic OWASP Top 10 list — the stock version assumes SQL, a cloud provider, and
`npm audit`, none of which exist here.

This repo has **no npm, no database, no cloud account, no test harness**. Finding
categories that do not apply should not be reported.

## Scope by target

| Target | Load and check |
|---|---|
| `juanfi-setup.rsc`, `OnLogin.txt`, `OnLogout.txt` | skill §1 RouterOS `policy=` scoping, §6 session/accounting, §3 login transport |
| `firmware/JuanFi-nodemcu.ino` | skill §2 admin auth, upload handler, credential markers |
| `hotspot/portal.html`, `hotspot/assets/js/core.js` | skill §5 DOM sinks and `brandSafe()`, §4 voucher opacity |
| `hotspot/settings.json` | skill §7 per-site branding must not be committed |
| The portal as a whole | skill §3 HTTPS-login trap, §4 voucher codes, §8 out-of-scope |

## Then additionally confirm

- [ ] **Plain-HTTP assumption holds.** Portal loads over HTTP; vendos called over
      plain HTTP with CORS. Flag any change that introduces HTTPS login — it
      breaks the coin flow via mixed content, and presents as "coin insert does
      nothing".
- [ ] **Voucher codes treated as opaque.** No prefix or length validation added.
- [ ] **Sensitive firmware routes gated.** `/admin/api/saveSystemConfig`,
      `/admin/api/saveRates`, `/admin/api/resetStatistic`,
      `/admin/api/generateVouchers`, `/admin/updateMainBin` all behind
      `isAuthorized()`.
- [ ] **No new `.html()` sink** that bypasses `brandSafe()`.
- [ ] **No credentials committed.** Firmware `ADMIN_USER`/`ADMIN_PW`, agent config
      `apiKey`, RouterOS default passwords.
- [ ] **Default creds flagged as install-time changes:** firmware `admin/admin`,
      MikroTik API `pisonet/abc123`.

## Report Format

### Critical — remote code execution, auth bypass, committed secrets
`file:line` + the concrete attack in this topology + the smallest fix.

### High — exploitable on the local WLAN
### Medium — hardening
### Accepted risk on a trusted LAN

State accepted risks plainly instead of inflating them. HTTP Basic auth on an
APIPA subnet is genuinely "accepted risk on a trusted LAN" — say so, and say what
would change it, rather than dressing it as Critical.

### Out of scope — not applicable to this repo
Name the categories you deliberately skipped (SQL, XXE, deserialization,
dependency audit, cloud IAM) so the reader knows they were considered, not missed.

---

**Critical findings are blockers.** Do not report a change as done while one is open.