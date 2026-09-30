:put "=== JuanFiV2 setup ==="

:do { /system script remove [find name="juanfi-setup"] } on-error={};
:do { /system script remove [find name="juanfi-netstatus"] } on-error={};
:do { /system script remove [find name="juanfi-sweep"] } on-error={};
:do { /system scheduler remove [find name="juanfi-setup-daily"] } on-error={};
:do { /system scheduler remove [find name="juanfi-sweep-daily"] } on-error={};
:do { /system scheduler remove [find name="juanfi-netstatus-1m"] } on-error={};

:do {
  /system script add name="juanfi-setup" policy=read,write,test,policy,ftp source={
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
  };
} on-error={ :log warning "setup: juanfi-setup not created" };

:do { /system script run juanfi-setup } on-error={ :log warning "setup: juanfi-setup run failed" };

:do {
  /system script add name="juanfi-netstatus" policy=read,write,test source={
    :local HSFilePath "";
    :foreach c in={"flash/hotspot"; "hotspot"} do={
      :if ($HSFilePath = "") do={
        :foreach f in={"portal.html"; "login.html"; "status.html"} do={
          :if (($HSFilePath = "") and ([/file find name=($c . "/" . $f)] != "")) do={ :set HSFilePath $c };
        };
      };
    };
    :if ($HSFilePath = "") do={
      :do {
        :local pf [:pick [/ip hotspot profile print as-value] 0];
        :if (($pf != "") and (($pf->"html-directory") != "")) do={ :set HSFilePath ($pf->"html-directory") };
      } on-error={};
    };
    :if ($HSFilePath = "") do={ :set HSFilePath "hotspot" };
    :local dataDir ($HSFilePath . "/data");
    :local f ($dataDir . "/netstatus.txt");
    :local state "down";
    :if ([/ping 8.8.8.8 count=1 interval=1s] > 0) do={ :set state "up" };
    :local old "";
    :do { :set old [/file get [find name=$f] contents] } on-error={ :set old "" };
    :if ($old != $state) do={
      :if ([/file find name=$f] = "") do={
        :do { /file print file=$f where name="dummyfile" } on-error={};
        :local x 3;
        :while (($x>0) and ([/file find name=$f] = "")) do={ :set x ($x-1); :delay 1s };
      };
      :do { /file set $f contents=$state } on-error={ :log warning ("netstatus: " . $f . " not written") };
    };
  };
} on-error={ :log warning "setup: juanfi-netstatus not created" };

:do { /system script run juanfi-netstatus } on-error={ :log warning "setup: netstatus.txt not written" };

:do {
  /system script add name="juanfi-sweep" policy=read,write,test source={
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
  };
} on-error={ :log warning "setup: juanfi-sweep not created" };

:do { /system script run juanfi-sweep } on-error={ :log warning "setup: juanfi-sweep run failed" };

:do { /system scheduler add name="juanfi-setup-daily" start-time=startup interval=1d policy=read,write,test,policy,ftp on-event="/system script run juanfi-setup" } on-error={ :log warning "setup: juanfi-setup-daily not added" };
:do { /system scheduler add name="juanfi-sweep-daily" start-time=04:20:00 interval=1d policy=read,write,test on-event="/system script run juanfi-sweep" } on-error={ :log warning "setup: juanfi-sweep-daily not added" };
:do { /system scheduler add name="juanfi-netstatus-1m" start-time=startup interval=1m policy=read,write,test on-event="/system script run juanfi-netstatus" } on-error={ :log warning "setup: juanfi-netstatus-1m not added" };

:put "=== done, verifying ===";
:put [/system clock get date-time];
:local PROF "hsprof1";
:local VPath "";
:do { :set VPath [/ip hotspot profile get [find name=$PROF] html-directory] } on-error={ :set VPath "" };
:if (($VPath = "") or ([/file find name=($VPath . "/portal.html")] = "")) do={
  :local cand "";
  :foreach c in={"flash/hotspot"; "hotspot"} do={
    :if ($cand = "") do={
      :foreach f in={"portal.html"; "login.html"; "status.html"} do={
        :if (($cand = "") and ([/file find name=($c . "/" . $f)] != "")) do={ :set cand $c };
      };
    };
  };
  :if ($cand != "") do={ :set VPath $cand };
};
:if ($VPath = "") do={ :set VPath "hotspot" };
:put ("portal files = " . $VPath);
:do { :put ("site-id  = " . [/file get [find name=($VPath . "/data/site-id.txt")] contents]) } on-error={ :put "site-id  = MISSING" };
:do { :put ("netstatus= " . [/file get [find name=($VPath . "/data/netstatus.txt")] contents]) } on-error={ :put "netstatus= MISSING" };
:put "=== juanfi-setup done ===";
