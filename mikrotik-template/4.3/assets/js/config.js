//this is to enable multi vendo setup, set to true when multi vendo is supported
var isMultiVendo = false;
// 0 = traditional (client choose a vendo) , 1 = auto select vendo base on hotspot address, 2 = interface name ( this will preserve one hotspot server ip only)
var multiVendoOption = 0;

//list here all node mcu address for multi vendo setup
var multiVendoAddresses = [
	{
		vendoName: "Vendo 1 - ESP32 Wireless", //change accordingly to your vendo name
		vendoIp: "10.1.0.41", //change accordingly to your vendo ip
		hotspotAddress: "10.1.0.1", // use for multi vendo option = 1, means your vendo map to this hotspot and autoselect it when client connected to this
		interfaceName: "vlan11-hotspot1" // hotspot interface name preser
	},
	{
		vendoName: "Vendo 2", //change accordingly to your vendo name
		vendoIp: "10.10.10.251" //change accordingly to your vendo ip
	},
	{
		vendoName: "Vendo 3", //change accordingly to your vendo name
		vendoIp: "10.10.10.253" //change accordingly to your vendo ip
	},
	{
		vendoName: "Vendo 4", //change accordingly to your vendo name
		vendoIp: "10.10.10.254" //change accordingly to your vendo ip
	}
];


//0 means its login by username only, 1 = means if login by username + password
var loginOption = 0; //replace 1 if you want login voucher by username + password

var dataRateOption = false; //replace true if you enable data rates
//put here the default selected address
var vendorIpAddress = "10.1.0.41";

//hide pause time / logout true = you want to show pause / logout button
var showPauseTime = true;

//enable member login, true = if you want to enable member login
var showMemberLogin = true;

//enable extend time button for customers
var showExtendTimeButton = true;

//disable voucher input
var disableVoucherInput = false;

//enable mac address as voucher code
var macAsVoucherCode = false;

var qrCodeVoucherPurchase = false;