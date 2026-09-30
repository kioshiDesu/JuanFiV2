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
site-ID publisher, the internet-status writer and the daily voucher
orphan sweep. Safe to run twice — every step checks before it acts, and
each step logs instead of aborting the rest.

Where the portal files live is resolved per router: the hotspot profile's
`html-directory` first, then a probe for a file we ship. RouterOS never
lists directories, so the old `[/file find name="flash/hotspot"]` check
always came back empty and every write landed in the wrong folder — on an
hEX that is exactly why `data/netstatus.txt` went missing and the offline
banner never showed. The resolved path is printed as `portal files = ...`
at the end.

**[`juanfi-setup.rsc`](juanfi-setup.rsc) is the file.** Copy it to the
router and import it:

```
/import file=juanfi-setup.rsc
```

or drag it into Winbox → Files and double-click it. It carries no
comments and no line continuations, and every step is wrapped in
`:do … on-error={}` so one bad command logs a warning and the rest
still land. It prints the clock, resolved portal path, site-id and
netstatus values at the end so you see what landed. Re-paste it any time
to re-apply; a daily scheduler (`juanfi-setup-daily`) runs it on its own,
which is what restores `site-id.txt` and `netstatus.txt` if anyone
deletes them.

Three scripts land: `juanfi-setup` (this one), `juanfi-sweep` (orphan
codes) and `juanfi-netstatus` (pings 8.8.8.8 and writes `up`/`down` into
the portal's `data/` folder). `juanfi-netstatus-1m` is a scheduler that
runs it every minute; it re-resolves the portal folder on each run rather
than baking the path in at install time, and only writes when the value
actually changed, so flash wear stays flat. A re-import also removes the
older `vendo net status` netwatch and `juanfi-net-up` / `juanfi-net-down`
scripts if a previous version left them behind.

Verify by hand if you like:

```
/system clock print
/ip hotspot profile print detail
/file print detail where name="site-id.txt"
/file print detail where name="netstatus.txt"
/system script run juanfi-sweep
```

The clock year must be current (a 1970 clock makes scheduler `next-run`
garbage, which makes voucher validity garbage). `site-id.txt` must hold
your board serial. `netstatus.txt` must read `up` — a file full of
`# sep/...` comment lines means the set lost the race, so re-paste the
file.

Edit `PROF`, `NTP1/NTP2` and the timezone inside the script if your
router differs. The NTP property name is the one thing that differs
between RouterOS 6 and 7 (`primary-ntp`/`secondary-ntp` vs `servers`),
so the script reads `/system resource get version` and builds the right
command as text before running it — an unknown property name is a
compile error that `on-error` cannot catch, which is why it is never
written literally. Trial logins are the `trial-uptime=5m/1d` line: drop
`,trial` from `login-by` to turn the free trial off. The portal shows its
trial button only when the router serves trial (`$(if trial == 'yes')`
renders) *and* `showTrialLogin` is true in `settings.json`. Trials are
MAC-tied (rotation eats the trial) and vanish on router reboot — vouchers
stay the real product.

#### The orphan sweep (`juanfi-sweep`)

The coin box picks a code at random and never asks the router whether
that code already exists — its telnet helper writes commands without
reading replies. A code that gets minted and never claimed therefore has
no expiry scheduler, because only On-Login creates one, and nothing ever
removed it. Those dead rows pile up until they occupy so much of the
8,999-code space that new coins keep landing on a live account, which
tops up the wrong customer and hands the buyer a shared login.

`juanfi-sweep` reclaims that space daily at 04:20. It matches a user with
a comment, no expiry scheduler and no live session — a minted-never-
claimed voucher — appends today's date as a 5th comment field, and
removes anything it stamped more than `GRACE` days ago. Members and
trials carry an empty comment and are never touched. The box only ever
*writes* that comment, so this is safe; fields 1-4 stay where it put
them, which is what On-Login reads.

First run only stamps, so installing it never mass-deletes — the worst
case is that the oldest dead code lives four more days. Raise `GRACE`
if buyers pay and log in late, lower it to shrink the collision window.

The script logs every run:

```
/log print where message~"juanfi-sweep"
```

### B. On-Login

Hotspot → Server Profiles → your profile → Login tab → On Login.
`HSFilePath` resolves where the portal files actually are, using the
hotspot profile's `html-directory` first and then probing a file we ship
(same logic as A). RouterOS never lists directories, so a plain
`[/file find name="flash/hotspot"]` always comes back empty — that probe
is why the offline banner went missing on flash storage. Run A first so
`data/site-id.txt` already exists when logins run.

Winbox method: same path in Winbox — double-click the profile →
Login tab → paste into the On Login box (maximize the window, the
field is small), OK. No System → Scripts entry needed for this one.

```bash
:local PROF "hsprof1";
:local HSFilePath "";
:do { :set HSFilePath [/ip hotspot profile get [find name=$PROF] html-directory] } on-error={ :set HSFilePath "" };
:if (($HSFilePath = "") or ([/file find name=($HSFilePath . "/portal.html")] = "")) do={
  :local cand "";
  :foreach c in={"flash/hotspot"; "hotspot"} do={
    :if ($cand = "") do={
      :foreach f in={"portal.html"; "login.html"; "status.html"} do={
        :if (($cand = "") and ([/file find name=($c . "/" . $f)] != "")) do={ :set cand $c };
      };
    };
  };
  :if ($cand != "") do={ :set HSFilePath $cand };
};
:if ($HSFilePath = "") do={ :set HSFilePath "hotspot" };
:local rawNote [/ip hotspot user get [find name="$user"] comment];
:local isTrial ([:pick $user 0 2] = "T-");
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
  :if ([/file find name="$HSFilePath/data/site-id.txt"]="") do={
    :do {/tool fetch dst-path=("$HSFilePath/data/.") url="http://127.0.0.1/portal.html"} on-error={ };
    :do {/tool fetch dst-path=("$HSFilePath/data/.") url="https://127.0.0.1/portal.html"} on-error={ };
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
so captive clients don't time out and double-submit. Trial sessions
expire natively via `trial-uptime` (Scripts-A), which is why the
`$isTrial` branch only logs and skips the timer — deleting a trial row
here would reset the MAC wait. Ran the old
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
  "offlineText": "No internet connection as of the moment, please try again later",
  "macAsVoucherCode": false
}
```
   `false` on `showMemberSection` = voucher-only portal.
   `core.js` carries the same defaults built in + a sync JSON
   fetch — the portal survives a missing JSON. No `config.js` file.

   No trial flag on purpose — the portal has no trial UI. No
   subscription/theme keys either (not adopted).

   `macAsVoucherCode: true` makes the portal send each client's own MAC
   (colons stripped) as the voucher code. The coin box only mints a
   random code when the `topUp` POST carries an empty voucher, so
   filling it in makes the box register that MAC as the hotspot user —
   a 48-bit namespace instead of 8,999 codes, which also retires the
   silent-collision problem where a random mint lands on a live account
   and tops up the wrong customer. The input stays editable and the
   voucher box is not hidden, so a real `VC` code still works: `doLogin`
   reads what is typed first. Turn it on per site if you want MAC
   identity on sales; leave it off if you hand out typeable codes
   (GCash, reselling) or need the admin-panel prefix to identify buyers.

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
