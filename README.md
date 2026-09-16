# JuanFiV2

> Maintained by [kioshiDesu](https://github.com/kioshiDesu/JuanFiV2).
> Fork of the original **JuanFi** by Ivan Julius Alayan —
> full [original README here](https://github.com/ivanalayan15/JuanFi#readme).

Coinslot vendo system for MikroTik Hotspot (ESP8266 wireless).
Vouchers look like `1FI` + 5 chars, work from any AP on the same router.

## Requirements

- NodeMCU ESP8266 (wireless) + baseboard
- Coinslot, MikroTik router, access point
- 12V supply for NodeMCU and MikroTik

## 1. Flash the firmware

Get the ESP8266 bin from the [Releases page](https://github.com/kioshiDesu/JuanFiV2/releases)
(`JuanFiV2-ESP8266-Wireless-*.zip`; new bins build automatically when a `v*`
tag is pushed), or compile `JuanFi-nodemcu/` yourself
with the Arduino IDE (NodeMCU 1.0, ESP8266 core) — only the
`ESP8266-Telnet-Client` library is needed on top of the core.

ESP8266 with NodeMCU-PyFlasher, flash in this order:

```text
File 1: JuanFi-FlashFile1.bin at offset 0x000000
File 2: JuanFi-FlashFile2.bin at offset 0x200000
```

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
# Publish ESP MAC so identical portal copies auto-isolate saved vouchers
# per site (no per-site config.js). Refreshes itself if the ESP is swapped;
# writes the file only when the hardware changes (flash wear).
  :local espIp "10.0.0.254";
  :do { /ping $espIp count=1 } on-error={};
  :local espArp [/ip arp find address=$espIp];
  :if ([:len $espArp] > 0) do={
    :local espMac [/ip arp get ($espArp->0) mac-address];
    :if ($espMac != "") do={
      :local espId "";
      :for i from=0 to=([:len $espMac] - 1) do={
        :local chr [:pick $espMac $i];
        :if ($chr = ":") do={ :set $chr "" };
        :set espId ($espId . $chr);
      }
      :local espFile ($HSFilePath . "/data/esp.txt");
      :local espOld "";
      :do { :set espOld [/file get [find name=$espFile] contents] } on-error={};
      :if ($espOld != $espId) do={
        :if ([/file find name=$espFile] = "") do={
          /file print file=$espFile where name="dummyfile";
          :local x 10;:while (($x>0) and ([/file find name=$espFile]="")) do={:set x ($x-1);:delay 1s};
        }
        /file set "$espFile" contents="$espId";
      }
    }
  }
};
```

On Logout script (same profile):

```bash
:if ($cause="session timeout") do={
  /system scheduler set [find name=$user] interval=5s;
}
```

Optional telegram sales alerts: set `isTelegram` to 1 and fill `iTBotToken` /
`iTGrChatID` at the top of the login script. (Token block omitted here to keep
the paste clean; see the original README for the telegram snippet.)

## 5. Portal files

1. In `hotspot/assets/js/config.js` set `vendorIpAddress` to your
   vendo IP (`10.0.0.254` by default).
2. Upload the `hotspot/` folder contents to the router's
   `hotspot` directory (Files window, drag and drop). Overwrite, don't
   delete the directory first — the On-Login script keeps a published
   `data/esp.txt` (ESP MAC) there that auto-isolates saved vouchers per site.
3. Site isolation is automatic via that ESP MAC file: identical portal
   files on every router, no per-site `config.js` needed. `venueId` is now
   an optional override — it wins only when changed from the default.
3. Optional branding: same `config.js` — site ID plus header/footer
   (ships as JuanFiV2, change per site):

```js
var venueId = "JUANFIV2";
var brandHeaderHtml = "JuanFi<em>V2</em>";
var footerBrandText = "@JUANFIV2";
var footerSubText = "INTERNET SERVICES";
```

## 6. Nightly reboot (optional)

Reboots the vendo at 3am. It answers `{"status":"busy"}` and skips the reboot
while a customer session or coin wait is active. Put your admin password in.

```bash
/system scheduler add interval=1d name="Restart Vendo" on-event="/tool fetch http-method=post url=\"http://10.0.0.254/admin/api/restartSystem\" user=\"admin\" password=\"YOUR_ADMIN_PASSWORD\"" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-date=Sep/28/2021 start-time=03:00:00;
```

## Acknowledgments

Fork of **JuanFi** by **Ivan Julius Alayan** — original repo, website, app,
diagrams and scripts remain his work:
[original README](https://github.com/ivanalayan15/JuanFi#readme) ·
[juanfi.juansystems.com](https://juanfi.juansystems.com/) ·
[JuanFi Manager app](https://play.google.com/store/apps/details?id=com.juanfi.mobile.admin).
Diagram updates by Tee Ay, sales script contributions by kristoff.

## License

[MIT](https://choosealicense.com/licenses/mit/)
