var isMultiVendo = false;
var multiVendoOption = 0;

//list here all nodemcu address for multi vendo setup, add coma for adding more
var multiVendoAddresses = [
	{
		vendoName: "Vendo 1",
		vendoIp: "10.0.0.254", //ESP Address
		hotspotAddress: "10.0.0.1",
		interfaceName: "vlan10"
	}
];

var venueId = "NETBRO-001"; // CHANGE per site: isolates saved vouchers between neighbouring vendos with same IP
var vendorIpAddress = "10.0.0.254"; //ESP Address