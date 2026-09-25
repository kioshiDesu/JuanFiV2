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

## Scripts (paste in order)

### A. Router clock

Fixes 1970-time voucher issues. Uses raw IPs (Google Public NTP) so the
clock syncs even before DNS is up:

```bash
# RouterOS v6
/system ntp client set enabled=yes primary-ntp=216.239.35.8 secondary-ntp=216.239.35.4
# RouterOS v7
/system ntp client set enabled=yes servers=216.239.35.8,216.239.35.4
```

Verify with `/system clock print` — year must be current, not 1970
(stale clock = garbage scheduler `next-run` = garbage voucher validity).
Set the timezone too: `/system clock set time-zone-name=Asia/Manila`
(use your own zone).

### B. Hotspot profile tuning

Winbox: Hotspot → Server Profiles → your profile → **Login** tab:
untick **Login by Cookie** + **Login by MAC Cookie**. Tick
**HTTP CHAP + HTTP PAP only** (never HTTPS login —
browsers block plain-HTTP vendo calls as mixed content).
Cookie lifetimes gray out once both cookie methods are off.

Hotspot → **User Profiles** → `default`: Idle Timeout `none`,
Keepalive Timeout `30s`, Status Autorefresh `1m`.

```bash
/ip hotspot profile set [find name="hsprof1"] login-by=http-chap,http-pap
/ip hotspot user profile set [find name="default"] idle-timeout=none keepalive-timeout=30s status-autorefresh=1m
```

Already ran with cookies before? Paste once on the router
(off-hours — kicks actives) to drop the old login methods and
flush issued cookies:

```bash
/ip hotspot profile set [find name="hsprof1"] login-by=http-chap,http-pap
/ip hotspot cookie print
/ip hotspot cookie remove [find]
```

Note: the status page's autorefresh counts as traffic. With autorefresh
(`1m`) longer than keepalive (`30s`), idle expiry still works once the
page is closed. If idle users never expire, check the defconf FastTrack
firewall rule first (fasttracked traffic skips idle accounting) — accept
hotspot traffic before it:

```bash
/ip firewall filter add chain=forward action=accept protocol=tcp dst-port=80,443 \
  src-address=10.0.0.0/16 place-before=0 comment="hotspot before fasttrack"
```

### C. On-Login

Hotspot → Server Profiles → your profile → Login tab → On Login.
`HSFilePath` auto-detects `flash/hotspot` vs `hotspot` (same probe as
E). Paste E first so `data/site-id.txt` already exists when logins run.

Winbox method: same path in Winbox — double-click the profile →
Login tab → paste into the On Login box (maximize the window, the
field is small), OK. No System → Scripts entry needed for this one.

```bash
:local HSFilePath "hotspot";
:if ([/file find name="flash/hotspot"] != "") do={ :set HSFilePath "flash/hotspot"; }
:local rawNote [/ip hotspot user get [find name="$user"] comment];
:if ($rawNote = "") do={
  :log warning ("On-Login(" . $user . "): empty comment, voucher timer skipped");
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

### D. On-Logout (same profile)

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

### E. Site ID publisher

Publishes the board serial to `data/site-id.txt` so saved vouchers are
scoped per site. Write-once, runs at startup, needs no reachable vendo:

```bash
/system script add name="publish-site-id" policy=read,write,ftp,test source={
  :local HSFilePath "hotspot";
  :if ([/file find name="flash/hotspot"] != "") do={ :set HSFilePath "flash/hotspot"; }
  :local siteFile ($HSFilePath . "/data/site-id.txt");
  :if ([/file find name=($HSFilePath . "/data")] = "") do={
    :do { /tool fetch dst-path=($HSFilePath . "/data/.") url="https://127.0.0.1/" } on-error={};
  }
  :local siteOld "";
  :do { :set siteOld [/file get [find name=$siteFile] contents] } on-error={};
  :if ($siteOld = "") do={
    :local sn "";
    :do { :set sn [/system routerboard get serial-number] } on-error={};
    :if ([:len $sn] >= 4) do={
      /file print file=$siteFile where name="dummyfile";
      :local x 5;:while (($x>0) and ([/file find name=$siteFile]="")) do={:set x ($x-1);:delay 1s};
      /file set "$siteFile" contents="$sn";
    }
  }
};
/system scheduler add name="publish-site-id" start-time=startup interval=1d policy=read,write,ftp,test on-event="/system script run publish-site-id";
```

Run `/system script run publish-site-id` once after pasting. Verify:
`/file print where name="hotspot/data/site-id.txt"` must show your board
serial. Boards without a serial (CHR/x86) fall back to vendorIp scoping.

### F. Portal files

1. In `hotspot/assets/js/config.js` set `vendorIpAddress` to your vendo
   IP (`10.0.0.254` by default).
2. Upload the `hotspot/` folder contents to the router's `hotspot`
   directory (overwrite, don't delete — the scheduler keeps
   `data/site-id.txt` there).
3. Never remove the `IAMNOTLOGINSTRINGPLEASEDONTREMOVE` comment on
   `login.html` line 2 — the router needs that sentinel.
4. Display toggles live in `hotspot/settings.json` — edit on the
   router copy per site (self-reading names, no JS):

```json
{
  "currency": "₱",
  "showMemberSection": true
}
```
   `false` on `showMemberSection` = voucher-only portal. `config.js`
   holds the same defaults as fallback when the JSON is missing.

   No trial flag on purpose — the portal has no trial UI. No
   subscription/theme keys either (not adopted).

Bump the `?v=N` query on every first-party asset (`core.css`,
`JuanFiV2.css`, `config.js`, `boot.js`, `core.js` in `portal.html` +
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
