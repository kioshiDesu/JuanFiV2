// Portal release version — single source of truth. Bump on every portal
// change and mirror it into every first-party ?v= URL (portal.html +
// router shells); customer phones then refetch exactly on release.
var PORTAL_VERSION = "1";

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
var brandHeaderHtml = "BRO<em>BRO</em>";
var footerBrandText = "@NETBRO";
var footerSubText = "INTERNET SERVICES";
