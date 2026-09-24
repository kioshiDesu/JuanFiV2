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
- MT-side alerts: per-sale telegram pings, daily/monthly income
  reports, all tagged per site
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

### C. Telegram globals + income counters

One bot for all vendos (sends-only DM). Set the token/chat once here —
day/month-report and On-Login all read these globals. The ESP writes
the sale peso amount into the user comment; On-Login accumulates it
into the counters below (same as upstream):

```bash
/system script add name=todayincome source="0" policy=read,write comment="vendo income";
/system script add name=monthlyincome source="0" policy=read,write comment="vendo income";
:global tgBotToken "REPLACE-ME";
:global tgChatId "REPLACE-ME";
```

(Set once — rotate the token here and every script follows. Portal
coin pings keep their own `tgBotToken`/`tgChatId` in `config.js`,
phones can't read MT.)

Winbox method (no terminal paste): System → Scripts → `+` per
script — Name = `todayincome`, Source = `0`, tick Policy `read` +
`write`, Apply + OK. Same for `monthlyincome`, then `day-report` /
`month-report` (Source = the `{...}` body, Policy `read,write,ftp`).
Globals have no Winbox form — New Terminal → paste the two
`:global` lines, Enter. Run-check: select a script → Run Script.

```bash
/system script add name=day-report policy=read,write,ftp source={
  :global tgBotToken;
  :global tgChatId;
  :local day ([:tonum [/system script get todayincome source]]);
  :local siteId [/system identity get name];
  :local cfgPath "hotspot/assets/js/config.js";
  :if ([/file find name="flash/hotspot/assets/js/config.js"] != "") do={ :set cfgPath "flash/hotspot/assets/js/config.js"; }
  :do {
    :local cfg [/file get [find name=$cfgPath] contents];
    :local key "brandHeaderHtml = \"";
    :local p [:find $cfg $key];
    :if ([:typeof $p] != "nil") do={
      :local rest [:pick $cfg ($p + [:len $key]) [:len $cfg]];
      :local q [:find $rest "\""];
      :if ([:typeof $q] != "nil") do={
        :local brand [:pick $rest 0 $q];
        :local tagst 0;
        :local plain "";
        :for j from=0 to=([:len $brand]-1) do={
          :local bc [:pick $brand $j];
          :if ($bc = "<") do={ :set tagst 1 };
          :if ($tagst = 0) do={ :set plain ($plain . $bc) };
          :if ($bc = ">") do={ :set tagst 0 };
        }
        :if ($plain != "") do={ :set siteId $plain };
      }
    }
  } on-error={};
  :local siteTag "";
  :for i from=0 to=([:len $siteId]-1) do={
    :local ch [:pick $siteId $i];
    :if ($ch = " ") do={ :set ch "_" };
    :set siteTag ($siteTag . $ch);
  }
  :local msg ("day closed: P" . $day . " | Site: " . $siteId . "%20%23daily %23" . $siteTag);
  :local eMsg "";
  :for ei from=0 to=([:len $msg]-1) do={ :local ech [:pick $msg $ei]; :if ($ech = " ") do={ :set ech "%20" }; :if ($ech = "#") do={ :set ech "%23" }; :if ($ech = "&") do={ :set ech "%26" }; :set eMsg ($eMsg . $ech); };
  :do {/tool fetch url="https://api.telegram.org/bot$tgBotToken/sendmessage?chat_id=$tgChatId&text=$eMsg" keep-result=no} on-error={ :log warning "day-report: telegram send failed" };
  /system script set todayincome source="0";
};
/system scheduler add name="Reset Daily Income" interval=1d start-time=00:00:00 on-event="/system script run day-report" policy=read,write,ftp comment="vendo income";
/system script add name=month-report policy=read,write,ftp source={
  :global tgBotToken;
  :global tgChatId;
  :local mon ([:tonum [/system script get monthlyincome source]]);
  :local siteId [/system identity get name];
  :local cfgPath "hotspot/assets/js/config.js";
  :if ([/file find name="flash/hotspot/assets/js/config.js"] != "") do={ :set cfgPath "flash/hotspot/assets/js/config.js"; }
  :do {
    :local cfg [/file get [find name=$cfgPath] contents];
    :local key "brandHeaderHtml = \"";
    :local p [:find $cfg $key];
    :if ([:typeof $p] != "nil") do={
      :local rest [:pick $cfg ($p + [:len $key]) [:len $cfg]];
      :local q [:find $rest "\""];
      :if ([:typeof $q] != "nil") do={
        :local brand [:pick $rest 0 $q];
        :local tagst 0;
        :local plain "";
        :for j from=0 to=([:len $brand]-1) do={
          :local bc [:pick $brand $j];
          :if ($bc = "<") do={ :set tagst 1 };
          :if ($tagst = 0) do={ :set plain ($plain . $bc) };
          :if ($bc = ">") do={ :set tagst 0 };
        }
        :if ($plain != "") do={ :set siteId $plain };
      }
    }
  } on-error={};
  :local siteTag "";
  :for i from=0 to=([:len $siteId]-1) do={
    :local ch [:pick $siteId $i];
    :if ($ch = " ") do={ :set ch "_" };
    :set siteTag ($siteTag . $ch);
  }
  :local msg ("month closed: P" . $mon . " | Site: " . $siteId . "%20%23monthly %23" . $siteTag);
  :local eMsg "";
  :for ei from=0 to=([:len $msg]-1) do={ :local ech [:pick $msg $ei]; :if ($ech = " ") do={ :set ech "%20" }; :if ($ech = "#") do={ :set ech "%23" }; :if ($ech = "&") do={ :set ech "%26" }; :set eMsg ($eMsg . $ech); };
  :do {/tool fetch url="https://api.telegram.org/bot$tgBotToken/sendmessage?chat_id=$tgChatId&text=$eMsg" keep-result=no} on-error={ :log warning "month-report: telegram send failed" };
  /system script set monthlyincome source="0";
};
/system scheduler add name="Reset Monthly Income" interval=30d start-time=00:00:00 on-event="/system script run month-report" policy=read,write,ftp comment="vendo income";
```

### D. On-Login

Hotspot → Server Profiles → your profile → Login tab → On Login.
`HSFilePath` auto-detects `flash/hotspot` vs `hotspot` (same probe as
F). Paste F first so `data/site-id.txt` already exists when logins run.

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
:local iSaleAmt [:tonum ($aUsrNote->1)];
:local iExtCode ($aUsrNote->2);
:local iVdoName ($aUsrNote->3);
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
# Sales accumulators (comment already read above; cleared at login so
# persist the pesos here — the day/month reports read these).
  :local iDayTot ([:tonum [/system script get todayincome source]] + $iSaleAmt);
  /system script set todayincome source="$iDayTot";
  :local iMonTot ([:tonum [/system script get monthlyincome source]] + $iSaleAmt);
  /system script set monthlyincome source="$iMonTot";
# Telegram per-sale ping (same layout, permanent history — 0 = off).
  :local isTelegram 0;
  :global tgBotToken;
  :global tgChatId;
  :if ($isTelegram=1) do={
    :local iUActive [/ip hotspot active print count-only];
    :local iHost $address;
    :do {
      :local leaseId [/ip dhcp-server lease find address=$address];
      :if ([:len $leaseId] > 0) do={
        :local hn [/ip dhcp-server lease get ($leaseId->0) host-name];
        :if ($hn != "") do={ :set iHost ($hn . " (" . $address . ")") };
      }
    } on-error={};
    :local siteId [/system identity get name];
    :do {
      :local cfg [/file get [find name=($HSFilePath . "/assets/js/config.js")] contents];
      :local key "brandHeaderHtml = \"";
      :local p [:find $cfg $key];
      :if ([:typeof $p] != "nil") do={
        :local rest [:pick $cfg ($p + [:len $key]) [:len $cfg]];
        :local q [:find $rest "\""];
        :if ([:typeof $q] != "nil") do={
          :local brand [:pick $rest 0 $q];
          :local tagst 0;
          :local plain "";
          :for j from=0 to=([:len $brand]-1) do={
            :local bc [:pick $brand $j];
            :if ($bc = "<") do={ :set tagst 1 };
            :if ($tagst = 0) do={ :set plain ($plain . $bc) };
            :if ($bc = ">") do={ :set tagst 0 };
          }
          :if ($plain != "") do={ :set siteId $plain };
        }
      }
    } on-error={};
    :local siteTag "";
    :for i from=0 to=([:len $siteId]-1) do={
      :local ch [:pick $siteId $i];
      :if ($ch = " ") do={ :set ch "_" };
      :set siteTag ($siteTag . $ch);
    }
    :local iTMsg ("New sale $user%0AExpiry: $iValidUntil | Active: $iHost%0ASite: $siteId%0A%0AAmount: P$iSaleAmt | Today: P$iDayTot | Month: P$iMonTot | Users: $iUActive%0A%0A%23sale %23$siteTag");
    :local eTMsg "";
    :for ei from=0 to=([:len $iTMsg]-1) do={ :local ech [:pick $iTMsg $ei]; :if ($ech = " ") do={ :set ech "%20" }; :if ($ech = "#") do={ :set ech "%23" }; :if ($ech = "&") do={ :set ech "%26" }; :set eTMsg ($eTMsg . $ech); };
    :do {/tool fetch url=("https://api.telegram.org/bot" . $tgBotToken . "/sendMessage?chat_id=" . $tgChatId . "&text=" . $eTMsg) keep-result=no} on-error={ :log warning "On-Login: telegram send failed" };
  }
};
}
```

Policy is the minimum that runs the cleanup (`ftp` for `/file`,
`read,write,test` for user/scheduler/file ops) — the old
`reboot,policy,password,sniff,sensitive,romon` set is overbroad for a
login-triggered context. The portal splits the session file on the last
`#`, so member names containing `#` still work. Waits trimmed 10s → 5s
so captive clients don't time out and double-submit.

### E. On-Logout (same profile)

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

### F. Site ID publisher

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

### G. Portal files

1. In `hotspot/assets/js/config.js` set `vendorIpAddress` to your vendo
   IP (`10.0.0.254` by default).
2. Upload the `hotspot/` folder contents to the router's `hotspot`
   directory (overwrite, don't delete — the scheduler keeps
   `data/site-id.txt` there).
3. Never remove the `IAMNOTLOGINSTRINGPLEASEDONTREMOVE` comment on
   `login.html` line 2 — the router needs that sentinel.

Bump the `?v=N` query on every first-party asset (`core.css`,
`JuanFiV2.css`, `config.js`, `boot.js`, `core.js` in `portal.html` +
router shells) on every portal change so phones don't serve stale JS.
Vendored libs stay pinned at `?v=26`. The footer `vN` tag should match.

## Optional

- Branding (per site, on the router copy only — never commit):

```js
var brandHeaderHtml = "BRO<em>BRO</em>";
var footerBrandText = "@NETBRO";
var footerSubText = "INTERNET SERVICES";
```

- Vendo picker (multi-vendo only): set `showVendoSelect = true` in
  `config.js` to reveal the dropdown (hidden by default). Manual mode
  (`multiVendoOption = 0`) needs it; auto modes resolve silently.
- Coin-insert pings: set `tgCoinAlerts = true` plus `tgBotToken` /
  `tgChatId` in `config.js`. The buying phone sends one telegram
  message per inserted coin (deduped by running total). Pre-login
  phones are offline, so pass telegram through the wall:

```bash
/ip hotspot walled-garden add dst-host=api.telegram.org action=allow disabled=no comment="telegram coin pings"
```

- ntfy per-sale ping (instead of telegram): paste at the end of the
  On-Login script, inside the main `if` (uses its vars). Use a
  hard-to-guess topic: anyone holding the topic URL can read it:

```bash
  :local isNtfy 0;
  :local iNtfyTopic "REPLACE-ME";
  :if ($isNtfy=1) do={
    :local iUActive [/ip hotspot active print count-only];
    :local iHost $address;
    :do {
      :local leaseId [/ip dhcp-server lease find address=$address];
      :if ([:len $leaseId] > 0) do={
        :local hn [/ip dhcp-server lease get ($leaseId->0) host-name];
        :if ($hn != "") do={ :set iHost ($hn . " (" . $address . ")") };
      }
    } on-error={};
    :local iMessage ("New sale $user%0AExpiry: $iValidUntil | Active: $iHost%0A%0AAmount: P$iSaleAmt | Today: P$iDayTot | Month: P$iMonTot | Users: $iUActive #sale");
    :do {/tool fetch url=("https://ntfy.sh/" . $iNtfyTopic . "?title=Vendo+sale") http-method=post http-data=$iMessage output=none} on-error={ :log warning "On-Login: ntfy send failed" };
  }
```

- Bot hardening (BotFather): `/setjoingroups` → Disable — send-only
  bot, nobody can add it to random groups. Leave `/setprivacy`
  default; the bot never reads messages. Tags (`#sale`, `#daily`,
  `#monthly`) are tappable filters in the DM. Secretary Mode is
  Business-account automation — irrelevant here, no updates are ever
  handled.

## License

[MIT](https://choosealicense.com/licenses/mit/)
