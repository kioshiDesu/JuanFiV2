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

### A. Router setup

Every line below is one complete command. Paste them one at a time into
Winbox → New Terminal (or SSH), in order. No `:do`, no line
continuations, nothing that needs rearranging. A line that fails just prints
an error and you carry on — run it again any time, it is safe to re-run.

Still want it in one shot? Copy
[`juanfi-setup.rsc`](juanfi-setup.rsc) to the router and
`/import file=juanfi-setup.rsc`.

Edit `hsprof1`, `NTP1`/`NTP2` and `Asia/Manila` to match your router.

#### A1. Hotspot profile

```
/ip hotspot profile set [find name="hsprof1"] login-by=http-chap,http-pap,trial trial-uptime=5m/1d trial-user-profile=default
/ip hotspot user profile set [find name="default"] idle-timeout=none keepalive-timeout=30s status-autorefresh=1m
```

Never enable HTTPS login — the page then loads over TLS and browsers
block its plain-HTTP coin-box calls, killing the coin flow silently.
Drop `,trial` to turn the free trial off.

#### A2. Clock + NTP

A wrong year makes scheduler `next-run` garbage, which makes voucher
validity garbage. RouterOS 6 and 7 name the property differently, so it is
built as text and run through `:parse`.

```
:local NTP1 "216.239.35.8"
:local NTP2 "216.239.35.4"
:local rosV [:pick [/system resource get version] 0 1]
:local ntpCmd ("/system ntp client set enabled=yes primary-ntp=" . $NTP1 . " secondary-ntp=" . $NTP2)
:if ($rosV = "7") do={ :set ntpCmd ("/system ntp client set enabled=yes servers=" . $NTP1 . "," . $NTP2) }
:local ntpFn [:parse $ntpCmd]
$ntpFn
/system clock set time-zone-name=Asia/Manila
```

#### A3. FastTrack fix

Accepts hotspot traffic before FastTrack. Without it, fasttracked sessions
skip idle accounting and never log out.

```
:if ([:len [/ip firewall filter find comment="hotspot before fasttrack"]] = 0) do={ /ip firewall filter add chain=forward action=accept protocol=tcp dst-port=80,443 src-address=10.0.0.0/16 place-before="top" comment="hotspot before fasttrack" }
```

#### A4. Site ID

One-time. Gives every router its own voucher-history bucket.

```
:local d ""
:foreach c in={"flash/hotspot"; "hotspot"} do={ :if (($d = "") and ([/file find name=($c . "/portal.html")] != "")) do={ :set d $c } }
:if ($d = "") do={ :set d "hotspot" }
:if ([/file find name=($d . "/data/site-id.txt")] = "") do={ /file print file=($d . "/data/site-id.txt") where name="dummyfile" }
:local y 5
:while (($y>0) and ([/file find name=($d . "/data/site-id.txt")] = "")) do={ :set y ($y-1); :delay 1s }
:local sn [:pick [/system routerboard get serial-number] 0]
:if ([:len [/file find name=($d . "/data/site-id.txt")]] != "") do={ /file set ($d . "/data/site-id.txt") contents=$sn }
/file print detail where name="site-id.txt"
```

#### A5. Internet status

Writes `up`/`down` into `data/netstatus.txt` every minute; the portal shows
a banner while it reads `down`. Re-resolves the portal folder on each run
and only writes on change, so flash wear stays flat.

Line 1 and 2 remove any earlier copy, so re-running is safe. Line 3 stores
the script — that one line is long on purpose, it is a single command.
Line 4 schedules it every minute, line 5 runs it once so you see the result.

```
/system script remove [find name="juanfi-netstatus"]
/system scheduler remove [find name="juanfi-netstatus-1m"]
/system script add name="juanfi-netstatus" policy=read,write,test source={ :local HSFilePath ""; :foreach c in={"flash/hotspot"; "hotspot"} do={ :if ($HSFilePath = "") do={ :foreach f in={"portal.html"; "login.html"; "status.html"} do={ :if (($HSFilePath = "") and ([/file find name=($c . "/" . $f)] != "")) do={ :set HSFilePath $c }; }; }; }; :if ($HSFilePath = "") do={ :do { :local pf [:pick [/ip hotspot profile print as-value] 0]; :if (($pf != "") and (($pf->"html-directory") != "")) do={ :set HSFilePath ($pf->"html-directory") }; } on-error={}; }; :if ($HSFilePath = "") do={ :set HSFilePath "hotspot" }; :local dataDir ($HSFilePath . "/data"); :local f ($dataDir . "/netstatus.txt"); :local state "down"; :if ([/ping 8.8.8.8 count=1 interval=1s] > 0) do={ :set state "up" }; :local old ""; :do { :set old [/file get [find name=$f] contents] } on-error={ :set old "" }; :if ($old != $state) do={ :if ([/file find name=$f] = "") do={ :do { /file print file=$f where name="dummyfile" } on-error={}; :local x 3; :while (($x>0) and ([/file find name=$f] = "")) do={ :set x ($x-1); :delay 1s }; }; :do { /file set $f contents=$state } on-error={ :log warning ("netstatus: " . $f . " not written") }; }; }
/system scheduler add name="juanfi-netstatus-1m" start-time=startup interval=1m policy=read,write,test on-event="/system script run juanfi-netstatus"
/system script run juanfi-netstatus
```

#### A6. Orphan sweep (daily 04:20)

The coin box picks one of 8,999 codes with no duplicate check, so codes that
are sold but never claimed pile up until new coins land on a live account
and top up the wrong customer. This removes any voucher that has a comment,
no expiry scheduler and no session for `GRACE` days. First run only stamps,
so installing it can never mass-delete.

```
/system script remove [find name="juanfi-sweep"]
/system scheduler remove [find name="juanfi-sweep-daily"]
/system script add name="juanfi-sweep" policy=read,write,test source={ :local GRACE 3; :local MD {31;28;31;30;31;30;31;31;30;31;30;31}; :local today [:pick [/system clock get date-time] 0 10]; :local Y [:tonum [:pick $today 0 4]]; :local M [:tonum [:pick $today 5 2]]; :local leap 0; :if ((($Y % 4) = 0) and ((($Y % 100) != 0) or (($Y % 400) = 0))) do={ :set leap 1 }; :local doy [:tonum [:pick $today 8 2]]; :local k 1; :while ($k < $M) do={ :set doy ($doy + [:pick $MD ($k - 1)]); :if (($leap = 1) and ($k = 2)) do={ :set doy ($doy + 1) }; :set k ($k + 1); }; :local todayNo ((($Y - 1970) * 365) + (($Y - 1) / 4 - ($Y - 1) / 100 + ($Y - 1) / 400) - 479 + $doy); :local stamped 0; :local removed 0; :foreach u in=[/ip hotspot user find] do={ :local note [/ip hotspot user get $u comment]; :if ([:len $note] > 0) do={ :local name [/ip hotspot user get $u name]; :if ([:len [/system scheduler find name=$name]] = 0) do={ :if ([:len [/ip hotspot active find user=$name]] = 0) do={ :local f [:toarray $note]; :local seen ""; :if ([:len $f] > 4) do={ :set seen ($f->4) }; :if ($seen = "") do={ :do { /ip hotspot user set $u comment=($note . "," . $today) } on-error={}; :set stamped ($stamped + 1); } else={ :local sY [:tonum [:pick $seen 0 4]]; :local sM [:tonum [:pick $seen 5 2]]; :local sLeap 0; :if ((($sY % 4) = 0) and ((($sY % 100) != 0) or (($sY % 400) = 0))) do={ :set sLeap 1 }; :local sDoy [:tonum [:pick $seen 8 2]]; :local j 1; :while ($j < $sM) do={ :set sDoy ($sDoy + [:pick $MD ($j - 1)]); :if (($sLeap = 1) and ($j = 2)) do={ :set sDoy ($sDoy + 1) }; :set j ($j + 1); }; :local seenNo ((($sY - 1970) * 365) + (($sY - 1) / 4 - ($sY - 1) / 100 + ($sY - 1) / 400) - 479 + $sDoy); :if (($todayNo - $seenNo) > $GRACE) do={ :do { /ip hotspot active remove [find user=$name] } on-error={}; :do { /ip hotspot user remove $u } on-error={}; :set removed ($removed + 1); }; }; }; }; }; }; :log info ("juanfi-sweep: grace=" . $GRACE . "d stamped=" . $stamped . " removed=" . $removed); :put ("juanfi-sweep: grace=" . $GRACE . "d stamped=" . $stamped . " removed=" . $removed); }
/system scheduler add name="juanfi-sweep-daily" start-time=04:20:00 interval=1d policy=read,write,test on-event="/system script run juanfi-sweep"
/system script run juanfi-sweep
```

Check what it did:

```
/log print where message~"juanfi-sweep"
/file print detail where name="netstatus.txt"
```

Line 3 of A5 and A6 is one very long line. If your terminal refuses it,
make the script in Winbox instead: System → Scripts → **+**, name it
`juanfi-sweep`, tick Policy `read` `write` `test`, paste the same text into
**Source** without the `/system script add … source={` front and the trailing
`}`. Then run lines 4 and 5.


### B. On-Login

Hotspot → Server Profiles → your profile → Login tab → On Login.
Maximize the window first, the field is small. Run A4 before A so
`data/site-id.txt` exists.

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

Trials skip the timer here on purpose — they expire via `trial-uptime`
(A1), and deleting a trial row would reset its MAC wait. The portal
splits the session file on the last `#`, so member names containing `#`
still work. Ran an older build? Delete the leftovers: scripts
`day-report`, `month-report`, `todayincome`, `monthlyincome`,
`tg-creds` and schedulers `Reset Daily Income`, `Reset Monthly Income`,
`tg-creds-boot`. Nothing reads them.

### C. On-Logout (same profile)

Winbox: same Login tab → On Logout box, paste, OK.

Only `session timeout` shortens the timer; other logout causes leave it
at full interval, which preserves the customer's remaining minutes:

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
   box folds its minutes into the open session, no coins needed. Only
   works on box builds that answer `POST /convertVoucher`; on a build
   without it the button reports that the box cannot do it, never that
   the customer's code is bad. Turn it off to hide the row.

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
