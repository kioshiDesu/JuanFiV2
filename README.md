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

**Pasting.** Every block below is written as one complete command per line, with
no `\` line continuations and nothing that depends on indentation. That is
deliberate: a continuation whose trailing space survives the copy, or one a
terminal drops or auto-indents around, turns one command into two broken ones.
Two rules if you paste into a terminal instead of a Winbox source box:

- Paste one command at a time, and skip the blank lines. Some terminals treat a
  blank line as a repeat of the last command, and the blank lines here are there
  to be read, not run.
- Paste B and C whole or not at all. They are the On-Login and On-Logout sources
  and are byte-identical to `OnLogin.txt` / `OnLogout.txt`; half a paste leaves
  the login path working but unwatched, which is worse than not applying it.

Before you start: in the `juanfi-setup` source, edit `PROF` (the hotspot
profile name, `juanfi` by default), `NTP1`/`NTP2` and `Asia/Manila` to match
your router.

#### A1. `juanfi-setup` — profile, clock, NTP, FastTrack, site ID

Policy: `read`, `write`, `test`, `policy`, `ftp`

Sets the hotspot and user profiles, syncs the clock, adds the FastTrack accept
rule, and publishes this router's own site id into `data/site-id.txt`.

That site id is what splits voucher history per venue — the customer's phone
stores `voucherHistory_<site id>`, so two venues only share a list if they
publish the same id. It comes from the router's serial number; if that is
missing the script falls back to the router's identity name, then to the board
model, and logs a warning for the last one. **Give every venue a distinct
`System > Identity` name** — on a board with no serial that name is the only
thing keeping two venues' histories apart, and board model is not unique.

That only works when each venue has its own router. One router serving several
venues through VLANs publishes a single site id, and no identity name changes
that; a centralised install has to separate them some other way.

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
# Which hotspot SERVER profile is ours? Boxes name it anything, so find the one
# whose html-directory actually holds portal.html rather than trusting "juanfi".
# html-directory comes back RELATIVE ("hotspot"), but files live at
# "flash/hotspot" - so check both prefixes or nothing ever matches.
:local PROF "";
:foreach p in=[/ip hotspot profile find] do={
  :if ($PROF = "") do={
    :local ph "";:do { :set ph [/ip hotspot profile get $p html-directory] } on-error={};
    :foreach pre in={""; "flash/"} do={
      :if (($PROF = "") and ([:len $ph] > 0) and ([/file find name=($pre . $ph . "/portal.html")] != "")) do={ :set PROF [/ip hotspot profile get $p name] };
    };
  };
};
:if ($PROF = "") do={ :set PROF "juanfi" };
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
  :if ([:len $sn] < 4) do={ :do { :set sn [/system identity get name] } on-error={} };
  :if ([:len $sn] < 4) do={
    :do { :set sn [/system routerboard get board-name] } on-error={};
    :log warning "setup: no serial-number, site id falls back to board-name";
  };
  :if ([:len $sn] < 4) do={ :set sn $PROF };
  :do { /file print file=$siteFile where name="dummyfile" } on-error={};
  :local y 5;
  :while (($y>0) and ([/file find name=$siteFile] = "")) do={ :set y ($y-1); :delay 1s };
  :do { /file set $siteFile contents=$sn } on-error={ :log warning "setup: site-id not written" };
};
```

#### A2. `juanfi-sweep` — daily orphan sweep (04:20)

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

#### A3. Optional: re-run setup daily

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

Hotspot → **User Profiles** → `default` → **Login** tab → **On Login**.

`on-login` and `on-logout` are properties of the hotspot **user profile**, not
the server profile. The server profile's Login tab holds the `login-by`
checkboxes and `trial-uptime` — there is no script field there. Every voucher
created by the firmware lands on the `default` user profile
(`/ip hotspot user add` with no `profile=`), so `default` is the one that
fires.

Maximize the window first, the field is small. Run A1 first, so
`data/site-id.txt` exists before anyone logs in.

Paste everything between the fences into that box — the first line through the
closing brace on the last line. Then OK. It is also saved as
[`OnLogin.txt`](OnLogin.txt) if you would rather open the file.

```
# WHERE THIS GOES
# IP -> Hotspot -> User Profiles -> default -> Login tab -> On Login
#
# NOT Hotspot -> Server Profiles. The server profile's Login tab only holds
# login-by checkboxes and trial-uptime; there is no script field there.
# Every voucher the ESP creates is "/ip hotspot user add name=X" with no
# profile=, so they all land on "default".
#
# Paste from the first line below to the closing brace. Clear the box first -
# an older copy may still be sitting there.
#
# Run README script A1 FIRST. On-Login expects data/site-id.txt to exist.
#
# This is the original JuanFi on-login script (ivanalayan15/JuanFi README
# step 8) with exactly one change, marked CHANGE below. Everything else is
# verbatim, including the parts that look odd.
#
# Original also has three optional blocks for the upstream author's vending
# business: Telegram notification, JuanFi online-monitoring API, and
# daily/monthly income counters. They are dropped. The income counters call
# "/system script get todayincome" with no error guard - if those scripts do
# not exist, that line aborts the script.
#
# OnLogout.txt goes in the same tab's On Logout box.

# CHANGE vs upstream: "flash/hotspot". Upstream ships "hotspot" and its own
# comment says to change it for hex boards. Uncomment the other if needed.
:local HSFilePath "flash/hotspot";

# --- # Get User Data -------------------------------------------------------
:local aUsrNote [/ip hotspot user get $user comment];
:local aUsrNote [:toarray $aUsrNote];
:local iUsrTime [:totime ($aUsrNote->0)];
:local iSaleAmt [:tonum ($aUsrNote->1)];
:local iExtCode ($aUsrNote->2);
:local iVdoName ($aUsrNote->3);
:local iTimeMin [/ip hotspot user get $user limit-uptime];
:local iUserReg [/system scheduler find name=$user];

# The session-file name. Upstream derives this INSIDE the gate below, which
# only runs on a voucher's first login. The resume block at the bottom needs
# it too, and a resume is exactly the case the gate skips.
:local iFileMac;
:local mac $"mac-address";
:for i from=0 to=([:len $mac] - 1) do={
  :local chr [:pick $mac $i]
  :if ($chr = ":") do={ :set $chr "" }
  :set iFileMac ($iFileMac . $chr)
}

# --- # Check User Data -----------------------------------------------------
:if (($iTimeMin>0) and ($iUsrTime>=0) and (($iUserReg="") or ($iExtCode=1))) do={
  /ip hotspot user set $user comment="";
# --- # Extend User ---------------------------------------------------------
  :if (($iUserReg!="") and ($iExtCode=1)) do={
    :local iTimeInt [/system scheduler get $user interval];
    :set iTimeInt ($iTimeInt+$iUsrTime);
    :if ($iTimeMin>$iTimeInt) do={ :set iTimeInt ($iTimeMin+$iUsrTime) };
    /system scheduler set $user interval=$iTimeInt;
  }
# --- # ADD User ------------------------------------------------------------
  :local iDateBeg [/system clock get date];
  :local iTimeBeg [/system clock get time];
  :if ($iUserReg="") do={
    :local iTimeInt $iUsrTime;
    :if ($iTimeMin>$iUsrTime) do={ :set iTimeInt ($iTimeMin+$iUsrTime) };
    :do { /system scheduler add name="$user" interval=$iTimeInt \
      start-date=$iDateBeg start-time=$iTimeBeg disable=no \
      policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon \
      on-event=("/ip hotspot user remove [find name=$user];\r\n".\
                "/ip hotspot active remove [find user=$user];\r\n".\
                "/ip hotspot cookie remove [find user=$user];\r\n".\
                "/system scheduler remove [find name=$user];\r\n".\
                ":do {/file remove \"$HSFilePath/data/$iFileMac.txt\"} on-error={};\r\n")
    } on-error={ log error "( $user ) /system scheduler add => ERROR ADD!" };
    :local x 10;:while (($x>0) and ([/system scheduler find name="$user"]="")) do={:set x ($x-1);:delay 1s};
  };
# --- # Save Data File ------------------------------------------------------
  :if ([/file find name="$HSFilePath/data"]="") do={
    :do {/tool fetch dst-path=("$HSFilePath/data/.") url="https://127.0.0.1/"} on-error={ };
  }
  :local iValidUntil [/system scheduler get $user next-run];
  :if ([/system scheduler find name=$user]!="") do={
    /file print file="$HSFilePath/data/$iFileMac.txt" where name="dummyfile";
    :local x 10;:while (($x>0) and ([/file find name="$HSFilePath/data/$iFileMac.txt"]="")) do={:set x ($x-1);:delay 1s};
    # CHANGE vs upstream: upstream writes "$HSFilePath/data/$iFileMac" with no
    # .txt extension, while the line above creates <mac>.txt. The set then
    # targets a file that does not exist, errors out, and leaves the .txt
    # empty. The portal reads that file, so an empty one looks exactly like a
    # missing one. Same extension on both sides.
    /file set "$HSFilePath/data/$iFileMac.txt" contents="$user#$iValidUntil";
    # ponytail: the log line is the only way to tell "file written" from
    # "gate skipped" from "no scheduler". Delete once it has done its job.
    :log info ("On-Login(" . $user . "): mac=[" . $iFileMac . "] dir=" . $HSFilePath . " time=[" . $iTimeMin . "] usr=[" . $iUsrTime . "] valid=[" . $iValidUntil . "]");
  }
# --- end of gate -----------------------------------------------------------
};

# --- resume: put the pause mark back -----------------------------------------
# OnLogout.txt moves data/<mac>.txt aside to p<mac>.txt on a pause, so the
# portal's resumeSession() gets a 404 instead of auto-connecting from another
# browser. Reaching here IS the customer reconnecting on purpose, so put the
# file back. Runs outside the gate on purpose: a resume has an empty comment,
# which is the one thing that always skips the gate.
#
# No hardcoded path and no /file move, for the same reasons as OnLogout: the
# storage prefix is not reliably part of a file name, and /file move is the one
# command here not already proven on this box.
#
# The scheduler is never touched. Pausing does not stop expiry - the voucher
# still runs out on its original next-run, exactly as before this block.
:local jfMSuf ("p" . $iFileMac . ".txt");
:local jfErr "";
:local jfHit "";
:onerror jfErr in={ :set jfHit [:pick [/file find where name~(".*" . $jfMSuf . "$")] 0] } do={ :set jfHit "" };
:local jfMark "";
:local jfBody "";
:if ($jfHit != "") do={
  :local jfErr "";
  :onerror jfErr in={ :set jfMark [/file get $jfHit name] } do={ :set jfMark "" };
  :local jfErr "";
  :onerror jfErr in={ :set jfBody [/file get $jfHit contents] } do={ :set jfBody "" };
};
# Same directory, p- dropped.
:local jfSess "";
:if ($jfMark != "") do={ :set jfSess ([:pick $jfMark 0 ([:len $jfMark] - [:len $jfMSuf])] . $iFileMac . ".txt") };

:if (($jfHit != "") and ($jfBody != "")) do={
  :local jfErr "";
  :onerror jfErr in={
    :local jfOld "";
    :onerror jfErr in={ :set jfOld [:pick [/file find where name=($jfSess)] 0] } do={ :set jfOld "" };
    :if ($jfOld != "") do={ /file remove $jfOld };
    /file print file=$jfSess where name="dummyfile";
    /file set $jfSess contents=$jfBody;
    /file remove $jfHit;
  } do={ :log warning ("On-Login(" . $user . "): pause mark clear failed err=[" . $jfErr . "] mark=[" . $jfMark . "] sess=[" . $jfSess . "]") };
  :local jfMade "";
  :local jfErr "";
  :onerror jfErr in={ :set jfMade [:pick [/file find where name=($jfSess)] 0] } do={ :set jfMade "" };
  :if ($jfMade != "") do={ :log info ("On-Login(" . $user . "): resumed, pause mark cleared") };
}
```

Trials skip the timer here on purpose — they expire via `trial-uptime` (A1),
and deleting a trial row would reset its MAC wait. The portal splits the
session file on the last `#`, so member names containing `#` still work.

**The session clamp is gone.** JuanFiV2 used to carry an extra block that reset
`limit-uptime` to whatever was genuinely left before `next-run` on every login.
It is not in the original script and it is not here any more. Without it,
`limit-uptime` is only ever read by this script, never written, so a reconnect
takes the "empty comment, timer skipped" branch and inherits a fresh full
`limit-uptime` from the firmware while the scheduler's `next-run` keeps ticking
as the real balance. On this box `idle-timeout=none`, so there is no reconnect
window to exploit — but if you ever set one, that is the hole, and the clamp
has to come back.

Ran an older build? Delete the leftovers: scripts `day-report`, `month-report`,
`todayincome`, `monthlyincome`, `tg-creds` and schedulers `Reset Daily
Income`, `Reset Monthly Income`, `tg-creds-boot`. Nothing reads them.

Came from the version that used a scheduler instead of netwatch? Delete script
`juanfi-netstatus` and scheduler `juanfi-netstatus-1m`. The portal has no
internet up/down banner, so nothing reads `netstatus.txt` any more.


### C. On-Logout (same user profile)

Same **User Profiles → default → Login** tab → **On Logout** box. Paste this
whole block, then OK. Also saved as [`OnLogout.txt`](OnLogout.txt).

```
# JuanFi - hotspot USER PROFILE (default), Login tab -> On Logout.
#
# NOT the server profile. on-logout is a property of the hotspot user
# profile; the server profile's Login tab holds login-by and trial-uptime
# and has no script field. Every voucher the firmware creates is
# /ip hotspot user add with no profile=, so they all land on `default`.
#
# Paste everything from the first line below to the closing brace. Same box
# as OnLogin.txt, different field.
#
# CHANGE vs upstream: upstream is one line that only sets interval=5s and
# never re-anchors, so it does nothing. Two blocks below, both real.

# --- session timeout: end the voucher now -----------------------------------
:if ($cause="session timeout") do={
  # interval alone does NOT move an already-computed next-run, so the 5s
  # never took effect. Re-anchor start-date/start-time to now so next-run
  # is recomputed ~5s out, then shrink the interval too.
  :local jfNow [/system clock get time];
  :do { /system scheduler set [find name="$user"] interval=5s start-date=[/system clock get date] start-time=($jfNow + 5s) } on-error={ :log warning ("On-Logout(" . $user . "): scheduler timeout set failed") };
}

# --- pause: hide the session file so no other browser auto-resumes ----------
# The portal's resumeSession() reads data/<mac>.txt in ANY browser and, if the
# expiry is still in the future, fills the voucher and auto-clicks CONNECT.
# The only guard there is a localStorage flag, which does not travel to a
# different browser or a different device. So pause on the phone, reconnect on
# the laptop, and the laptop logs itself straight back in.
#
# Recreating the file under a p- name makes that GET 404 until the customer
# deliberately reconnects. OnLogin.txt puts it back on login, so the pause
# holds across browsers but not forever.
#
# Deliberately has no destructive power: the scheduler is untouched, so a
# false positive here (a WiFi blip that also reports "user request") costs the
# customer one CONNECT tap and nothing else. That is why this gates on $cause
# without trying to tell a pause apart from a typed /logout.

# No hardcoded path anywhere in this block. RouterOS stores flash under a
# storage prefix that is not reliably part of the name, so
# [/file find name="flash/hotspot/data/x.txt"] can miss a file that plainly
# exists. Find by suffix instead, then ask /file get for the real name.
:local jfPM "";:local jfMC $"mac-address";
:for i from=0 to=([:len $jfMC] - 1) do={
  :local jfC [:pick $jfMC $i]
  :if ($jfC != ":") do={ :set jfPM ($jfPM . $jfC) }
};
:local jfSuf ($jfPM . ".txt");
:local jfErr "";
:local jfHit "";
:onerror jfErr in={ :set jfHit [:pick [/file find where name~(".*" . $jfSuf . "$")] 0] } do={ :set jfHit "" };
:local jfReal "";
:if ($jfHit != "") do={
  :local jfErr "";
  :onerror jfErr in={ :set jfReal [/file get $jfHit name] } do={ :set jfReal "" };
};
# Same directory, p- prefixed name, taken off the real name rather than rebuilt.
:local jfTo "";
:if ($jfReal != "") do={ :set jfTo ([:pick $jfReal 0 ([:len $jfReal] - [:len $jfSuf])] . "p" . $jfSuf) };

:local jfBody "";
:if ($jfHit != "") do={
  :local jfErr "";
  :onerror jfErr in={ :set jfBody [/file get $jfHit contents] } do={ :set jfBody "" };
};

:local jfMsg [:tostr [:len $jfHit]];
:log info ("On-Logout-DEBUG(" . $user . ") cause=[" . $cause . "] mac=[" . $jfMC . "] pm=[" . $jfPM . "] real=[" . $jfReal . "] to=[" . $jfTo . "] hit=" . $jfMsg);

:if (($cause="user request") and ($jfHit != "") and ($jfBody != "")) do={
  # No /file move. It is the one command here not already proven to work
  # on this box, and it failed there. Recreate at the new name instead:
  # /file print makes it, /file set fills it, then drop the old one.
  #
  # :onerror rather than :do ... on-error because it hands back the real
  # reason in $jfErr instead of a fixed string.
  :local jfErr "";
  :onerror jfErr in={
    :local jfNew "";
    :onerror jfErr in={ :set jfNew [:pick [/file find where name=($jfTo)] 0] } do={ :set jfNew "" };
    :if ($jfNew != "") do={ /file remove $jfNew };
    /file print file=$jfTo where name="dummyfile";
    /file set $jfTo contents=$jfBody;
    /file remove $jfHit;
  } do={ :log warning ("On-Logout(" . $user . "): pause mark failed err=[" . $jfErr . "] to=[" . $jfTo . "]") };
  :local jfMade "";
  :local jfErr "";
  :onerror jfErr in={ :set jfMade [:pick [/file find where name=($jfTo)] 0] } do={ :set jfMade "" };
  :if ($jfMade != "") do={ :log info ("On-Logout(" . $user . "): paused, session file marked") };
}
```

Only `session timeout` shortens the timer; other logout causes leave it at
full interval, which preserves the customer's remaining minutes.

**Pause across browsers.** The `user request` block is the pause. On-Logout
renames `data/<mac>.txt` to `data/p<mac>.txt`; On-Login renames it back. That
matters because `resumeSession()` in `core.js` will read `data/<mac>.txt` in
**any** browser and auto-click CONNECT when the expiry is still in the future.
Its only guard is a localStorage flag, which does not travel — so without the
rename, pausing on the phone and reconnecting on the laptop logs the customer
straight back in. With it, the other browser gets a 404 and shows the login
page until they deliberately tap CONNECT, at which point On-Login puts the file
back.

The scheduler is never touched, so pausing does **not** stop expiry: the
voucher still runs out on its original `next-run`, exactly as before. Session
uptime stops on its own, because RouterOS drops the active session on logout.

It also cannot do damage if it fires when it should not. A WiFi blip that
reports `user request` too would leave a pause mark nobody set, and all that
costs is one extra CONNECT tap — no time is lost, because nothing about the
scheduler or the balance changed.


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
