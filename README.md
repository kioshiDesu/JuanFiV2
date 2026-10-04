# JuanFiV2 Hotspot Portal

> Maintained by [kioshiDesu](https://github.com/kioshiDesu/JuanFiV2).

MikroTik hotspot portal + RouterOS setup scripts for a coinslot
vendo system.

## Which folder goes where

| Folder | What it is |
| --- | --- |
| `hotspot/` | The portal for **this repo's firmware** (`firmware/`). Use this one. |
| `firmware/` | The ESP8266 firmware itself — not part of the portal upload. See `AGENTS.md` §Firmware for the build. |

The **original JuanFi portal** is a different portal and no longer lives here.
It is its own repository: [kioshiDesu/JuanFi](https://github.com/kioshiDesu/JuanFi)
(private). Use that repo if you are running the original JuanFi box rather
than this repo's firmware — the two share an ancestor but have diverged, so do
not assume a file here matches one there.

## Features

- Coin flow (INSERT COIN → Done/extend) with per-coin toasts
- Pause/resume with banked time, auto-login for returning codes
- Voucher + member login (voucher CHAP uses an empty password —
  the firmware must keep `VOUCHER_LOGIN_OPTION=0`)
- Logout receipt, live session Up/Down usage on the status view
- `api.json` captive-portal API so phones show time left natively

## Scripts (paste in order: A (router setup), B (On-Login), C (On-Logout), D (portal files))

### A. Router setup

**You never need the terminal for this.** Every step below is a script you
create once in Winbox and paste code into, so the code lives on the router
where you can read it, edit it and re-run it whenever you want.

To add one:

1. **System → Scripts → +**
2. **Name** — type it exactly as written. Schedulers call scripts by name, so
   a typo here means the schedule silently never fires.
3. **Policy** — tick only the boxes listed for that script. Fewer than it needs
   and the script fails on its first write; more than it needs and you have
   handed it power it does not use.
4. **Source** — paste the code block for that step.
5. Press **Run Script** once, then check the **Log** menu for what it printed.

Re-running any of them is safe: each one checks whether it already did the work
before it writes anything.

Before you start: in the `juanfi-setup` source, edit `PROF` (the hotspot
profile name, `hsprof1` by default), `NTP1`/`NTP2` and `Asia/Manila` to match
your router.

#### A1. `juanfi-setup` — profile, clock, NTP, FastTrack, site ID, netstatus file

Policy: `read`, `write`, `test`, `policy`, `ftp`

Sets the hotspot and user profiles, syncs the clock, adds the FastTrack accept
rule, publishes this router's own site id into `data/site-id.txt`, and creates
`data/netstatus.txt` as `up` so the netwatch entry in A2 has a file to write.

A wrong year makes scheduler `next-run` garbage, which makes voucher validity
garbage — the clock matters more than it looks. The FastTrack rule accepts
hotspot traffic *before* FastTrack; without it, fasttracked sessions skip idle
accounting and never log out. The site id gives every router its own
voucher-history bucket, so run this **before** step B.

Never enable HTTPS login — the page then loads over TLS and browsers block its
plain-HTTP coin-box calls, killing the coin flow silently. Drop `,trial` from
the `login-by=` line to turn the free trial off.

Source:

```
:local PROF "hsprof1";
:local NTP1 "216.239.35.8";
:local NTP2 "216.239.35.4";
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
:local dataDir ($HSFilePath . "/data");
:put ("portal files = " . $HSFilePath);
:if ([/file find name=($HSFilePath . "/portal.html")] = "") do={ :log warning ("setup: no portal.html under " . $HSFilePath) };
:if ([/file find name=($dataDir . "/.keep")] = "") do={
  :do { /file print file=($dataDir . "/.keep") where name="dummyfile" } on-error={};
  :local x 3;
  :while (($x>0) and ([/file find name=($dataDir . "/.keep")] = "")) do={ :set x ($x-1); :delay 1s };
  :do { /file remove ($dataDir . "/.keep") } on-error={};
};
:local rosV "";
:do { :set rosV [:pick [/system resource get version] 0 1] } on-error={ :set rosV "" };
:local ntpCmd "";
:if ($rosV = "7") do={ :set ntpCmd ("/system ntp client set enabled=yes servers=" . $NTP1 . "," . $NTP2) } else={ :set ntpCmd ("/system ntp client set enabled=yes primary-ntp=" . $NTP1 . " secondary-ntp=" . $NTP2) };
:do { :local ntpFn [:parse $ntpCmd]; $ntpFn } on-error={ :log warning "setup: NTP not configurable" };
:do { /system clock set time-zone-name=Asia/Manila } on-error={};
:do { /ip hotspot profile set [find name=$PROF] login-by=http-chap,http-pap,trial trial-uptime=5m/1d trial-user-profile=default } on-error={ :log warning ("setup: no hotspot profile named " . $PROF) };
:do { /ip hotspot user profile set [find name="default"] idle-timeout=none keepalive-timeout=30s status-autorefresh=1m } on-error={};
:if ([:len [/ip firewall filter find comment="hotspot before fasttrack"]] = 0) do={
  :do { /ip firewall filter add chain=forward action=accept protocol=tcp dst-port=80,443 src-address=10.0.0.0/16 place-before="top" comment="hotspot before fasttrack" } on-error={ :log warning "setup: fasttrack rule not added" };
};
:local siteFile ($dataDir . "/site-id.txt");
:local siteOld "";
:do { :set siteOld [/file get [find name=$siteFile] contents] } on-error={ :set siteOld "" };
:if ($siteOld = "") do={
  :local sn "";
  :do { :set sn [/system routerboard get serial-number] } on-error={};
  :if ([:len $sn] < 4) do={ :set sn $PROF };
  :do { /file print file=$siteFile where name="dummyfile" } on-error={};
  :local y 5;
  :while (($y>0) and ([/file find name=$siteFile] = "")) do={ :set y ($y-1); :delay 1s };
  :do { /file set $siteFile contents=$sn } on-error={ :log warning "setup: site-id not written" };
};
:local netFile ($dataDir . "/netstatus.txt");
:if ([/file find name=$netFile] = "") do={
  :do { /file print file=$netFile where name="dummyfile" } on-error={};
  :local z 5;
  :while (($z>0) and ([/file find name=$netFile] = "")) do={ :set z ($z-1); :delay 1s };
  :do { /file set $netFile contents="up" } on-error={ :log warning "setup: netstatus.txt not created" };
};
```

#### A2. Netwatch — internet up/down banner

**Tools → Netwatch → +**

| Field | Value |
| --- | --- |
| Name | `juanfi-netwatch` |
| Host | `8.8.8.8` |
| Type | `simple` |
| Interval | `00:00:10` |
| Timeout | `1s` |
| Down Script | `/file set [:pick [/file find name~"*data/netstatus.txt"] 0] contents="down"` |
| Up Script | `/file set [:pick [/file find name~"*data/netstatus.txt"] 0] contents="up"` |
| Policy | `read`, `write`, `test` |

The two scripts are single lines — that is all §A2 is:

Down Script:

```
/file set [:pick [/file find name~"*data/netstatus.txt"] 0] contents="down"
```

Up Script:

```
/file set [:pick [/file find name~"*data/netstatus.txt"] 0] contents="up"
```

That is the whole thing — no script, no scheduler. Netwatch pings `8.8.8.8`
every 10 seconds and flips the one file the portal already reads. Netwatch only
fires a script when the state actually *changes*, so the file is written on
every transition and never in between — flash wear stays flat.

Two bits of that line look odd on purpose, both about storage prefixes:

- `name~"*data/netstatus.txt"` — the leading `*` is what makes this work on a
  hex, hAP-ax, or anything else that stores files under `flash/`. The file is
  really `flash/hotspot/data/netstatus.txt`, and `*` in a RouterOS glob matches
  `/` as well, so the same string finds it on `hotspot/` and on `flash/hotspot/`
  without asking the router where the portal lives.
- `[:pick [/file find …] 0]` — `find` returns **every** match, and `/file set`
  wants exactly one id. If the file ends up in two places at once (a copy in
  `flash/` and another in the RAM overlay), the bare `find` version fails with
  "too many values" and the banner silently stops updating forever. `:pick 0`
  takes the first match and guarantees one id, so a duplicate costs you
  determinism but never the feature.

Policy must include `write`, or `/file set` is refused and the banner never
updates. If the file is missing entirely, both scripts fail silently — re-run
A1, which recreates it.

The portal shows a banner while that file reads `down`; the wording comes from
`offlineText` in `settings.json`, and `showInternetStatus: false` hides the
check entirely.

Two things this cannot see, both true of any ping:

- ICMP blocked, internet fine — an ISP that filters ping makes this report
  `down` forever. Point **Host** at something that answers if that happens
  (a DNS resolver, or your own gateway for "WAN up").
- WAN link up, internet gone — a router with a live cable to a dead uplink
  still answers locally, so this reports `down` correctly, but a captive
  portal redirect upstream will read as `up`.

#### A3. `juanfi-sweep` — daily orphan sweep (04:20)

Policy: `read`, `write`, `test`

The coin box picks one of 8,999 codes with no duplicate check, so codes that
are sold but never claimed pile up until new coins land on a live account and
top up the wrong customer. This removes any voucher that has a comment, no
expiry scheduler and no session for `GRACE` days. The first run only stamps
each row with today's date, so installing it can never mass-delete — the
sweep starts collecting on the run after that.

Source:

```
:local GRACE 3;
:local MD {31;28;31;30;31;30;31;31;30;31;30;31};
:local today [:pick [/system clock get date-time] 0 10];
:local Y [:tonum [:pick $today 0 4]];
:local M [:tonum [:pick $today 5 2]];
:local leap 0;
:if ((($Y % 4) = 0) and ((($Y % 100) != 0) or (($Y % 400) = 0))) do={ :set leap 1 };
:local doy [:tonum [:pick $today 8 2]];
:local k 1;
:while ($k < $M) do={
  :set doy ($doy + [:pick $MD ($k - 1)]);
  :if (($leap = 1) and ($k = 2)) do={ :set doy ($doy + 1) };
  :set k ($k + 1);
};
:local todayNo ((($Y - 1970) * 365) + (($Y - 1) / 4 - ($Y - 1) / 100 + ($Y - 1) / 400) - 479 + $doy);
:local stamped 0;
:local removed 0;
:foreach u in=[/ip hotspot user find] do={
  :local note [/ip hotspot user get $u comment];
  :if ([:len $note] > 0) do={
    :local name [/ip hotspot user get $u name];
    :if ([:len [/system scheduler find name=$name]] = 0) do={
      :if ([:len [/ip hotspot active find user=$name]] = 0) do={
        :local f [:toarray $note];
        :local seen "";
        :if ([:len $f] > 4) do={ :set seen ($f->4) };
        :if ($seen = "") do={
          :do { /ip hotspot user set $u comment=($note . "," . $today) } on-error={};
          :set stamped ($stamped + 1);
        } else={
          :local sY [:tonum [:pick $seen 0 4]];
          :local sM [:tonum [:pick $seen 5 2]];
          :local sLeap 0;
          :if ((($sY % 4) = 0) and ((($sY % 100) != 0) or (($sY % 400) = 0))) do={ :set sLeap 1 };
          :local sDoy [:tonum [:pick $seen 8 2]];
          :local j 1;
          :while ($j < $sM) do={
            :set sDoy ($sDoy + [:pick $MD ($j - 1)]);
            :if (($sLeap = 1) and ($j = 2)) do={ :set sDoy ($sDoy + 1) };
            :set j ($j + 1);
          };
          :local seenNo ((($sY - 1970) * 365) + (($sY - 1) / 4 - ($sY - 1) / 100 + ($sY - 1) / 400) - 479 + $sDoy);
          :if (($todayNo - $seenNo) > $GRACE) do={
            :do { /ip hotspot active remove [find user=$name] } on-error={};
            :do { /ip hotspot user remove $u } on-error={};
            :set removed ($removed + 1);
          };
        };
      };
    };
  };
};
:log info ("juanfi-sweep: grace=" . $GRACE . "d stamped=" . $stamped . " removed=" . $removed);
:put ("juanfi-sweep: grace=" . $GRACE . "d stamped=" . $stamped . " removed=" . $removed);
```

Then schedule it — **System → Scheduler → +**:

| Field | Value |
| --- | --- |
| Name | `juanfi-sweep-daily` |
| Start Time | `04:20:00` |
| Interval | `1 day` |
| On Event | `/system script run juanfi-sweep` |
| Policy | `read`, `write`, `test` |

Run it once by hand, then read the **Log** menu: it should show
`juanfi-sweep: grace=3d stamped=N removed=M`. On a fresh install `stamped`
matches your live voucher count and `removed` should be `0`.

#### A4. Optional: re-run setup daily

A RouterOS upgrade, or anyone tidying the hotspot profile in Winbox, can undo
what A1 applied. This puts it back on every reboot.

**System → Scheduler → +**:

| Field | Value |
| --- | --- |
| Name | `juanfi-setup-daily` |
| Start Time | `startup` |
| Interval | `1 day` |
| On Event | `/system script run juanfi-setup` |
| Policy | `read`, `write`, `test`, `policy`, `ftp` |

### B. On-Login

Hotspot → Server Profiles → your profile → **Login** tab → **On Login**.

Maximize the window first, the field is small. Run A1 first, so
`data/site-id.txt` exists before anyone logs in.

Paste everything between the fences into that box — the first line through the
closing brace on the last line. Then OK. It is also saved as
[`OnLogin.txt`](OnLogin.txt) if you would rather open the file.

```
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
# Trial sessions expire natively via trial-uptime (A1) — never
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

Trials skip the timer here on purpose — they expire via `trial-uptime` (A1),
and deleting a trial row would reset its MAC wait. The portal splits the
session file on the last `#`, so member names containing `#` still work.

Ran an older build? Delete the leftovers: scripts `day-report`, `month-report`,
`todayincome`, `monthlyincome`, `tg-creds` and schedulers `Reset Daily
Income`, `Reset Monthly Income`, `tg-creds-boot`. Nothing reads them.

Came from the version that used a scheduler instead of netwatch? Delete script
`juanfi-netstatus` and scheduler `juanfi-netstatus-1m`, then add the
`juanfi-netwatch` entry from §A2. Leaving the scheduler in place is not fatal —
both write the same file — but it pings on top of netwatch and wins half the
races, so the banner can lag by up to a minute.


### C. On-Logout (same profile)

Same **Login** tab → **On Logout** box. Paste this whole block, then OK. Also
saved as [`OnLogout.txt`](OnLogout.txt).

```
:if ($cause="session timeout") do={
  /system scheduler set [find name="$user"] interval=5s;
}
```

Only `session timeout` shortens the timer; other logout causes leave it at
full interval, which preserves the customer's remaining minutes.


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
  "macAsVoucherCode": false,
  "showConvertVoucher": true
}
```
   `false` on `showMemberSection` = voucher-only portal. `core.js`
   carries the same defaults built in plus a sync JSON fetch, so the
   portal survives a missing file. Per-site values go on the router copy
   only — never commit them.

   `macAsVoucherCode: true` sends each client's own MAC (colons
   stripped) as the voucher code. The box only mints a random code when
   `topUp` carries an empty voucher, so this gives you a 48-bit
   namespace instead of 8,999 codes and retires the silent collision
   where a random mint tops up a stranger. The field stays editable, so
   a real `VC` code still works. Leave it off if you hand out typeable
   codes (GCash, reselling) or need the admin-panel prefix to identify
   buyers.

   `showConvertVoucher: true` adds an "Add time with another code" row
   to the coin panel — the customer types a second voucher and the coin
   box folds its minutes into the open session, no coins needed. The box
   must answer `POST /convertVoucher`: this repo's firmware does, the
   original JuanFi box does not. On a build without it the button reports
   that the box cannot do it, never that the customer's code is bad.
   Turn it off to hide the row.

Bump the `?v=N` query on every first-party asset (`core.css`,
`JuanFiV2.css`, `boot.js`, `core.js` in `portal.html` +
router shells) on every portal change so phones don't serve stale JS.
Vendored libs stay pinned at `?v=26`. The footer `vN` tag should match.

## Optional

- Vendo picker (multi-vendo only): `isMultiVendo = true` is the
  single switch. Manual mode shows the dropdown automatically; auto
  modes resolve silently. Single vendo stays hidden.

## License

[MIT](https://choosealicense.com/licenses/mit/)
