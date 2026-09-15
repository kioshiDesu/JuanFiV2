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

var venueId = "JUANFIV2"; // CHANGE per site: isolates saved vouchers between neighbouring vendos with same IP
var vendorIpAddress = "10.0.0.254"; //ESP Address

// Branding — header + footer (change per site without touching portal.html)
var brandHeaderHtml = "JuanFi<em>V2</em>";
var footerBrandText = "@JUANFIV2";
var footerSubText = "INTERNET SERVICES";
