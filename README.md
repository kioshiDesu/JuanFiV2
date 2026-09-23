# JuanFiV2 Hotspot Portal

> Maintained by [kioshiDesu](https://github.com/kioshiDesu/JuanFiV2).

MikroTik hotspot portal + RouterOS setup scripts for a coinslot
vendo system. Portal files only — no firmware in this repo.

## 1. Router clock

Fixes 1970-time voucher issues. Uses raw IPs (Google Public NTP) so the
clock syncs even before DNS is up:

```bash
# RouterOS v6
/system ntp client set enabled=yes primary-ntp=216.239.35.8 secondary-ntp=216.239.35.4
# RouterOS v7
/system ntp client set enabled=yes servers=216.239.35.8,216.239.35.4
```

## 2. Hotspot profile tuning

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
firewall rule first (fasttracked traffic skips idle accounting).

## 3. Hotspot login script (On Login)

Hotspot → Server Profiles → your profile → Login tab → On Login.
Set `HSFilePath` to `flash/hotspot` on hEX/hAP ax, `hotspot` on hAP lite.

```bash
:local HSFilePath "hotspot";
:local aUsrNote [/ip hotspot user get $user comment];
:local aUsrNote [:toarray $aUsrNote];
:local iUsrTime [:totime ($aUsrNote->0)];
:local iExtCode ($aUsrNote->2);
:local iVdoName ($aUsrNote->3);
:local iTimeMin [/ip hotspot user get $user limit-uptime];
:local iUserReg [/system scheduler find name=$user];

:if (($iTimeMin>0) and ($iUsrTime>=0) and (($iUserReg="") or ($iExtCode=1))) do={
  /ip hotspot user set $user comment="";
  :local iFileMac;
  :local mac $"mac-address";
  :for i from=0 to=([:len $mac] - 1) do={
    :local chr [:pick $mac $i]
    :if ($chr = ":") do={ :set $chr "" }
    :set iFileMac ($iFileMac . $chr)
  }
  :if (($iUserReg!="") and ($iExtCode=1)) do={
    :local iTimeInt [/system scheduler get $user interval];
    :set iTimeInt ($iTimeInt+$iUsrTime);
    :if ($iTimeMin>$iTimeInt) do={ :set iTimeInt ($iTimeMin+$iUsrTime) };
    /system scheduler set $user interval=$iTimeInt;
  }
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
                "/system scheduler remove [find name=$user];\r\n".\
                ":do {/file remove \"$HSFilePath/data/$iFileMac.txt\"} on-error={};\r\n")
    } on-error={ log error "( $user ) /system scheduler add => ERROR ADD!" };
    :local x 10;:while (($x>0) and ([/system scheduler find name="$user"]="")) do={:set x ($x-1);:delay 1s};
  };
  :if ([/file find name="$HSFilePath/data"]="") do={
    :do {/tool fetch dst-path=("$HSFilePath/data/.") url="https://127.0.0.1/"} on-error={ };
  }
  :local iValidUntil [/system scheduler get $user next-run];
  :if ([/system scheduler find name=$user]!="") do={
    /file print file="$HSFilePath/data/$iFileMac.txt" where name="dummyfile";
    :local x 10;:while (($x>0) and ([/file find name="$HSFilePath/data/$iFileMac.txt"]="")) do={:set x ($x-1);:delay 1s};
    /file set "$HSFilePath/data/$iFileMac" contents="$user#$iValidUntil";
  }
};
```

On Logout (same profile):

```bash
:if ($cause="session timeout") do={
  /system scheduler set [find name=$user] interval=5s;
}
```

## 4. Site ID publisher

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
      :local x 10;:while (($x>0) and ([/file find name=$siteFile]="")) do={:set x ($x-1);:delay 1s};
      /file set "$siteFile" contents="$sn";
    }
  }
};
/system scheduler add name="publish-site-id" start-time=startup interval=1d policy=read,write,ftp,test on-event="/system script run publish-site-id";
```

Run `/system script run publish-site-id` once after pasting. Verify:
`/file print where name="hotspot/data/site-id.txt"` must show your board
serial. Boards without a serial (CHR/x86) fall back to vendorIp scoping.

## 5. Portal files

1. In `hotspot/assets/js/config.js` set `vendorIpAddress` to your vendo
   IP (`10.0.0.254` by default).
2. Upload the `hotspot/` folder contents to the router's `hotspot`
   directory (overwrite, don't delete — the scheduler keeps
   `data/site-id.txt` there).
3. Optional branding in `config.js`:

```js
var brandHeaderHtml = "BRO<em>BRO</em>";
var footerBrandText = "@NETBRO";
var footerSubText = "INTERNET SERVICES";
```

Bump `PORTAL_VERSION` in `config.js` and matching `?v=N` asset query
strings on every portal change so phones don't serve stale JS. Vendored
libs stay pinned at `?v=26`.

## License

[MIT](https://choosealicense.com/licenses/mit/)
