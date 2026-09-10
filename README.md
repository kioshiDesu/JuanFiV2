# JuanFiV2

> Maintained by [kioshiDesu](https://github.com/kioshiDesu/JuanFiV2).
> Fork of the original **JuanFi** by Ivan Julius Alayan —
> full [original README here](https://github.com/ivanalayan15/JuanFi#readme).

Coinslot vendo system for MikroTik Hotspot (ESP8266 wireless / ESP32 wireless+LAN).
Vouchers look like `1FI` + 5 chars, work from any AP on the same router.

## Requirements

- NodeMCU ESP8266 (wireless) or ESP32 (wireless/LAN) + baseboard
- Coinslot, MikroTik router, access point
- 12V supply for NodeMCU and MikroTik, W5500 module for LAN builds

## 1. Flash the firmware

Get the bins from `/release` (WirelessBase or LanBased, ESP8266 or ESP32).

ESP8266 with NodeMCU-PyFlasher, flash in this order:

```text
File 1: JuanFi-FlashFile1.bin at offset 0x000000
File 2: JuanFi-FlashFile2.bin at offset 0x200000
```

ESP32: copy the whole ESP32 release folder to Windows, plug in USB, run:

```text
start_flash.bat  -> pick the COM port -> hold FLASH 3-5s until it starts
```

Wiring diagrams are in `/docs` (esp32/esp8266, wireless/LAN, power-cut variants).

## 2. First-time vendo setup

1. Power on, connect to WiFi SSID `JuanFiV2 Setup` (no password).
2. Open `http://172.217.28.1/login` (LAN builds: plug into PC NIC with static `172.217.28.10` first).
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

Daily/monthly income reset:

```bash
/system scheduler add interval=1d name="Reset Daily Income" on-event="/system script set source=\"0\" todayincome " policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-date=Sep/28/2021 start-time=00:00:00;
/system scheduler add interval=30d name="Reset Monthly Income" on-event="/system script set source=\"0\" monthlyincome " policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-date=Sep/28/2021 start-time=00:00:00;
```

Income tracker scripts:

```bash
/system script add dont-require-permissions=no name=todayincome owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source="0";
/system script add dont-require-permissions=no name=monthlyincome owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source="0";
```

Let the vendo talk to the router (replace `JuanfiVendo` list usage as-is):

```bash
/ip hotspot walled-garden ip add action=accept disabled=no dst-address-list=JuanfiVendo
/ip firewall filter add action=accept chain=input place-before=0 comment=JuanfiVendo src-address-list=JuanfiVendo
```

Give the vendo a static lease: IP -> DHCP Server -> Leases, find `10.0.0.254`,
Make Static, set Address-List to `JuanfiVendo`. Then Hotspot -> IP Bindings:
add the vendo MAC/IP as Bypassed (Server: all).

Create the API user the vendo logs in with (must match step 2):

```bash
/user add name=pisonet password=abc123 group=full disabled=no
```

### Router clock (fixes 1970-time voucher issues)

```bash
/system ntp client set enabled=yes servers=time.google.com,time.cloudflare.com
```

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
:local iSaleAmt [:tonum ($aUsrNote->1)];
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
# Update Today Income
  :local iSaveAmt [:tonum [/system script get todayincome source]];
  :local iDailySales ($iSaleAmt + $iSaveAmt);
  /system script set todayincome source="$iDailySales";
# Update Monthly Income
  :local iSaveAmt [:tonum [/system script get monthlyincome source]];
  :local iMonthSales ( $iSaleAmt + $iSaveAmt );
  /system script set monthlyincome source="$iMonthSales";
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

1. In `mikrotik-template/4.3/assets/js/config.js` set `vendoIpAddress` to your
   vendo IP (`10.0.0.254` by default).
2. Upload the `mikrotik-template/4.3` folder contents to the router's
   `hotspot` directory (Files window, drag and drop).

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
