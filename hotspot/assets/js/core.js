// JuanFiV2 portal core — one-page app shared by login.html / status.html / logout.html.
// Each page sets PAGE ("login"|"status"|"logout") plus its MikroTik vars
// (mac, uIp, hotspotAddress, interfaceName, loginError) before this loads,
// then calls boot() on document ready. Boot shows a loading screen, preloads
// promo rates + session data, then reveals the page.

var errorCodeMap = {
	'coins.wait.expired': 'Coin slot expired',
	'coin.not.inserted': 'Coin not inserted',
	'coinslot.cancelled': 'Coinslot was cancelled',
	'coinslot.busy': 'Coin slot is busy',
	'coin.slot.banned': 'You have been banned from using coin slot, due to multiple request for insert coin, please try again later!',
	'coin.slot.notavailable': 'Coin slot is not available as of the moment, Please try again later',
	'no.internet.detected': 'No internet connection as of the moment, Please try again later',
	'invalid.voucher': 'Invalid voucher code',
	'invalid.request': 'Invalid request, please try again'
};

var voucher = getStorageValue('activeVoucher');
if (voucher == null) { voucher = ""; }
// Portal state: "login" | "status" | "paused". Router pages preset PAGE;
// portal.html (single-file) switches it live via setPortalState().
var STATE = (typeof PAGE !== 'undefined') ? (PAGE === 'logout' ? 'paused' : PAGE) : 'login';
var insertingCoin = false;
var totalCoinReceived = 0;
var timer = null;
var bootDone = false;

// Built-in sounds: WebAudio synth + vibration, no MP3 files needed.
// Works offline; degrades silently where unsupported (e.g. iOS vibration).
var sfxCtx = null;
var sfxLoopTimer = null;
function sfxEnsure() {
	try {
		if (sfxCtx == null) {
			var AC = window.AudioContext || window.webkitAudioContext;
			if (!AC) { return null; }
			sfxCtx = new AC();
		}
		if (sfxCtx.state == "suspended") { sfxCtx.resume(); }
		return sfxCtx;
	} catch (e) { return null; }
}
function sfxTone(freq, durMs, type, vol, delayMs) {
	var ctx = sfxEnsure();
	if (!ctx) { return; }
	try {
		var t = ctx.currentTime + (delayMs || 0) / 1000;
		var o = ctx.createOscillator();
		var g = ctx.createGain();
		o.type = type || "sine";
		o.frequency.value = freq;
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.02);
		g.gain.exponentialRampToValueAtTime(0.0001, t + durMs / 1000);
		o.connect(g);
		g.connect(ctx.destination);
		o.start(t);
		o.stop(t + durMs / 1000 + 0.05);
	} catch (e) { }
}
function sfxVibrate(pattern) {
	try { if (navigator.vibrate) { navigator.vibrate(pattern); } } catch (e) { }
}
// Gentle waiting chime while the customer inserts coins.
function sfxChime() {
	sfxTone(990, 90, "sine", 0.24);
}
function sfxStartLoop() {
	sfxStopLoop();
	sfxChime();
	sfxLoopTimer = setInterval(sfxChime, 500);
}
// Per-coin blip + haptic tick.
function coinBlip() {
	sfxTone(1568, 120, "square", 0.16);
	sfxTone(2093, 150, "square", 0.12, 90);
	sfxVibrate(40);
}
function sfxStopLoop() {
	if (sfxLoopTimer != null) { clearInterval(sfxLoopTimer); sfxLoopTimer = null; }
	sfxVibrate(0);
}

// Dependency-free toast: drop-in for $.toast({title, content, type, delay}).
// Replaces bootstrap.js + toast.min.js (~63KB of router flash).
(function ($) {
	if (!$ || $.toast) { return; }
	var COLORS = { success: "#067647", error: "#d92d20", info: "#175cd3", warning: "#b7791f" };
	$.toast = function (o) {
		o = o || {};
		var box = document.getElementById("juanfi-toasts");
		if (!box) {
			box = document.createElement("div");
			box.id = "juanfi-toasts";
			document.body.appendChild(box);
		}
		var el = document.createElement("div");
		el.className = "jtoast";
		el.style.borderLeftColor = COLORS[o.type] || COLORS.info;
		var b = document.createElement("b");
		b.textContent = o.title || "";
		var s = document.createElement("span");
		s.textContent = o.content || "";
		el.appendChild(b);
		el.appendChild(s);
		box.appendChild(el);
		setTimeout(function () { el.classList.add("show"); }, 10);
		setTimeout(function () {
			el.classList.remove("show");
			setTimeout(function () { if (el.parentNode) { el.parentNode.removeChild(el); } }, 300);
		}, o.delay || 3000);
	};
})(window.jQuery);

// ---------- storage ----------

function setStorageValue(key, value) {
	if (typeof localStorage !== 'undefined' && localStorage != null) {
		localStorage.setItem(key, value);
	} else {
		setCookie(key, value, 364);
	}
}

function getStorageValue(key) {
	if (typeof localStorage !== 'undefined' && localStorage != null) {
		return localStorage.getItem(key);
	}
	return getCookie(key);
}

function removeStorageValue(key) {
	if (typeof localStorage !== 'undefined' && localStorage != null) {
		localStorage.removeItem(key);
	} else {
		eraseCookie(key);
	}
}

function setCookie(name, value, days) {
	var expires = "";
	if (days) {
		var date = new Date();
		date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
		expires = "; expires=" + date.toUTCString();
	}
	document.cookie = name + "=" + (value || "") + expires + "; path=/";
}

function getCookie(name) {
	var nameEQ = name + "=";
	var ca = document.cookie.split(';');
	for (var i = 0; i < ca.length; i++) {
		var c = ca[i];
		while (c.charAt(0) == ' ') c = c.substring(1, c.length);
		if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
	}
	return null;
}

function eraseCookie(name) {
	document.cookie = name + '=; Max-Age=-99999999;';
}

function macNoColon() {
	return String(mac).split(":").join("");
}

// ---------- boot loader ----------

function setBootText(t) {
	$("#bootText").html(t);
}

function hideBoot() {
	if (bootDone) { return; }
	bootDone = true;
	$("#bootLoader").attr("style", "display: none");
	$("#app").attr("style", "display: block");
}

function boot() {
	// Re-login after an extend that outlived its session (set by autoLoginAfterCoin).
	// Runs here — not in the shell — because doLogin only exists after injection.
	if (getStorageValue('reLogin') == '1') {
		removeStorageValue('reLogin');
		// A logout/reload wipes the page but not storage: restore the
		// voucher into the input or doLogin has nothing to submit.
		var sv = getStorageValue('activeVoucher');
		if (sv && !$("#voucherInput").val()) { $("#voucherInput").val(sv); }
		doLogin();
		return;
	}
	// One-way storage migration: stale flags from older portal builds used to
	// wedge pause/cancel/auto-login (clearing browser data fixed it by hand).
	try {
		if (getStorageValue("portalBuild") !== "r4") {
			var wipeKeys = ["activeVoucher", "isPaused", "forceLogout",
				"redirectLogin", "ignoreSaveCode", "insertCoinRefreshed",
				"totalCoinReceived", "reLogin", "selectedVendo"];
			for (var w = 0; w < wipeKeys.length; w++) { eraseCookie(wipeKeys[w]); }
			if (typeof localStorage !== 'undefined' && localStorage != null) { localStorage.clear(); }
			setStorageValue("portalBuild", "r4");
			voucher = "";
		}
	} catch (e) { }
	$("#footYear").html(new Date().getFullYear());
	applyFlags();
	if (voucher != "" && $("#voucherInput").length > 0) {
		$('#voucherInput').val(voucher);
	}

	// Failsafe: never trap the customer behind the loader (dead vendo, no net).
	setTimeout(hideBoot, 9000);

	setBootText("Detecting session...");
	detectState().done(function (state) {
		render(state);
		var jobs = [loadRates()];
		if (state == "login") {
			jobs.push(resumeSession());
		} else {
			jobs.push(showValidity());
		}
		// jQuery promises settle fail or success — either way reveal the portal.
		$.when.apply($, jobs).always(function () {
			setBootText("Ready");
			hideBoot();
		});
	});
}

// Probe the router for the real client state and render the matching view,
// document.write-style: one file, UI follows the session, not the filename.
function detectState() {
	var d = $.Deferred();
	try {
		var force = new URLSearchParams(location.search).get("state");
		if (force == "login" || force == "status" || force == "paused") {
			d.resolve(force);
			return d.promise();
		}
	} catch (e) { }
	// A reload while paused means the user is coming back: drop the pause
	// and fall through to auto-resume below. The paused view only ever
	// renders via pause() itself (no reload), or ?state=paused for testing.
	if (getStorageValue("isPaused") == "1") {
		removeStorageValue("isPaused");
	}
	$.ajax({ type: "GET", url: "/status" }).done(function (data) {
		var html = String(data);
		if (html.indexOf("IAMNOTLOGINSTRINGPLEASEDONTREMOVE") >= 0) {
			d.resolve("login");
		} else {
			// Logged in: lift live session facts out of the status page itself.
			var m = html.match(/(?:var|window\.)currentVoucher\s*=\s*"([^"]*)"/);
			if (m) {
				window.currentVoucher = m[1];
				voucher = m[1];
				setStorageValue('activeVoucher', m[1]);
			}
			var t = html.match(/(?:var|window\.)sessiontime\s*=\s*"([^"]*)"/);
			if (t) { window.sessiontime = t[1]; }
			d.resolve("status");
		}
	}).fail(function () {
		d.resolve("login");
	});
	return d.promise();
}

function render(state) {
	setPortalState(state);
	var pill = '';
	if (state == "login") {
		pill = '<span class="status-disconnected">Status: <span class="blinking1">Disconnected</span></span>';
		$("#connPill").html(pill);
		return;
	}
	if (state == "status") {
		pill = '<span class="status-connected">Status: <span class="blinking2" style="color: #4cd137">Connected</span></span>';
	} else {
		pill = '<span class="status-connected">Status: <span class="blinking1" style="color: #4cd137">Paused</span></span>';
	}
	$("#connPill").html(pill);
	if (state == "status") {
		$("#statusVoucher").html(voucher);
		if (window.bytesInNice) { $("#upBytes").html(window.bytesInNice); }
		if (window.bytesOutNice) { $("#downBytes").html(window.bytesOutNice); }
		if (window.remainBytesNice) { $("#totalDataInfo").html(window.remainBytesNice); }
		startCountdown();
	}
	if (state == "paused") {
		$("#pausedVoucher").html(voucher);
		$("#pauseRemainTime").html(getStorageValue(voucher + "remain"));
		fitCountdown("#pauseRemainTime");
	}
}

// Compact countdown, biggest units first; seconds always shown.
// fitCountdown() shrinks long values to fit instead of clipping them.
function compactDhms(seconds) {
	seconds = Math.max(0, Number(seconds) || 0);
	var d = Math.floor(seconds / 86400);
	var h = Math.floor(seconds % 86400 / 3600);
	var m = Math.floor(seconds % 3600 / 60);
	var s = Math.floor(seconds % 60);
	function p(n) { return (n < 10 ? "0" : "") + n; }
	if (d > 0) { return d + "d " + p(h) + "h " + p(m) + "m " + p(s) + "s"; }
	if (h > 0) { return h + "h " + p(m) + "m " + p(s) + "s"; }
	return p(m) + "m " + p(s) + "s";
}

// Shrink a hero countdown until it fits (long hour counts clip the
// trailing "s" on 320px phones). Resets to the stylesheet size first
// so shorter values grow back; re-runs on rotate/resize.
function fitCountdown(sel) {
	var el = $(sel);
	if (el.length == 0) { return; }
	if (!window.__countdownFitBound) {
		window.__countdownFitBound = true;
		$(window).on("resize orientationchange", function () {
			fitCountdown("#remainTime");
			fitCountdown("#pauseRemainTime");
		});
	}
	el.css("font-size", "");
	var node = el.get(0);
	var size = parseFloat(el.css("font-size")) || 30;
	var guard = 0;
	while (size > 20 && node.scrollWidth > node.clientWidth + 1 && guard < 20) {
		size -= 1;
		el.css("font-size", size + "px");
		guard++;
	}
}

function startCountdown() {
	if ($("#remainTime").length == 0 || window.sessiontime == null) { return; }
	var time = window.sessiontime;
	if (time == "0" || time == "") {
		$("#remainTime").html("Unlimited");
		return;
	}
	time = parseInt(time);
	$("#remainTime").html(compactDhms(time));
	fitCountdown("#remainTime");
	if (window.remainingTimer != null) { clearInterval(window.remainingTimer); }
	window.remainingTimer = setInterval(function () {
		time--;
		$("#remainTime").html(compactDhms(time));
		fitCountdown("#remainTime");
		if (time <= 0) {
			$.toast({ title: 'Success', content: 'Time limit exceeded, Thank you for the purchase, will be logout shortly', type: 'success', delay: 5000 });
			clearInterval(window.remainingTimer);
			setTimeout(function () { document.logout.submit(); }, 6000);
		}
	}, 1000);
}

function applyFlags() {
	if (typeof isMultiVendo !== 'undefined' && isMultiVendo && $("#vendoSelected").length > 0) {
		if (multiVendoOption == 1) {
			$("#vendoSelectDiv").attr("style", "display: none");
			var currentHotspot = hotspotAddress.split(":")[0];
			for (var i = 0; i < multiVendoAddresses.length; i++) {
				if (multiVendoAddresses[i].hotspotAddress == currentHotspot) {
					vendorIpAddress = multiVendoAddresses[i].vendoIp;
				}
			}
		} else if (multiVendoOption == 2) {
			$("#vendoSelectDiv").attr("style", "display: none");
			for (var j = 0; j < multiVendoAddresses.length; j++) {
				if (multiVendoAddresses[j].interfaceName == interfaceName) {
					vendorIpAddress = multiVendoAddresses[j].vendoIp;
				}
			}
		} else {
			for (var k = 0; k < multiVendoAddresses.length; k++) {
				$("#vendoSelected").append($('<option>', {
					value: multiVendoAddresses[k].vendoIp,
					text: multiVendoAddresses[k].vendoName
				}));
			}
			var selectedVendo = getStorageValue('selectedVendo');
			if (selectedVendo != null) {
				vendorIpAddress = selectedVendo;
			}
			$("#vendoSelected").val(vendorIpAddress);
			$("#vendoSelected").change(function () {
				vendorIpAddress = $("#vendoSelected").val();
				setStorageValue('selectedVendo', vendorIpAddress);
			});
			$("#vendoSelected").trigger("change");
		}
	} else {
		$("#vendoSelectDiv").attr("style", "display: none");
	}

	if (!dataRateOption) {
		$("#dataInfoDiv").attr("style", "display: none");
		$("#dataUsedRow").attr("style", "display: none");
		$("#dataRemainRow").attr("style", "display: none");
	}
	if (!showPauseTime) {
		$("#pauseTimeBtn").attr("style", "display: none");
	}
	if (!showMemberLogin) {
		$("#memberSection").attr("style", "display: none");
	}
	if (!showExtendTimeButton) {
		$("#extendBtn").attr("style", "display: none");
	}
	if (typeof disableVoucherInput !== 'undefined' && disableVoucherInput) {
		$("#voucherBlock").attr("style", "display: none");
	}
}

// ---------- focused blocks: one action on screen at a time (no modals) ----------

// Collapse/expand a section body; headers with class "toggle" call this.
function toggleBlock(id) {
	if (id == "memberSectionBody" && (typeof showMemberLogin === 'undefined' || !showMemberLogin)) { return; }
	var el = document.getElementById(id);
	if (!el) { return; }
	var hidden = el.style.display == "none";
	el.style.display = hidden ? "block" : "none";
	var head = document.getElementById(id + "Head");
	if (head) {
		var h = head.innerHTML;
		if (h.indexOf("&#9656;") >= 0 || h.indexOf("▸") >= 0) {
			head.innerHTML = h.replace("&#9656;", "&#9662;").replace("▸", "▾");
		} else {
			head.innerHTML = h.replace("&#9662;", "&#9656;").replace("▾", "▸");
		}
	}
}

function showCoinPanel() {
	// In-place swap: the coin panel takes the pressed button's spot.
	// The rest of the UI darkens under a veil (rates stay lit);
	// voucher + member are hidden until the panel closes.
	var slot = (STATE == "status") ? "#coinSlot-status" : "#coinSlot-login";
	var panel = document.getElementById("coinPanel");
	var dest = document.querySelector(slot);
	if (panel && dest && panel.parentNode !== dest) { dest.appendChild(panel); }
	if (STATE == "status") {
		$("#extendBtn").attr("style", "display: none");
		// Extend focus mirrors login: only panel + rates stay lit.
		// NOTE: hide #statusHero by id — the coin panel carries its own
		// .hero block once moved in, and a descendant selector would kill it.
		$("#statusHero").attr("style", "display: none");
		$("#view-status .stat-list").attr("style", "display: none");
		$("#expireRow").attr("style", "display: none");
		$("#view-status .btnrow").attr("style", "display: none");
	} else {
		$("#insertBtn").attr("style", "display: none");
	}
	$("#voucherBlock").attr("style", "display: none");
	$("#memberSection").attr("style", "display: none");
	document.body.classList.add("coin-focus");
	$("#coinPanel").attr("style", "display: block");
	var el = document.getElementById("coinPanel");
	if (el && el.scrollIntoView) { el.scrollIntoView(); }
}

function restoreCoinChrome() {
	document.body.classList.remove("coin-focus");
	$("#statusHero").attr("style", "");
	$("#view-status .stat-list").attr("style", "");
	$("#view-status .btnrow").attr("style", "");
	$("#expireRow").attr("style", "");
	if (typeof disableVoucherInput !== 'undefined' && disableVoucherInput) {
		$("#voucherBlock").attr("style", "display: none");
	} else {
		$("#voucherBlock").attr("style", "");
	}
	if (typeof showMemberLogin === 'undefined' || showMemberLogin) {
		$("#memberSection").attr("style", "");
	} else {
		$("#memberSection").attr("style", "display: none");
	}
}

function cancelCoin() {
	clearInterval(timer);
	timer = null;
	insertingCoin = false;
	sfxStopLoop();
	if (totalCoinReceived == 0) {
		$.ajax({
			type: "POST",
			url: "http://" + vendorIpAddress + "/cancelTopUp",
			data: "voucher=" + voucher + "&mac=" + mac,
			success: function () { $("#loaderDiv").attr("class", "spinner hidden"); },
			error: function () { $("#loaderDiv").attr("class", "spinner hidden"); }
		});
	}
	render(STATE);
}

// Shows one of "login" | "status" | "paused" (single-file portal).
function setPortalState(s) {
	STATE = s;
	$("#coinPanel").attr("style", "display: none");
	$("#insertBtn").attr("style", "");
	$("#extendBtn").attr("style", "");
	restoreCoinChrome();
	$("#view-login").attr("style", s == "login" ? "display: block" : "display: none");
	$("#view-status").attr("style", s == "status" ? "display: block" : "display: none");
	$("#view-paused").attr("style", s == "paused" ? "display: block" : "display: none");
	// Paused screen stays minimal: resume/cancel only, rates hidden.
	$("#ratesSection").attr("style", s == "paused" ? "display: none" : "display: block");
	$("#saveVoucherButton").attr('data-save-type', s == "status" ? "extend" : "purchase");
	if ((s == "status" || s == "paused") && $("#expirationTime").html() == "") {
		showValidity();
	}
}

// ---------- promo rates (inline section, no modal) ----------

// Human durations for the rates table: "10 mins", "1 hour", "3 days".
function humanDuration(mins) {
	mins = parseInt(mins || 0);
	if (mins <= 0) { return "—"; }
	if (mins < 60) { return mins + (mins == 1 ? " min" : " mins"); }
	var h = Math.floor(mins / 60);
	if (h < 24) { return h + (h == 1 ? " hour" : " hours"); }
	var d = Math.floor(h / 24);
	return d + (d == 1 ? " day" : " days");
}

function loadRates() {
	setBootText("Loading promo rates...");
	return $.ajax({
		type: "GET",
		url: "http://" + vendorIpAddress + "/getRates?date=" + (new Date().getTime())
	}).done(function (data) {
		var html = "<div class='table-responsive'><table class='table table-striped'>";
		html += "<thead><tr><th>Rate</th><th>Time</th><th>Validity</th>";
		if (dataRateOption) { html += "<th>Data</th>"; }
		html += "</tr></thead><tbody>";
		var rows = String(data).split("|");
		for (var r = 0; r < rows.length; r++) {
			if (rows[r] == "") { continue; }
			var c = rows[r].split("#");
			html += "<tr><td>" + escHtml(c[0]) + "</td>";
			html += "<td>" + humanDuration(c[2]) + "</td>";
			html += "<td>" + humanDuration(c[3]) + "</td>";
			if (dataRateOption) {
				html += "<td>" + (c[4] != "" ? escHtml(c[4]) + " MB" : "unlimited") + "</td>";
			}
			html += "</tr>";
		}
		html += "</tbody></table></div>";
		$("#ratesBody").html(html);
	}).fail(function () {
		$("#ratesBody").html("<p>Rates unavailable — vendo unreachable.</p>");
	});
}

function escHtml(s) {
	return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------- session resume (login page) ----------

function resumeSession() {
	setBootText("Checking session...");
	var d = $.Deferred();
	// Single-file portal keeps all views in the DOM: only auto-connect on login state.
	if (typeof STATE !== 'undefined' && STATE != "login") { d.resolve(); return d.promise(); }
	if (loginError != "" && voucher != "") {
		removeStorageValue("isPaused");
		removeStorageValue("activeVoucher");
		voucher = "";
		$.toast({ title: 'Error', content: "Invalid voucher, please make sure voucher is valid", type: 'error', delay: 5000 });
		d.resolve();
		return d.promise();
	}
	var isPaused = getStorageValue("isPaused");
	if (isPaused == "1") {
		$("#pauseRemainTime").html(getStorageValue(voucher + "remain"));
		fitCountdown("#pauseRemainTime");
	}
	var ignoreSaveCode = getStorageValue("ignoreSaveCode") || "0";
	var insertCoinTrigger = getStorageValue("insertCoinRefreshed");
	if (ignoreSaveCode != "1" && insertCoinTrigger != "1" && $("#voucherInput").length > 0) {
		$.ajax({ type: "GET", url: "/data/" + macNoColon() + ".txt?query=" + new Date().getTime() })
			.done(function (data) {
				var parts = String(data).split("#");
				var fileVoucher = (parts[0] || "").trim();
				var validUntil = parts.length > 1 ? parseValidity(parts[1]) : null;
				// Stale session file (empty or expired voucher): never
				// auto-connect it, or a dead test code keeps logging
				// itself in on every visit to the login page.
				if (fileVoucher == "" || (validUntil != null && validUntil.getTime() < new Date().getTime())) {
					removeStorageValue("activeVoucher");
					d.resolve();
					return;
				}
				voucher = fileVoucher;
				$('#voucherInput').val(voucher);
				$("#connectBtn").click();
			})
			.always(function () { d.resolve(); });
	} else {
		d.resolve();
	}
	return d.promise();
}

// ---------- validity (status / logout pages) ----------

function parseValidity(raw) {
	raw = String(raw == null ? "" : raw);
	if (raw.length == 0) { return null; }
	if (raw.length > 15) { return new Date(Date.parse(raw)); }
	if (raw.length > 8) {
		var dt = raw.split(" ");
		return new Date(Date.parse(dt[0] + "/" + new Date().getFullYear() + " " + dt[1]));
	}
	var cur = new Date();
	return new Date(Date.parse((cur.getMonth() + 1) + "/" + cur.getDate() + "/" + cur.getFullYear() + " " + raw));
}

function renderExpiration(html) {
	// Single-file portal has two expiry slots (status + paused views).
	$("#expirationTime").html(html);
	$("#expirationTimePaused").html(html);
}

function showValidity() {
	setBootText("Loading session...");
	var d = $.Deferred();
	$.ajax({ type: "GET", url: "/data/" + macNoColon() + ".txt?query=" + new Date().getTime() })
		.done(function (data) {
			if (String(data).length > 50) { fallbackValidity(); d.resolve(); return; }
			var t = parseValidity(String(data).split("#")[1]);
			renderExpiration(t != null ? t.toLocaleString() : "No Expiration");
			d.resolve();
		})
		.fail(function () { fallbackValidity(); d.resolve(); });
	return d.promise();
}

function fallbackValidity() {
	var validity = getStorageValue(voucher + "validity");
	if (validity != null) {
		var t = new Date(parseInt(validity));
		if (t.getTime() < new Date().getTime()) {
			removeStorageValue(voucher + "validity");
			removeStorageValue(voucher + "tempValidity");
			renderExpiration("Not Available");
		} else {
			renderExpiration(t.toLocaleString());
		}
	} else {
		renderExpiration("Not Available");
	}
}

// ---------- coin flow ----------

function promoBtnAction() {
	var el = document.getElementById("ratesSection");
	if (el && el.scrollIntoView) { el.scrollIntoView(); }
	return false;
}

function insertBtnAction() {
	// No double-submit: one coin session at a time (second tap = busy error).
	if (insertingCoin) { return false; }
	insertingCoin = true;
	removeStorageValue("ignoreSaveCode");
	setStorageValue('insertCoinRefreshed', "0");
	$("#saveVoucherButton").attr('data-save-type', STATE == "status" ? "extend" : "purchase");
	$("#progressDiv").css('width', '100%');
	$("#progressDiv").removeClass("time-half time-low").addClass("time-ok");
	$("#progressDiv").html("");
	$("#saveVoucherButton").prop('disabled', true);
	$("#cncl").prop('disabled', false);
	$("#loaderDiv").attr("class", "spinner");
	totalCoinReceived = 0;
	$('#totalCoin').html("0");
	$('#totalTime').html(secondsToDhms(0));

	if ($("#saveVoucherButton").attr('data-save-type') != "extend" && PAGE === "login") {
		// Not logged in yet? The router serves the login page (marker present) — top up.
		// Already logged in (status page served)? Bounce there instead.
		$.ajax({
			type: "GET",
			url: "/status",
			success: function (data) {
				if (data.indexOf("IAMNOTLOGINSTRINGPLEASEDONTREMOVE") < 0) {
					location.reload();
				} else {
					callTopupAPI(0);
				}
			}
		});
	} else {
		callTopupAPI(0);
	}
	return false;
}

function callTopupAPI(retryCount) {
	$('#cncl').html("Cancel");
	$("#vcCodeDiv").attr('style', 'display: block');
	var isExtend = $("#saveVoucherButton").attr('data-save-type') == "extend";

	if (!isExtend && totalCoinReceived == 0) {
		var storedVoucher = getStorageValue('activeVoucher');
		if (storedVoucher != null) {
			voucher = "";
			$("#voucherInput").val('');
			removeStorageValue("activeVoucher");
		}
	}

	$.ajax({
		type: "POST",
		url: "http://" + vendorIpAddress + "/topUp",
		data: "voucher=" + voucher + "&mac=" + mac + "&extendTime=" + (isExtend ? "1" : "0"),
		success: function (data) {
			$("#loaderDiv").attr("class", "spinner hidden");
			if (data.status == "true") {
				voucher = data.voucher;
				showCoinPanel();
				insertingCoin = true;
				$('#codeGenerated').html(voucher);
				$('#codeGeneratedBlock').attr('style', 'display: none');
				if (timer == null) {
					timer = setInterval(checkCoin, 1000);
				}
				if (isMultiVendo) {
					$("#coinPanelTitle").html("Please insert the coin on " + $("#vendoSelected option:selected").text());
				}
				sfxStartLoop();
			} else {
				notifyCoinSlotError(data.errorCode);
				clearInterval(timer);
				timer = null;
				insertingCoin = false;
			}
		}, error: function () {
			setTimeout(function () {
				if (retryCount < 3) {
					callTopupAPI(retryCount + 1);
				} else {
					$("#loaderDiv").attr("class", "spinner hidden");
					notifyCoinSlotError("coin.slot.notavailable");
					insertingCoin = false;
				}
			}, 1000);
		}
	});
}

function saveVoucherBtnAction() {
	$("#loaderDiv").attr("class", "spinner");
	setStorageValue('activeVoucher', voucher);
	removeStorageValue("totalCoinReceived");
	$('#voucherInput').val(voucher);

	clearInterval(timer);
	timer = null;
	sfxStopLoop();
	$.ajax({
		type: "POST",
		url: "http://" + vendorIpAddress + "/useVoucher",
		data: "voucher=" + voucher,
		success: function (data) {
			totalCoinReceived = 0;
			insertingCoin = false;
			$("#loaderDiv").attr("class", "spinner hidden");
			if (data.status == "true") {
				setStorageValue(voucher + "tempValidity", data.validity);
				$.toast({ title: 'Success', content: 'Thank you for the purchase!, will do auto login shortly', type: 'success', delay: 3000 });
				if ($("#saveVoucherButton").attr('data-save-type') == "extend") {
					// A reload alone keeps the same router session, whose
					// time-left never picks up the extended limit. End the
					// session like pause/resume does; boot auto-logs back
					// in with the extended voucher for a fresh countdown.
					setStorageValue('reLogin', '1');
					setTimeout(function () {
						try { document.logout.submit(); }
						catch (e) { location.reload(); }
					}, 3000);
				} else {
					setTimeout(newLogin, 3000);
				}
			} else {
				notifyCoinSlotError(data.errorCode);
			}
		}, error: function (jqXHR, exception) {
			$("#loaderDiv").attr("class", "spinner hidden");
			if (totalCoinReceived > 0) {
				$.toast({ title: 'Warning', content: 'Connect/Login failed, however coin has been process, please manually connect using this voucher: ' + voucher, type: 'info', delay: 8000 });
			}
		}
	});
}

function checkCoin() {
	$.ajax({
		type: "POST",
		url: "http://" + vendorIpAddress + "/checkCoin",
		data: "voucher=" + voucher,
		success: function (data) {
			$("#noticeDiv").attr('style', 'display: none');
			if (data.status == "true") {
			totalCoinReceived = parseInt(data.totalCoin);
			$('#totalCoin').html(data.totalCoin);
			$('#totalTime').html(secondsToDhms(parseInt(data.timeAdded)));
			$('#codeGeneratedBlock').attr('style', 'display: block');
			$('#voucherInput').val(voucher);
				setStorageValue('activeVoucher', voucher);
				setStorageValue('totalCoinReceived', totalCoinReceived);
				setStorageValue(voucher + "tempValidity", data.validity);
				notifyCoinSuccess(data.newCoin);
			} else if (data.errorCode == "coin.not.inserted") {
				setStorageValue(voucher + "tempValidity", data.validity);
				var remainTime = parseInt(parseInt(data.remainTime) / 1000);
				var waitTime = parseFloat(data.waitTime);
				var percent = parseInt(((remainTime * 1000) / waitTime) * 100);
				totalCoinReceived = parseInt(data.totalCoin);
				if (totalCoinReceived > 0) {
					$("#saveVoucherButton").prop('disabled', false);
					$("#cncl").prop('disabled', true);
					$('#codeGeneratedBlock').attr('style', 'display: block');
				}
				if (remainTime == 0) {
					closeCoinModal();
					if (totalCoinReceived > 0) {
						$.toast({ title: 'Success', content: 'Coin slot expired!, but was able to succesfully process the coin ' + totalCoinReceived + ", will do auto login shortly", type: 'info', delay: 5000 });
						setTimeout(autoLoginAfterCoin, 3000);
					} else {
						notifyCoinSlotError('coins.wait.expired');
					}
				} else {
					$('#totalCoin').html(data.totalCoin);
					$('#totalTime').html(secondsToDhms(parseInt(data.timeAdded)));
					var bar = $("#progressDiv");
					bar.css('width', percent + '%');
					bar.removeClass("time-ok time-half time-low");
					bar.addClass(percent > 50 ? "time-ok" : (percent >= 25 ? "time-half" : "time-low"));
					bar.html(remainTime + "s");
				}
			} else if (data.errorCode == "coinslot.busy") {
				// Session cleared on the vendo side (manual cancel).
				closeCoinModal();
				if (totalCoinReceived == 0) {
					notifyCoinSlotError("coinslot.cancelled");
				} else {
					$.toast({ title: 'Success', content: 'Coin slot cancelled!, but was able to succesfully process the coin ' + totalCoinReceived + ", will do auto login shortly", type: 'info', delay: 5000 });
					setTimeout(autoLoginAfterCoin, 3000);
				}
			} else {
				notifyCoinSlotError(data.errorCode);
				clearInterval(timer);
				timer = null;
				insertingCoin = false;
			}
		}, error: function () {
			console.log('checkCoin error, retrying on next tick');
		}
	});
}

function closeCoinModal() {
	sfxStopLoop();
	clearInterval(timer);
	timer = null;
	insertingCoin = false;
	render(STATE);
}

function autoLoginAfterCoin() {
	if ($("#saveVoucherButton").attr('data-save-type') == "extend") {
		setStorageValue('reLogin', '1');
		document.logout.submit();
	} else {
		newLogin();
	}
}

function newLogin() {
	location.reload();
}

// ---------- pause / resume ----------

function pause() {
	var vc = getStorageValue("activeVoucher");
	setStorageValue("isPaused", "1");
	setStorageValue(vc + "remain", $("#remainTime").html());
	// Freeze any auto-reload while pausing, then render paused instantly.
	insertingCoin = true;
	render("paused");
	// End the router session in the background without navigating, so no
	// reload can win the race and bounce the client back to status.
	try {
		fetch(document.logout.action, { method: "GET", cache: "no-store" })
			.catch(function () { document.logout.submit(); });
	} catch (e) { document.logout.submit(); }
}

function resume() {
	var vc = getStorageValue("activeVoucher") || voucher;
	removeStorageValue("isPaused");
	insertingCoin = false;
	removeStorageValue("activeVoucher");
	removeStorageValue("ignoreSaveCode");
	if (vc) { removeStorageValue(vc + "remain"); }
	if (!vc) { location.reload(); return; }
	// Re-login directly: no reload, no login-page flash.
	voucher = vc;
	setStorageValue("activeVoucher", vc);
	$('#voucherInput').val(vc);
	doLogin();
}

function notifyCoinSlotError(errorCode) {
	$.toast({ title: 'Error', content: errorCodeMap[errorCode], type: 'error', delay: 5000 });
}

function notifyCoinSuccess(coin) {
	$.toast({ title: 'Coin inserted', content: coin + ' peso(s) was inserted', type: 'success', delay: 2000 });
	coinBlip();
}

function secondsToDhms(seconds) {
	seconds = Number(seconds);
	var d = Math.floor(seconds / (3600 * 24));
	var h = Math.floor(seconds % (3600 * 24) / 3600);
	var m = Math.floor(seconds % 3600 / 60);
	var s = Math.floor(seconds % 60);
	var dDisplay = d > 0 ? d + (d == 1 ? " Day " : " Days ") : "";
	var hDisplay = h > 0 ? h + (h == 1 ? "" : "") : "0";
	var mDisplay = m > 0 ? m + (m == 1 ? "" : "") : "0";
	var sDisplay = s > 0 ? s + (s == 1 ? "" : "") : "0";
	return dDisplay + " " + hDisplay + "h : " + mDisplay + "m : " + sDisplay + "s";
}
