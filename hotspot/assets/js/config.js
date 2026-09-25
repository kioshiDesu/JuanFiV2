// Cache-busting lives in the ?v=N query strings on first-party assets
// (portal.html + router shells). Bump them on every portal change or
// customer phones keep running stale JS.
var isMultiVendo = false;
var multiVendoOption = 0;



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
var brandHeaderHtml = "BROBRO<em>PISOWIFI</em>";
var footerBrandText = "@NETBRO";

var footerSubText = "INTERNET SERVICES";
