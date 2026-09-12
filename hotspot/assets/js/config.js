//this is to enable multi vendo setup, set to true when multi vendo is supported
var isMultiVendo = false;
// 0 = traditional (client choose a vendo) , 1 = auto select vendo base on hotspot address, 2 = interface name ( this will preserve one hotspot server ip only)
var multiVendoOption = 0;

//list here all node mcu address for multi vendo setup
var multiVendoAddresses = [
	{
		vendoName: "Vendo 1 - ESP32 Wireless", //change accordingly to your vendo name
		vendoIp: "10.0.0.254", //change accordingly to your vendo ip
		hotspotAddress: "10.0.0.1", // use for multi vendo option = 1, means your vendo map to this hotspot and autoselect it when client connected to this
		interfaceName: "vlan11-hotspot1" // hotspot interface name preser
	}
];


//put here the default selected address
var vendorIpAddress = "10.0.0.254";