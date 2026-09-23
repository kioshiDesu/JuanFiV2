// Cache-busting lives in the ?v=N query strings on first-party assets
// (portal.html + router shells). Bump them on every portal change or
// customer phones keep running stale JS.
var isMultiVendo = false;
var multiVendoOption = 0;

// Vendo picker visibility — false (default) hides the dropdown entirely
// (auto modes still resolve silently). Set true to let customers pick.
var showVendoSelect = false;

//list here all nodemcu address for multi vendo setup, add coma for adding more
var multiVendoAddresses = [
	{
		vendoName: "Vendo 1",
		vendoIp: "10.0.0.254", //ESP Address
		hotspotAddress: "10.0.0.1",
		interfaceName: "vlan1"
	}
];

var vendorIpAddress = "10.0.0.254"; //ESP Address

// Support switch: true = verbose console log for every portal flow
// (boot, session, coin, login, pause). Buffer always fills regardless,
// so copyDebugLog() in devtools works even when this is false.
var portalDebug = false;

// Branding — header + footer (change per site without touching portal.html)
var brandHeaderHtml = "BRO<em>BRO</em>";
var footerBrandText = "@NETBRO";

// ntfy push alerts (sales + inserted coins + ESP errors) — off by default.
// Needs a walled-garden pass for the ntfy host or pre-login phones can't
// reach it (see README §5). Use a hard-to-guess topic: anyone holding the
// topic URL can read it.
var ntfyEnabled = false;
var ntfyServer = "https://ntfy.sh";
var ntfyTopic = "";
var ntfyToken = "";
var footerSubText = "INTERNET SERVICES";
