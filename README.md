# JuanFiV2 Hotspot Portal

> Maintained by [kioshiDesu](https://github.com/kioshiDesu/JuanFiV2).

MikroTik hotspot portal + router setup for a coinslot vendo system
(ESP8266 wireless). Portal files only — no firmware in this repo.
Tested against original JuanFi ESP firmware
([original README](https://github.com/ivanalayan15/JuanFi#readme)).

Coinslot vendo system for MikroTik Hotspot (ESP8266 wireless).
Vouchers are issued by the vendo firmware and work from any AP on the
same router.

## Requirements

- ESP8266 vendo running JuanFi firmware + baseboard
- Coinslot, MikroTik router, access point
- 12V supply for NodeMCU and MikroTik

## 1. Vendo firmware

Flash the ESP8266 with original JuanFi firmware following its own docs,
then continue below. This repo only ships the hotspot portal and the
RouterOS setup that goes with it.

## 2. First-time vendo setup

1. Power on, connect to WiFi SSID `JuanFiV2 Setup` (no password).
2. Open `http://172.217.28.1/login`.
3. Log in with the defaults, then fill in your system config + promo rates:

```text
Admin user : admin
Admin pass : admin
MikroTik API: pisonet / abc123  (create the same user on the router, step 4)
Vendo IP   : 10.0.0.254   Mask: 255.255.0.0   Gateway/DNS: 10.0.0.1
```

Save and let it restart. Change the admin password after first login.

## 3. MikroTik setup

Set up a hotspot server first, then paste each block into the MikroTik terminal
(New Terminal). Order matters.

Let the vendo talk to the router (vendo at `10.0.0.254`):

```bash
/ip hotspot walled-garden ip add action=accept disabled=no dst-address=10.0.0.254 comment="JuanFi vendo"
/ip firewall filter add action=accept chain=input place-before=0 src-address=10.0.0.254 comment="JuanFi vendo"
```

Give the vendo a static lease: IP -> DHCP Server -> Leases, find `10.0.0.254`,
Make Static. Then Hotspot -> IP Bindings:
add the vendo MAC/IP as Bypassed (Server: all).

Create the API user the vendo logs in with (must match step 2):

```bash
/user add name=pisonet password=abc123 group=full disabled=no
```

### Router clock (fixes 1970-time voucher issues)

RouterOS v6:

```bash
/system ntp client set enabled=yes primary-ntp=216.239.35.8 secondary-ntp=216.239.35.4
```

RouterOS v7 equivalent:

```bash
/system ntp client set enabled=yes servers=216.239.35.8,216.239.35.4
```

Raw IPs on purpose (Google Public NTP): no DNS lookup needed, so the
clock syncs even when DNS isn't up yet at boot.

### Hotspot server + user profile tuning

Winbox: Hotspot -> Server Profiles -> your profile -> **Login** tab:
HTTP Cookie Lifetime `7d`, tick **Login by MAC Cookie**, MAC Cookie
Timeout `30d`. Hotspot -> **User Profiles** -> `default` (the profile
vendo users land on unless `VOUCHER_PROFILE` says otherwise):
Idle Timeout `none` (leave blank), Keepalive Timeout `30s`,
Status Autorefresh `1m`.

Same via terminal (replace `hsprof1` if your server profile is named
differently; check your current login methods first with
`/ip hotspot profile print` and keep them, just adding `mac-cookie`):

```bash
/ip hotspot profile set [find name="hsprof1"] http-cookie-lifetime=7d mac-cookie-timeout=30d login-by=cookie,http-chap,http-pap,mac-cookie
/ip hotspot user profile set [find name="default"] idle-timeout=none keepalive-timeout=30s status-autorefresh=1m
```

Note: the status page's own autorefresh counts as traffic, so while the
page is open the session looks active — with autorefresh (`1m`) longer
than keepalive (`30s`), idle expiry still works once the page is closed.
If idle users never expire at all, check the defconf FastTrack rule first
(fasttracked traffic skips idle accounting).

## 4. Hotspot login script (On Login)

Hotspot -> Server Profiles -> your profile -> Login tab -> On Login.
Paste this whole block (set `HSFilePath` to `flash/hotspot` on hEX/hAP ax,
`hotspot` on hAP lite). No cloud tracking, no random-MAC sync in this version.

```bash
### hotspot folder for HEX put flash/hotspot for haplite put hotspot only
:local HSFilePath "hotspot";

# Get User Data
:local aUsrNote [/ip hotspot user get $user comment];
:local aUsrNote [:toarray $aUsrNote];
:local iUsrTime [:totime ($aUsrNote->0)];
:local iExtCode ($aUsrNote->2);
:local iVdoName ($aUsrNote->3);
:local iTimeMin [/ip hotspot user get $user limit-uptime];
:local iUserReg [/system scheduler find name=$user];

# Check User Data
:if (($iTimeMin>0) and ($iUsrTime>=0) and (($iUserReg="") or ($iExtCode=1))) do={
  /ip hotspot user set $user comment="";
  :local iFileMac;
  :local mac $"mac-address";
  :for i from=0 to=([:len $mac] - 1) do={
    :local chr [:pick $mac $i]
    :if ($chr = ":") do={ :set $chr "" }
    :set iFileMac ($iFileMac . $chr)
  }
# Extend User
  :if (($iUserReg!="") and ($iExtCode=1)) do={
    :local iTimeInt [/system scheduler get $user interval];
    :set iTimeInt ($iTimeInt+$iUsrTime);
    :if ($iTimeMin>$iTimeInt) do={ :set iTimeInt ($iTimeMin+$iUsrTime) };
    /system scheduler set $user interval=$iTimeInt;
  }
# ADD User
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
# Save Data File
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

On Logout script (same profile):

```bash
:if ($cause="session timeout") do={
  /system scheduler set [find name=$user] interval=5s;
}
```

## 4b. Site ID publisher (scheduler, one paste per router)

Identical portal files on every router still need one per-site value so saved
vouchers don't leak across neighbouring sites sharing the `10.0.0.x` origin.
This publishes the board serial to `data/site-id.txt`, which the portal scopes
its storage to. Write-once (never rotates, so saved vouchers survive), exists
from first boot, needs no reachable vendo and nothing typed per box:

```bash
/system script add name="publish-site-id" policy=read,write,ftp,test source={
  :local HSFilePath "hotspot";
  :if ([/file find name="flash/hotspot"] != "") do={ :set HSFilePath "flash/hotspot"; }
  :local siteFile ($HSFilePath . "/data/site-id.txt");
  # Ensure the data directory exists first: virgin boxes (fresh portal upload,
  # no logins yet) have no hotspot/data/, and file creation fails without it.
  :if ([/file find name=($HSFilePath . "/data")] = "") do={
    :do { /tool fetch dst-path=($HSFilePath . "/data/.") url="https://127.0.0.1/" } on-error={};
  }
  # Treat a missing file AND an empty one as unwritten: an interrupted first
  # run can leave a 0-byte file behind that later runs would otherwise skip.
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

Run `/system script run publish-site-id` once after pasting (or reboot and let
startup do it). Boards without a serial (CHR/x86) get no file — the portal
then falls back to vendorIp scoping, which is fine for single sites.

Optional telegram sales alerts: set `isTelegram` to 1 and fill `iTBotToken` /
`iTGrChatID` at the top of the login script. (Token block omitted here to keep
the paste clean; see the original README for the telegram snippet.)

## 5. Portal files

1. In `hotspot/assets/js/config.js` set `vendorIpAddress` to your
   vendo IP (`10.0.0.254` by default).
2. Upload the `hotspot/` folder contents to the router's
   `hotspot` directory (Files window, drag and drop). Overwrite, don't
   delete the directory first — the scheduler keeps a published
   `data/site-id.txt` (board serial) there that auto-isolates saved vouchers per site.
3. Site isolation is automatic via that site ID file (board serial):
   identical portal files on every router, no per-site `config.js` needed.
   There is no manual ID to forget on returns or redeploys.
4. Optional branding: same `config.js` — header/footer only:

```js
var brandHeaderHtml = "BRO<em>BRO</em>";
var footerBrandText = "@NETBRO";
var footerSubText = "INTERNET SERVICES";
```

## 6. Nightly reboot (optional)

Reboots the vendo at 3am. It answers `{"status":"busy"}` and skips the reboot
while a customer session or coin wait is active. Put your admin password in.

```bash
/system scheduler add interval=1d name="Restart Vendo" on-event="/tool fetch http-method=post url=\"http://10.0.0.254/admin/api/restartSystem\" user=\"admin\" password=\"YOUR_ADMIN_PASSWORD\"" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-date=Sep/28/2021 start-time=03:00:00;
```

## License

[MIT](https://choosealicense.com/licenses/mit/)
