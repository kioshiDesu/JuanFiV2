// JuanFiV2 portal config — FALLBACKS ONLY.
// hotspot/settings.json is the real config; values below apply only
// when the JSON is missing/unreachable. Same key names (currency key
// maps to currencySym here).
var isMultiVendo = false;
var multiVendoOption = 0;

//list here all nodemcu address for multi vendo setup, add coma for adding more
var multiVendoAddresses = [
	{ vendoName: "Vendo 1", vendoIp: "10.0.0.254", hotspotAddress: "10.0.0.1", interfaceName: "vlan1" }
];
var vendorIpAddress = "10.0.0.254";
var portalDebug = false;
var brandHeaderHtml = "BROBRO <em>PISOWIFI</em>";
var footerBrandText = "@NETBRO";
var footerSubText = "INTERNET SERVICES";
var currencySym = "₱";
var showMemberSection = true;

// settings.json override (sync fetch, runs before core.js).
try {
	var __setXhr = new XMLHttpRequest();
	__setXhr.open("GET", "settings.json?t=" + new Date().getTime(), false);
	__setXhr.timeout = 3000;
	__setXhr.send(null);
	if (__setXhr.status === 200) {
		var __set = JSON.parse(__setXhr.responseText);
		if (__set) {
			if (typeof __set.isMultiVendo === "boolean") { isMultiVendo = __set.isMultiVendo; }
			if (typeof __set.multiVendoOption === "number") { multiVendoOption = __set.multiVendoOption; }
			if (__set.multiVendoAddresses instanceof Array && __set.multiVendoAddresses.length) { multiVendoAddresses = __set.multiVendoAddresses; }
			if (typeof __set.vendorIpAddress === "string" && __set.vendorIpAddress) { vendorIpAddress = __set.vendorIpAddress; }
			if (typeof __set.portalDebug === "boolean") { portalDebug = __set.portalDebug; }
			if (typeof __set.brandHeaderHtml === "string" && __set.brandHeaderHtml) { brandHeaderHtml = __set.brandHeaderHtml; }
			if (typeof __set.footerBrandText === "string") { footerBrandText = __set.footerBrandText; }
			if (typeof __set.footerSubText === "string") { footerSubText = __set.footerSubText; }
			if (typeof __set.currency === "string" && __set.currency) { currencySym = __set.currency; }
			if (typeof __set.showMemberSection === "boolean") { showMemberSection = __set.showMemberSection; }
		}
	}
} catch (e) {}
