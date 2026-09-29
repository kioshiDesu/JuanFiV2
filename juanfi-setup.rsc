# JuanFiV2 - router setup (everything except the login/logout hooks)
#
# Copy to the router, then:
#   /import file=juanfi-setup.rsc
# or drag it into Winbox -> Files and double-click it.
#
# Idempotent: every step checks before it acts, so re-importing is safe.
# The script is removed before it is re-added, so a re-import replaces it
# instead of stacking a second script with the same name.
#
# Edit these before importing if your router differs:
#   PROF      hotspot server profile name   (line below)
#   NTP1/NTP2 NTP servers - raw IPs, so DNS is not needed to sync
#   time-zone-name further down
#
# Free trial is ON (trial-uptime=5m/1d). To turn it off, drop ",trial"
# from the login-by value.

:put "=== JuanFiV2 setup ==="

# Guarded: /system script remove errors with "no such item" on a router
# that has never run this, which would abort the whole import.
:do { /system script remove [find name="juanfi-setup"] } on-error={};

:do {
  /system script add name="juanfi-setup" policy=read,write,test,policy,ftp source={
    :local PROF "hsprof1";
    :local NTP1 "216.239.35.8";
    :local NTP2 "216.239.35.4";
    :local HSFilePath "hotspot";
    :if ([/file find name="flash/hotspot"] != "") do={ :set HSFilePath "flash/hotspot"; }
    :local dataDir ($HSFilePath . "/data");

    # Clock. A stale clock makes scheduler next-run garbage, which makes
    # voucher validity garbage. Raw IPs so DNS is not needed to sync.
    :do { /system ntp client set enabled=yes servers=($NTP1 . "," . $NTP2) } on-error={
      :do { /system ntp client set enabled=yes primary-ntp=$NTP1 secondary-ntp=$NTP2 } on-error={ :log warning "setup: NTP client not configurable" };
    };
    :do { /system clock set time-zone-name=Asia/Manila } on-error={};

    # Hotspot profile. CHAP + PAP only: never add HTTPS login, the portal
    # would load over TLS and browsers would block its plain-HTTP vendo
    # calls as mixed content, killing the coin flow. Cookies stay off.
    :do { /ip hotspot profile set [find name=$PROF] login-by=http-chap,http-pap,trial trial-uptime=5m/1d trial-user-profile=default } on-error={ :log warning ("setup: no hotspot profile named " . $PROF) };
    :do { /ip hotspot user profile set [find name="default"] idle-timeout=none keepalive-timeout=30s status-autorefresh=1m } on-error={};
    :do { /ip hotspot cookie remove [find] } on-error={};

    # FastTrack accounts for no idle traffic, so accept hotspot traffic
    # ahead of it or idle users never expire.
    :if ([:len [/ip firewall filter find comment="hotspot before fasttrack"]] = 0) do={
      :do { /ip firewall filter add chain=forward action=accept protocol=tcp \
        dst-port=80,443 src-address=10.0.0.0/16 place-before=0 \
        comment="hotspot before fasttrack" } on-error={ :log warning "setup: fasttrack rule not added" };
    };

    # Site ID. Publishes the board serial so saved vouchers scope per site.
    # Write-once: an existing value is never overwritten.
    :if ([/file find name=$dataDir] = "") do={
      :do { /tool fetch dst-path=($dataDir . "/.") url="https://127.0.0.1/" } on-error={};
    }
    :local siteFile ($dataDir . "/site-id.txt");
    :local siteOld "";
    :do { :set siteOld [/file get [find name=$siteFile] contents] } on-error={ :set siteOld "" };
    :if ($siteOld = "") do={
      :local sn "";
      :do { :set sn [/system routerboard get serial-number] } on-error={};
      :if ([:len $sn] < 4) do={ :set sn $PROF };
      /file print file=$siteFile where name="dummyfile";
      :local x 5; :while (($x>0) and ([/file find name=$siteFile]="")) do={ :set x ($x-1); :delay 1s };
      :do { /file set $siteFile contents=$sn } on-error={ :log warning "setup: site-id not written" };
    };

    # Internet status. The wait loop is mandatory: /file print creates the
    # file a moment after the script starts, so an immediate /file set
    # silently no-ops and you end up with a file full of print comments.
    :if ([:len [/tool netwatch find comment="vendo net status"]] = 0) do={
      /tool netwatch add host=8.8.8.8 interval=1m timeout=1000 comment="vendo net status" \
        up-script="/file print file=\"$dataDir/netstatus.txt\" where name=\"dummyfile\"; :local x 3; :while ((\$x>0) and ([/file find name=\"$dataDir/netstatus.txt\"]=\"\")) do={ :set x (\$x-1); :delay 1s }; /file set $dataDir/netstatus.txt contents=\"up\"" \
        down-script="/file print file=\"$dataDir/netstatus.txt\" where name=\"dummyfile\"; :local x 3; :while ((\$x>0) and ([/file find name=\"$dataDir/netstatus.txt\"]=\"\")) do={ :set x (\$x-1); :delay 1s }; /file set $dataDir/netstatus.txt contents=\"down\"";
    }
    :if ([/file find name=($dataDir . "/netstatus.txt")] = "") do={
      :do {
        /file print file=($dataDir . "/netstatus.txt") where name="dummyfile";
        :local x 3; :while (($x>0) and ([/file find name=($dataDir . "/netstatus.txt")]="")) do={ :set x ($x-1); :delay 1s };
        /file set ($dataDir . "/netstatus.txt") contents="up";
      } on-error={ :log warning "setup: netstatus.txt not created" };
    }
  };
  /system script run juanfi-setup;
  :put "=== done, verifying ===";
  :put [/system clock get date-time];
  :do { :put ("site-id  = " . [/file get [find name=($dataDir . "/site-id.txt")] contents]) } on-error={ :put "site-id  = MISSING" };
  :do { :put ("netstatus= " . [/file get [find name=($dataDir . "/netstatus.txt")] contents]) } on-error={ :put "netstatus= MISSING" };
} on-error={ :put "SETUP FAILED - check /log for the step" };

# Re-runs the script daily, which is what restores site-id.txt and
# netstatus.txt if anyone deletes them.
:if ([:len [/system scheduler find name="juanfi-setup-daily"]] = 0) do={
  /system scheduler add name="juanfi-setup-daily" start-time=startup interval=1d \
    policy=read,write,test,policy,ftp on-event="/system script run juanfi-setup";
}

:put "=== juanfi-setup done ==="
