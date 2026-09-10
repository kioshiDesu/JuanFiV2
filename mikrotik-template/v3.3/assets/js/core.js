var errorCodeMap = [];
errorCodeMap['coins.wait.expired'] = 'Coin slot expired';
errorCodeMap['coin.not.inserted'] = 'Coin not inserted';
errorCodeMap['coinslot.cancelled'] = 'Coinslot was cancelled';
errorCodeMap['coinslot.busy'] = 'Coin slot is busy';
errorCodeMap['coin.slot.banned'] = 'You have been banned from using coin slot, due to multiple request for insert coin, please try again later!';
errorCodeMap['coin.slot.notavailable'] = 'Coin slot is not available as of the moment, Please try again later';
errorCodeMap['no.internet.detected'] = 'No internet connection as of the moment, Please try again later';
var totalCoinReceived = 0;
var insertcoinbg = new Audio('assets/insertcoinbg.mp3');
insertcoinbg.loop = true;
var coinCount = new Audio('assets/coin-received.mp3');
function safePlay(audio){
//play() returns a promise in modern browsers; an unhandled rejection
//(e.g. autoplay policy) used to break portal sound, so swallow it
	try{
		var p = audio.play();
		if(p && typeof p.catch === 'function'){ p.catch(function(){}); }
	}catch(e){}
}
var voucher = getStorageValue('activeVoucher');
var insertingCoin = false;
var TOPUP_INTERNET = "INTERNET";
var topupMode = TOPUP_INTERNET;
var rateType = "1";


$(document).ready(function(){
  $( "#saveVoucherButton" ).prop('disabled', true);	
  $( "#cncl" ).prop('disabled', false);
  $('#coinToast').toast({delay: 1000, animation: true});
  $('#coinSlotError').toast({delay: 5000, animation: true});
  var voucherError = false;
  
  $('#insertCoinModal').on('hidden.bs.modal', function () {
		clearInterval(timer);
		timer = null;
		insertingCoin = false;
		insertcoinbg.pause();
		insertcoinbg.currentTime = 0.0;
		if(totalCoinReceived == 0){
			$.ajax({
			  type: "POST",
			  url: "http://"+vendorIpAddress+"/cancelTopUp",
			  data: "voucher="+voucher+"&mac="+mac,
			  success: function(data){
				$("#loaderDiv").attr("class","spinner hidden");
			  },error: function (jqXHR, exception) {
				$("#loaderDiv").attr("class","spinner hidden");
			  }
			});
		}
		
	});

	if(loginError != "" && ((voucher != null && voucher != ""))){
		voucherError = true;
		removeStorageValue("isPaused");
		removeStorageValue("activeVoucher");
		voucher = "";
		$.toast({
			title: 'Error',
			content: "Invalid voucher, please make sure voucher is valid",
			type: 'error',
			delay: 5000
		});
	}
  
  if(isMultiVendo){
	  for(var i=0;i<multiVendoAddresses.length;i++){
		  $("#vendoSelected").append($('<option>', {
			value: multiVendoAddresses[i].vendoIp,
			text: multiVendoAddresses[i].vendoName
		  }));
	  }
	  var selectedVendo = getStorageValue('selectedVendo');
	  if(selectedVendo != null){
		  vendorIpAddress = selectedVendo;
	  }
	  $("#vendoSelected").val(vendorIpAddress);
	  $("#vendoSelected").change(function(){
		vendorIpAddress = $("#vendoSelected").val();
		setStorageValue('selectedVendo', vendorIpAddress);
	  });
	  
	  $("#vendoSelected").trigger("change");

  }else{
	  $("#vendoSelectDiv").attr("style", "display: none");
  }
  
  if(!dataRateOption){
	 $("#dataInfoDiv").attr("style", "display: none");
	 $("#dataInfoDiv2").attr("style", "display: none");
  }
  
  if(!showPauseTime){
	   $("#pauseTimeBtn").attr("style", "display: none");
  }
  
  if(!showMemberLogin){
	   $("#memberLoginBtn").attr("style", "display: none");
  }
  
  if(!showExtendTimeButton){
	   var inserType = $( "#insertBtn" ).attr('data-insert-type');
	   if(inserType == "extend"){
			$("#insertBtn").attr("style", "display: none");
	   }
  }
  
  if(disableVoucherInput){
	$("#voucherInput").attr("disabled", "disabled");
  }
  
  var isPaused = getStorageValue("isPaused");
  if(isPaused == "1"){
	  $("#pauseRemainTime").html(getStorageValue(voucher+"remain"));
  }

  
  var redirectLogin = getStorageValue("redirectLogin");
  if(redirectLogin == "1"){
	  removeStorageValue("redirectLogin");
	  location.reload();
	  return;
  }

  var forceLogout = getStorageValue("forceLogout");
  if(forceLogout == "1"){
		removeStorageValue("forceLogout");
		setStorageValue("redirectLogin", "1");
		setStorageValue("ignoreSaveCode", "1");
		document.forcelogout.submit();
		return;
  }

  
  var insertCoinTrigger = getStorageValue("insertCoinRefreshed");
  if(insertCoinTrigger == "1"){
	  insertBtnAction();
  }
  
  var macNoColon = replaceAll(mac, ":");
  
  var ignoreSaveCode = getStorageValue("ignoreSaveCode");
  if(ignoreSaveCode == null || ignoreSaveCode == "0"){
	  ignoreSaveCode = "0";
  }
  
  if(ignoreSaveCode != "1" && insertCoinTrigger != "1" && (!voucherError) && $("#voucherInput").length > 0){
	  $.ajax({
		  type: "GET",
		  url: "/data/"+macNoColon+".txt?query="+new Date().getTime(),
		  success: function(data){
			var macData = data.split("#");
			voucher = macData[0];
			$('#voucherInput').val(voucher);
			$("#connectBtn").click();
		  }
	  });
  }
 
});

function replaceAll(str, rep){
	var aa = str;
	while(aa.indexOf(rep) > 0){
		aa = aa.replace(rep, "");
	}
	return aa;
}

if(voucher == null){
	voucher = "";
}
if(voucher != ""){
	$('#voucherInput').val(voucher);
}

function cancelPause(){
	var r = confirm("Are you sure you want to cancel the session?");
	if(r){
		removeStorageValue("isPaused");
		removeStorageValue("activeVoucher");
		setStorageValue('forceLogout', "1");
		document.logout.submit();
	}
}

function promoBtnAction(){
	$('#promoRatesModal').modal('show');
	return false;
}

var timer = null;

function insertBtnAction(){
	var insertCoinRefreshed = getStorageValue("insertCoinRefreshed");
	removeStorageValue("ignoreSaveCode");
	if(insertCoinRefreshed == null || insertCoinRefreshed == "0"){
		setStorageValue('insertCoinRefreshed', "1");
		location.reload();
	}else{
		setStorageValue('insertCoinRefreshed', "0");
		$("#progressDiv").attr('style','width: 100%')
		$( "#saveVoucherButton" ).prop('disabled', true);
		$( "#cncl" ).prop('disabled', false);
		$("#loaderDiv").attr("class","spinner");
		totalCoinReceived = 0;
		
		var totalCoinReceivedSaved = getStorageValue("totalCoinReceived");
		if(totalCoinReceivedSaved != null){
			totalCoinReceived = totalCoinReceivedSaved;
		}
		
		$('#totalCoin').html("0");
		$('#totalTime').html(secondsToDhms(parseInt(0)));
		callTopupAPI(0);
	}
	return false;
}

$('#promoRatesModal').on('shown.bs.modal', function (e) {
	populatePromoRates(0);
})

function populatePromoRates(retryCount){
	$.ajax({
	  type: "GET",
	  url: "http://"+vendorIpAddress+"/getRates?rateType="+rateType+"&date="+(new Date().getTime()),
	  crossOrigin: true,
	  contentType: 'text/plain',
	  success: function(data){
		var rows = data.split("|");
		var rates = "";
		for(r in rows){
			var columns = rows[r].split("#");
			rates = rates + "<div class='rholder'>";
			rates = rates + "<div class='rdata'><span>Rate: </span>";
			rates = rates + columns[0];
			rates = rates + "</div>";
			rates = rates + "<div class='rdata'><span style='color: #a3a7ad'>Validity: ";
			rates = rates + secondsToDhms(parseInt(columns[3])*60);
			rates = rates + "</span></div>";
			if(dataRateOption){
				rates = rates + "<div class='rdata'><span style='color: #a3a7ad'>Data: ";
				if(columns[4] != ""){
					rates = rates + columns[4];
					rates = rates + " MB";
				}else{
					rates = rates + "unlimited";
				}
				rates = rates + "</span></div>";
			}
			rates = rates + "</div>";
		}
		$("#ratesBody").html(rates);
	  },error: function (jqXHR, exception) {
		  setTimeout(function() {
			if(retryCount < 2){
				populatePromoRates(retryCount+1);
			}
		  }, 1000 );
	  }
	});
}


function callTopupAPI(retryCount){
	
	var type = $( "#saveVoucherButton" ).attr('data-save-type');
	if(type != "extend" && totalCoinReceived == 0){
		var storedVoucher = getStorageValue('activeVoucher');
		if(storedVoucher != null){
			voucher = "";
			$("#voucherInput").val('');
			removeStorageValue("activeVoucher");
		}
		
	}
	
	$.ajax({
	  type: "POST",
	  url: "http://"+vendorIpAddress+"/topUp",
	  data: "voucher="+voucher+"&mac="+mac,
	  success: function(data){
		$("#loaderDiv").attr("class","spinner hidden");
		if(data.status == "true"){
			voucher = data.voucher;
			$('#insertCoinModal').modal('show');
			insertingCoin = true;
			$('#codeGenerated').html(voucher);
			$('#codeGeneratedBlock').attr('style', 'display: none');
			if(timer == null){
				timer = setInterval(checkCoin, 1000);
			}
			if(isMultiVendo){
				$("#insertCoinModalTitle").html("Please insert the coin on "+$("#vendoSelected option:selected").text());
			}
			safePlay(insertcoinbg);
		}else{
			notifyCoinSlotError(data.errorCode);
			clearInterval(timer);
			timer = null;
		}
	  },error: function (jqXHR, exception) {
		  setTimeout(function() {
			if(retryCount < 2){
				callTopupAPI(retryCount+1);
			}else{
				$("#loaderDiv").attr("class","spinner hidden");
				notifyCoinSlotError("coin.slot.notavailable");
			}
		  }, 1000 );
	  }
	});
}

function saveVoucherBtnAction(){
	$("#loaderDiv").attr("class","spinner");
	
	if(topupMode == TOPUP_INTERNET){
		setStorageValue('activeVoucher', voucher);
		removeStorageValue("totalCoinReceived");
		$('#voucherInput').val(voucher);
	}
	
	clearInterval(timer);
	timer = null;
	insertcoinbg.pause();
	insertcoinbg.currentTime = 0.0;
	$.ajax({
	  type: "POST",
	  url: "http://"+vendorIpAddress+"/useVoucher",
	  data: "voucher="+voucher,
	  success: function(data){
	
			totalCoinReceived = 0;
			$("#loaderDiv").attr("class","spinner hidden");
		if(data.status == "true"){
				setStorageValue(voucher+"tempValidity", data.validity);
				
				$.toast({
				  title: 'Success',
				  content: 'Thank you for the purchase!, will do auto login shortly',
				  type: 'success',
				  delay: 3000
				});
				
				var type = $( "#saveVoucherButton" ).attr('data-save-type');

				if(type == "extend"){
						$.ajax({
						  type: "POST",
						  url: "/logout",
						  data: "erase-cookie=true",
						  success: function(data){
							  setStorageValue('reLogin', '1');
							  location.reload();
						  }
						 });
				}else{
					setTimeout(function (){
						doLogin();
					}, 3000);
				}
		}else{
				notifyCoinSlotError(data.errorCode);
			}
		
		
	  },error: function (jqXHR, exception) {
		 $("#loaderDiv").attr("class","spinner hidden");
		 if(totalCoinReceived > 0){
		    $.toast({
			  title: 'Warning',
			  content: 'Connect/Login failed, however coin has been process, please manually connect using this voucher: '+voucher,
			  type: 'info',
			  delay: 8000
			});
		 }
	  }
	});
	
}

function checkCoin(){
	$.ajax({
	  type: "POST",
	  url: "http://"+vendorIpAddress+"/checkCoin",
	  data: "voucher="+voucher,
	  success: function(data){
		
		if(data.status == "true"){
			totalCoinReceived = parseInt(data.totalCoin);
			$('#totalCoin').html(data.totalCoin);	
			$('#totalTime').html(secondsToDhms(parseInt(data.timeAdded)));
			if(topupMode == TOPUP_INTERNET){
				$('#codeGeneratedBlock').attr('style', 'display: block');
				$('#totalData').html(data.data);
				$('#voucherInput').val(voucher);
			}
			
			setStorageValue('activeVoucher', voucher);
			setStorageValue('totalCoinReceived', totalCoinReceived);
			setStorageValue(voucher+"tempValidity", data.validity);
			notifyCoinSuccess(data.newCoin);
		}else{
			if(data.errorCode == "coin.not.inserted"){
				setStorageValue(voucher+"tempValidity", data.validity);
				
				var remainTime = parseInt(parseInt(data.remainTime)/1000);
				var waitTime = parseFloat(data.waitTime);
				var percent = parseInt(((remainTime*1000) / waitTime) * 100);
				totalCoinReceived = parseInt(data.totalCoin);
				if(totalCoinReceived > 0 ){
					$( "#saveVoucherButton" ).prop('disabled', false);
					$( "#cncl" ).prop('disabled', true);
				}
				if(remainTime == 0){
					$('#insertCoinModal').modal('hide');
					insertcoinbg.pause();
					insertcoinbg.currentTime = 0.0;
					if(totalCoinReceived > 0){
						$.toast({
						  title: 'Success',
						  content: 'Coin slot expired!, but was able to succesfully process the coin '+totalCoinReceived +", will do auto login shortly",
						  type: 'info',
						  delay: 5000
						});
						
						var type = $( "#saveVoucherButton" ).attr('data-save-type');
						setTimeout(function (){

							if(type == "extend"){
								$.ajax({
								  type: "POST",
								  url: "/logout",
								  data: "erase-cookie=true",
								  success: function(data){
									  setStorageValue('reLogin', '1');
									  location.reload();
								  }
								 });
							}else{
								doLogin();
							}
						}, 3000);
					}else{
						notifyCoinSlotError('coins.wait.expired');
					}
				}else{
					totalCoinReceived = parseInt(data.totalCoin);
					if(totalCoinReceived > 0 ){
						$( "#saveVoucherButton" ).prop('disabled', false);
						$( "#cncl" ).prop('disabled', true);
						$('#codeGeneratedBlock').attr('style', 'display: block');
					}
					$('#totalCoin').html(data.totalCoin);
					$('#totalData').html(data.data);
					$('#totalTime').html(secondsToDhms(parseInt(data.timeAdded)));
					//$( "#remainingTime" ).html(remainTime);
					$("#progressDiv").attr('style','width: '+percent+'%')
				}
				
			}else if(data.errorCode == "coinslot.busy"){
				//when manually cleared the button
				insertcoinbg.pause();
				insertcoinbg.currentTime = 0.0;
				clearInterval(timer);
				$('#insertCoinModal').modal('hide');
				if(totalCoinReceived == 0){
					notifyCoinSlotError("coinslot.cancelled");
				}else{
					 $.toast({
						title: 'Success',
						content: 'Coin slot cancelled!, but was able to succesfully process the coin '+totalCoinReceived +", will do auto login shortly",
						type: 'info',
						delay: 5000
					  });
					  var type = $( "#saveVoucherButton" ).attr('data-save-type');
					  setTimeout(function (){
						  if(type == "extend"){
							  setStorageValue('reLogin', '1');
							  document.logout.submit();
						  }else{
							  doLogin();
						  }
					  }, 3000);
				}
			}else{
				notifyCoinSlotError(data.errorCode);
				clearInterval(timer);
			}
		}
	  },error: function (jqXHR, exception) {
			console.log('error!!!');
	  }
	});
}

function notifyCoinSlotError(errorCode){
	$.toast({
	  title: 'Error',
	  content: errorCodeMap[errorCode],
	  type: 'error',
	  delay: 5000
	});
}

function notifyCoinSuccess(coin){
	$.toast({
	  title: 'Coin inserted',
	  content: coin+' peso(s) was inserted',
	  type: 'success',
	  delay: 2000
	});
	safePlay(coinCount);
}

function secondsToDhms(seconds) {
	seconds = Number(seconds);
	var d = Math.floor(seconds / (3600*24));
	var h = Math.floor(seconds % (3600*24) / 3600);
	var m = Math.floor(seconds % 3600 / 60);
	var s = Math.floor(seconds % 60);

	var dDisplay = d > 0 ? d + (d == 1 ? " Day " : " Days ") : "";
	var hDisplay = h > 0 ? h + (h == 1 ? "" : "") : "0";
	var mDisplay = m > 0 ? m + (m == 1 ? "" : "") : "0";
	var sDisplay = s > 0 ? s + (s == 1 ? "" : "") : "0";
	return dDisplay + " " + hDisplay + "h : " + mDisplay + "m : " + sDisplay + "s";
}

function setStorageValue(key, value){
	if(localStorage != null){
		localStorage.setItem(key, value);
	}else{
		setCookie(key,value,364);
	}
}

function removeStorageValue(key){
	if(localStorage != null){
		localStorage.removeItem(key);
	}else{
		eraseCookie(key);
	}
}

function pause(){
	var vc = getStorageValue("activeVoucher");
	setStorageValue("isPaused", "1");
	setStorageValue(vc+"remain", $("#remainTime").html());
	document.logout.submit();
}

function resume(){
	var vc = getStorageValue("activeVoucher");
	removeStorageValue("isPaused");
	if(vc){ removeStorageValue(vc+"remain"); }
	removeStorageValue("activeVoucher");
	location.reload();
}

function getStorageValue(key){
	if(localStorage!= null){
		return localStorage.getItem(key);
	}else{
		return getCookie(key);
	}
}

function setCookie(name,value,days) {
    var expires = "";
    if (days) {
        var date = new Date();
        date.setTime(date.getTime() + (days*24*60*60*1000));
        expires = "; expires=" + date.toUTCString();
    }
    document.cookie = name + "=" + (value || "")  + expires + "; path=/";
}
function getCookie(name) {
    var nameEQ = name + "=";
    var ca = document.cookie.split(';');
    for(var i=0;i < ca.length;i++) {
        var c = ca[i];
        while (c.charAt(0)==' ') c = c.substring(1,c.length);
        if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length,c.length);
    }
    return null;
}
function eraseCookie(name) {   
    document.cookie = name+'=; Max-Age=-99999999;';  
}