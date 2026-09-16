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

// Branding — header + footer (change per site without touching portal.html)
var brandHeaderHtml = "TINDAHAN<em>LALA</em>";
var footerBrandText = "@NETBRO";
var footerSubText = "INTERNET SERVICES";
