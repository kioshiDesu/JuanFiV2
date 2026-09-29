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
# Installs two scripts:
#   juanfi-setup   clock, hotspot profile, trial, FastTrack, site id,
#                  net status file
#   juanfi-sweep   deletes voucher codes that were minted but never
#                  claimed, so the coin box's random codes stop
#                  colliding with dead accounts
#
# Edit these before importing if your router differs:
#   PROF      hotspot server profile name   (line below)
#   NTP1/NTP2 NTP servers - raw IPs, so DNS is not needed to sync
#   time-zone-name further down
#   GRACE     days a never-claimed code survives inside juanfi-sweep.
#             Raise it if buyers pay and log in late, lower it to shrink
#             the collision window. 3 is a sane default.
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

  # Orphan sweep. The coin box mints random codes with no duplicate
  # check and never tells the router the code already existed, so a
  # minted-then-never-claimed code would sit in /ip hotspot user
  # forever. Only On-Login creates the expiry scheduler, so nothing
  # ever removed them. They pile up until they occupy so much of the
  # code space that new coins keep landing on a live account and top
  # up the wrong customer.
  #
  # The box only ever WRITES the user comment (never reads it back),
  # so this script owns that field. It appends today's date as a 5th
  # field, then deletes anything it saw more than GRACE days ago.
  # Fields 1-4 stay where the box put them, so On-Login still reads
  # the validity and extend flag correctly.
  :do { /system script remove [find name="juanfi-sweep"] } on-error={};
  :do {
    /system script add name="juanfi-sweep" policy=read,write,test source={
      :local GRACE 3;
      :local MD {31;28;31;30;31;30;31;31;30;31;30;31};
      :local today [:pick [/system clock get date-time] 0 10];

      # Day number for a YYYY/MM/DD string. Exact across month, leap and
      # century boundaries, so "3 days ago" never means 2 or 9.
      :local Y [:tonum [:pick $today 0 4]];
      :local M [:tonum [:pick $today 5 2]];
      :local leap 0;
      :if ((($Y % 4) = 0) and ((($Y % 100) != 0) or (($Y % 400) = 0))) do={ :set leap 1 };
      :local doy [:tonum [:pick $today 8 2]];
      :local k 1;
      :while ($k < $M) do={
        :set doy ($doy + ($MD->($k - 1)));
        :if (($leap = 1) and ($k = 2)) do={ :set doy ($doy + 1) };
        :set k ($k + 1);
      };
      :local todayNo ((($Y - 1970) * 365) + (($Y - 1) / 4 - ($Y - 1) / 100 + ($Y - 1) / 400) - 479 + $doy);
      :local stamped 0;
      :local removed 0;

      # "minted, never claimed" = has a comment, has no expiry
      # scheduler, has no live session. Members and trials carry an
      # empty comment and are never matched.
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
                # First sighting: stamp only, never delete on the same
                # run that discovers a code.
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
                  :set sDoy ($sDoy + ($MD->($j - 1)));
                  :if (($sLeap = 1) and ($j = 2)) do={ :set sDoy ($sDoy + 1) };
                  :set j ($j + 1);
                };
                :local seenNo ((($sY - 1970) * 365) + (($sY - 1) / 4 - ($sY - 1) / 100 + ($sY - 1) / 400) - 479 + $sDoy);
                :if (($todayNo - $seenNo) > $GRACE) do={
                  :do { /ip hotspot active remove [find user=$name] } on-error={};
                  :do { /ip hotspot user remove $u } on-error={};
                  :set removed ($removed + 1);
                }
              }
            }
          }
        }
      }
      :log info ("juanfi-sweep: grace=" . $GRACE . "d stamped=" . $stamped . " removed=" . $removed);
      :put ("juanfi-sweep: grace=" . $GRACE . "d stamped=" . $stamped . " removed=" . $removed);
    }
  } on-error={ :log warning "setup: juanfi-sweep not created" };
  /system script run juanfi-setup;
  :do { /system script run juanfi-sweep } on-error={};
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

# Daily orphan sweep. See the juanfi-sweep script above for why this
# has to exist. Run at a quiet hour so it never competes with a sale.
:if ([:len [/system scheduler find name="juanfi-sweep-daily"]] = 0) do={
  /system scheduler add name="juanfi-sweep-daily" start-time=04:20:00 interval=1d \
    policy=read,write,test on-event="/system script run juanfi-sweep";
}

:put "=== juanfi-setup done ==="
