# JuanFiV2 Hotspot Portal

> Maintained by [kioshiDesu](https://github.com/kioshiDesu/JuanFiV2).

MikroTik hotspot portal + RouterOS setup scripts for a coinslot
vendo system. Portal files only — no firmware in this repo.

## Features

- Coin flow (INSERT COIN → Done/extend) with per-coin toasts
- Pause/resume with banked time, auto-login for returning codes
- Voucher + member login (voucher CHAP uses an empty password —
  the firmware must keep `VOUCHER_LOGIN_OPTION=0`)
- Logout receipt, live session Up/Down usage on the status view
- `api.json` captive-portal API so phones show time left natively

## Scripts (paste in order: A (router setup), B (On-Login), C (On-Logout), D (portal files))

### A. Router setup (one paste)

Everything that is not the login/logout hook, in one idempotent script:
clock, hotspot profile, free trial, cookie flush, FastTrack fix, the
site-ID publisher and the internet-status netwatch. Safe to run twice —
every step checks before it acts, and each step logs instead of aborting
the rest.

**[`juanfi-setup.rsc`](juanfi-setup.rsc) is the file.** Copy it to the
router and import it:

```
/import file=juanfi-setup.rsc
```

or drag it into Winbox → Files and double-click it. It prints the clock,
site-id and netstatus values at the end so you see what landed. Re-paste
it any time to re-apply; a daily scheduler (`juanfi-setup-daily`) runs it
on its own, which is what restores `site-id.txt` and `netstatus.txt` if
anyone deletes them.

Verify by hand if you like:

```
/system clock print
/file print detail where name="site-id.txt"
/file print detail where name="netstatus.txt"
```

The clock year must be current (a 1970 clock makes scheduler `next-run`
garbage, which makes voucher validity garbage). `site-id.txt` must hold
your board serial. `netstatus.txt` must read `up` — a file full of
`# sep/...` comment lines means the set lost the race, so re-paste the
file.

Edit `PROF`, `NTP1/NTP2` and the timezone inside the script if your
router differs. Trial logins are the `trial-uptime=5m/1d` line: drop
`,trial` from `login-by` to turn the free trial off. The portal shows its
trial button only when the router serves trial (`$(if trial == 'yes')`
renders) *and* `showTrialLogin` is true in `settings.json`. Trials are
MAC-tied (rotation eats the trial) and vanish on router reboot — vouchers
stay the real product.

### B. On-Login

Hotspot → Server Profiles → your profile → Login tab → On Login.
`HSFilePath` auto-detects `flash/hotspot` vs `hotspot` (same probe as
A). Run A first so `data/site-id.txt` already exists when logins run.

Winbox method: same path in Winbox — double-click the profile →
Login tab → paste into the On Login box (maximize the window, the
field is small), OK. No System → Scripts entry needed for this one.

```bash
:local HSFilePath "hotspot";
:if ([/file find name="flash/hotspot"] != "") do={ :set HSFilePath "flash/hotspot"; }
:local rawNote [/ip hotspot user get [find name="$user"] comment];
:local isTrial ([:pick $user 0 2] = "T-");
# Trial sessions expire natively via trial-uptime (Scripts-A) — never
# delete trial rows here, that resets the MAC wait.
:if (($rawNote = "") or ($isTrial)) do={
  :log warning ("On-Login(" . $user . "): trial/empty comment, voucher timer skipped");
} else={
:local aUsrNote [:toarray $rawNote];
:local iUsrTime [:totime ($aUsrNote->0)];
:local iExtCode ($aUsrNote->2);
:local iTimeMin [/ip hotspot user get [find name="$user"] limit-uptime];
:local iUserReg [/system scheduler find name="$user"];

:if (($iTimeMin>0) and ($iUsrTime>=0) and (($iUserReg="") or ($iExtCode=1))) do={
  /ip hotspot user set [find name="$user"] comment="";
  :local iFileMac;
  :local mac $"mac-address";
  :for i from=0 to=([:len $mac] - 1) do={
    :local chr [:pick $mac $i]
    :if ($chr = ":") do={ :set $chr "" }
    :set iFileMac ($iFileMac . $chr)
  }
  :if (($iUserReg!="") and ($iExtCode=1)) do={
    :local iTimeInt [/system scheduler get [find name="$user"] interval];
    :set iTimeInt ($iTimeInt+$iUsrTime);
    :if ($iTimeMin>$iTimeInt) do={ :set iTimeInt ($iTimeMin+$iUsrTime) };
    /system scheduler set [find name="$user"] interval=$iTimeInt;
  }
  :local iDateBeg [/system clock get date];
  :local iTimeBeg [/system clock get time];
  :if ($iUserReg="") do={
    :local iTimeInt $iUsrTime;
    :if ($iTimeMin>$iUsrTime) do={ :set iTimeInt ($iTimeMin+$iUsrTime) };
    :do { /system scheduler add name="$user" interval=$iTimeInt \
      start-date=$iDateBeg start-time=$iTimeBeg disable=no \
      policy=ftp,read,write,test \
      on-event=("/ip hotspot user remove [find name=\"$user\"];\r\n".\
                "/ip hotspot active remove [find user=\"$user\"];\r\n".\
                "/system scheduler remove [find name=\"$user\"];\r\n".\
                ":do {/file remove \"$HSFilePath/data/$iFileMac.txt\"} on-error={};\r\n")
    } on-error={ :log error ("(" . $user . ") /system scheduler add => ERROR ADD!") };
    :local x 5;:while (($x>0) and ([/system scheduler find name="$user"]="")) do={:set x ($x-1);:delay 1s};
  };
  :if ([/file find name="$HSFilePath/data"]="") do={
    :do {/tool fetch dst-path=("$HSFilePath/data/.") url="https://127.0.0.1/"} on-error={ };
  }
  :local iValidUntil "";
  :if ([/system scheduler find name="$user"]!="") do={
    :set iValidUntil [/system scheduler get [find name="$user"] next-run];
    /file print file="$HSFilePath/data/$iFileMac.txt" where name="dummyfile";
    :local x 5;:while (($x>0) and ([/file find name="$HSFilePath/data/$iFileMac.txt"]="")) do={:set x ($x-1);:delay 1s};
    /file set ("$HSFilePath/data/$iFileMac.txt") contents="$user#$iValidUntil";
  }
};
}
```

Policy is the minimum that runs the cleanup (`ftp` for `/file`,
`read,write,test` for user/scheduler/file ops) — the old
`reboot,policy,password,sniff,sensitive,romon` set is overbroad for a
login-triggered context. The portal splits the session file on the last
`#`, so member names containing `#` still work. Waits trimmed 10s → 5s
so captive clients don't time out and double-submit. Ran the old
tracker version? Delete the leftovers on the router: scripts
`day-report`, `month-report`, `todayincome`, `monthlyincome`,
`tg-creds` (+ `Daily-*` / `Monthly-*`) and schedulers `Reset Daily
Income`, `Reset Monthly Income`, `tg-creds-boot` — nothing reads
them anymore.

### C. On-Logout (same profile)

Winbox: same Login tab → On Logout box, paste, OK.

Only `session timeout` shortens the timer — manual logout, admin
removal, and keepalive expiry leave the scheduler at full interval,
which is correct for the time-remaining model (remaining minutes are
preserved, not forfeited):

```bash
:if ($cause="session timeout") do={
  /system scheduler set [find name="$user"] interval=5s;
}
```

### D. Portal files

1. In `hotspot/settings.json` set `vendorIpAddress` to your vendo
   IP (`10.0.0.254` by default).
2. Upload the `hotspot/` folder contents to the router's `hotspot`
   directory (overwrite, don't delete — the scheduler keeps
   `data/site-id.txt` there).
3. Never remove the `IAMNOTLOGINSTRINGPLEASEDONTREMOVE` comment on
   `login.html` line 2 — the router needs that sentinel.
4. All portal config lives in `hotspot/settings.json` — edit on
   the router copy per site (self-reading names, no JS):

```json
{
  "isMultiVendo": false,
  "multiVendoOption": 0,
  "multiVendoAddresses": [
    { "vendoName": "Vendo 1", "vendoIp": "10.0.0.254",
      "hotspotAddress": "10.0.0.1", "interfaceName": "vlan1" }
  ],
  "vendorIpAddress": "10.0.0.254",
  "portalDebug": false,
  "brandHeaderHtml": "BROBRO <em>PISOWIFI</em>",
  "footerBrandText": "@NETBRO",
  "footerSubText": "INTERNET SERVICES",
  "currency": "₱",
  "showMemberSection": true,
  "showTrialLogin": false,
  "trialNoExtend": true,
  "showInternetStatus": true,
  "offlineText": "No internet connection as of the moment, please try again later"
}
```
   `false` on `showMemberSection` = voucher-only portal.
   `core.js` carries the same defaults built in + a sync JSON
   fetch — the portal survives a missing JSON. No `config.js` file.

   No trial flag on purpose — the portal has no trial UI. No
   subscription/theme keys either (not adopted).

Bump the `?v=N` query on every first-party asset (`core.css`,
`JuanFiV2.css`, `boot.js`, `core.js` in `portal.html` +
router shells) on every portal change so phones don't serve stale JS.
Vendored libs stay pinned at `?v=26`. The footer `vN` tag should match.

## Optional

- Branding (per site, on the router copy only — never commit):

```js
var brandHeaderHtml = "BROBRO <em>PISOWIFI</em>";
var footerBrandText = "@NETBRO";
var footerSubText = "INTERNET SERVICES";
```

- Vendo picker (multi-vendo only): `isMultiVendo = true` is the
  single switch. Manual mode shows the dropdown automatically; auto
  modes resolve silently. Single vendo stays hidden.
## License

[MIT](https://choosealicense.com/licenses/mit/)
