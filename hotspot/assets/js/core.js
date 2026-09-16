// JuanFiV2 portal core — one-page app shared by login.html / status.html / logout.html.
// Each page sets PAGE ("login"|"status"|"logout") plus its MikroTik vars
// (mac, uIp, hotspotAddress, interfaceName, loginError) before this loads,
// then calls boot() on document ready. Boot shows a loading screen, preloads
// promo rates + session data, then reveals the page.

var errorCodeMap = {
	'coins.wait.expired': 'Coin slot expired',
	'coin.not.inserted': 'Coin not inserted',
	'coin.is.reading': 'Verifying coin, please wait..',
	'coinslot.cancelled': 'Coinslot was cancelled',
	'coinslot.busy': 'Coin slot is busy',
	'coin.slot.banned': 'You have been banned from using coin slot, due to multiple request for insert coin, please try again later!',
	'coin.slot.notavailable': 'Coin slot is not available as of the moment, Please try again later',
	'no.internet.detected': 'No internet connection as of the moment, Please try again later',
	'invalid.voucher': 'Invalid voucher code',
	'invalid.request': 'Invalid request, please try again'
};

// ---------- console debug log (F12 console only, nothing injected into body) ----------
var __dbgLines = [];
function __dbgTime() {
	try { return new Date().toLocaleTimeString(); } catch (e) { return ""; }
}
function dbgLog(msg, cls) {
	var line = "[" + __dbgTime() + "] " + String(msg == null ? "" : msg);
	__dbgLines.push(line);
	if (__dbgLines.length > 80) { __dbgLines = __dbgLines.slice(-80); }
	try {
		if (cls == "dbg-err") { console.error(line); }
		else { console.log(line); }
	} catch (e) { }
}
function dbgAjaxErr(tag, xhr, status, err) {
	var detail = status || "error";
	try {
		if (xhr) {
			if (xhr.status) { detail += " http=" + xhr.status; }
			var t = xhr.responseText || (err && err.toString && err.toString()) || "";
			t = String(t).slice(0, 200);
			if (t) { detail += " " + t; }
		}
	} catch (e) { }
	dbgLog(tag + " FAILED: " + detail, "dbg-err");
}
function clearDebugLog() {
	__dbgLines = [];
	try { console.clear(); } catch (e) { }
	dbgLog("debug cleared");
}
function copyDebugLog() {
	var txt = __dbgLines.join("\n");
	try {
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(txt);
			console.log("debug log copied (" + __dbgLines.length + " lines)");
		} else {
			console.log(txt);
		}
	} catch (e) { try { console.log(txt); } catch (e2) { } }
	return txt;
}

var voucher = (function(){ try { var k = scopedKey('activeVoucher'); var v = getStorageValue(k); if (v != null) return v; // migrate bare key once
	var bare = getStorageValue('activeVoucher'); if (bare != null && bare !== "") { setStorageValue(k, bare); removeStorageValue('activeVoucher'); return bare; } return ""; } catch(e){ return ""; } })();
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

// Venue-scoped voucher storage — same browser visiting two neighbouring
// vendos at 10.0.0.1 would otherwise share one localStorage key and a
// neighbour's 1FI code would auto-fill here. Scope by venueId (unique
// per site) falling back to vendorIp.
function venueScopeSuffix() {
	var v = "";
	try {
		if (typeof venueId !== 'undefined' && venueId) v = venueId;
		else if (typeof vendorIpAddress !== 'undefined' && vendorIpAddress) v = vendorIpAddress;
		else if (typeof hotspotAddress !== 'undefined' && hotspotAddress) v = hotspotAddress;
	} catch (e) { }
	return String(v).replace(/[^A-Za-z0-9]/g, "_");
}
function scopedKey(base) {
	var s = venueScopeSuffix();
	return s ? base + "_" + s : base;
}
function getActiveVoucher() {
	var v = getStorageValue(scopedKey('activeVoucher'));
	// Expire stale codes (neighbour leak or old purchase) after 7 days
	try {
		var ts = getStorageValue(scopedKey('activeVoucher_ts'));
		if (v && ts && (Date.now() - parseInt(ts,10) > 7*24*60*60*1000)) { removeActiveVoucher(); removeStorageValue(scopedKey('activeVoucher_ts')); return ""; }
	} catch(e){}
	return v;
}
function setActiveVoucher(v) {
	try { setStorageValue(scopedKey('activeVoucher_ts'), String(Date.now())); } catch(e){}
	return setStorageValue(scopedKey('activeVoucher'), v);
}
function removeActiveVoucher() { try { removeStorageValue(scopedKey('activeVoucher_ts')); } catch(e){} return removeStorageValue(scopedKey('activeVoucher')); }
function getPausedFlag() { return getStorageValue(scopedKey('isPaused')); }
function setPausedFlag() { return setStorageValue(scopedKey('isPaused'), "1"); }
function removePausedFlag() { return removeStorageValue(scopedKey('isPaused')); }
function getReLoginFlag() { return getStorageValue(scopedKey('reLogin')); }
function setReLoginFlag() { return setStorageValue(scopedKey('reLogin'), "1"); }
function removeReLoginFlag() { return removeStorageValue(scopedKey('reLogin')); }

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
	// The countdown was sized while hidden (zero widths, so the shrink loop
	// never ran) — refit now that measurements are real, or first paint
	// overflows small screens until the next 1s tick fixes it.
	try {
		__fitCache = {};
		fitCountdown("#remainTime");
		fitCountdown("#pauseRemainTime");
	} catch (e) { }
}

// Boot progress: wrap a step's promise so the loader line reads
// "Label... 0.4s ...done" on success or "Label... 0.4s ...fail" when the
// data behind it didn't load. Steps run in parallel, last one to settle
// owns the line — each result is still visible as it lands.
function __stepSecs(t0) {
	try { return (((new Date()).getTime() - t0) / 1000).toFixed(1) + "s"; }
	catch (e) { return ""; }
}
function timedStep(label, promise) {
	var t0 = (new Date()).getTime();
	setBootText(label + "...");
	if (!promise || typeof promise.always !== "function") { return promise; }
	promise.always(function () {
		var ok = true;
		try { ok = (typeof promise.state === "function") ? promise.state() == "resolved" : true; }
		catch (e) { }
		setBootText(label + "... " + __stepSecs(t0) + (ok ? " ...done" : " ...fail"));
	});
	return promise;
}

function boot() {
	// Re-login after an extend that outlived its session (set by autoLoginAfterCoin).
	// Runs here — not in the shell — because doLogin only exists after injection.
	if (getReLoginFlag() == '1') {
		removeReLoginFlag();
		// A logout/reload wipes the page but not storage: restore the
		// voucher into the input or doLogin has nothing to submit.
		var sv = getActiveVoucher();
		if (sv && !$("#voucherInput").val()) { $("#voucherInput").val(sv); }
		doLogin();
		return;
	}
	// One-way storage migration: stale flags from older portal builds used to
	// wedge pause/cancel/auto-login (clearing browser data fixed it by hand).
	try {
		if (getStorageValue("portalBuild") !== "r5") {
			var wipeKeys = ["activeVoucher", "isPaused", "forceLogout",
				"redirectLogin", "ignoreSaveCode", "insertCoinRefreshed",
				"totalCoinReceived", "reLogin", "selectedVendo"];
			for (var w = 0; w < wipeKeys.length; w++) { eraseCookie(wipeKeys[w]); }
			if (typeof localStorage !== 'undefined' && localStorage != null) { localStorage.clear(); }
			setStorageValue("portalBuild", "r5");
			voucher = "";
		}
	} catch (e) { }
	$("#footYear").html(new Date().getFullYear());
	applyFlags();
	try { dbgLog("boot page=" + (typeof PAGE !== 'undefined' ? PAGE : "?") + " vendo=" + (typeof vendorIpAddress !== 'undefined' ? vendorIpAddress : "?") + " mac=" + (typeof mac !== 'undefined' ? mac : "?")); } catch (e) { }
	// Re-scope voucher after vendorIp is resolved (multi-vendo selects it)
	try {
		var scopedV = getActiveVoucher();
		if (scopedV != null && scopedV !== voucher) { voucher = scopedV; }
	} catch(e){}
	if (voucher != "" && $("#voucherInput").length > 0) {
		$('#voucherInput').val(voucher);
	}
	// Failsafe: never trap the customer behind the loader (dead vendo, no net).
	// Says so honestly instead of pretending everything is ready.
	setTimeout(function () {
		setBootText("Taking longer than usual — showing what loaded so far.");
		hideBoot();
	}, 9000);

	var bootT0 = (new Date()).getTime();
	timedStep("Detecting session", detectState()).done(function (state) {
		render(state);
		var jobs = [timedStep("Loading promo rates", loadRates())];
		if (state == "login") {
			jobs.push(timedStep("Checking session", resumeSession()));
		} else {
			jobs.push(timedStep("Loading session", showValidity()));
		}
		// jQuery promises settle fail or success — either way reveal the portal.
		$.when.apply($, jobs).always(function () {
			setBootText("Ready (" + __stepSecs(bootT0) + ")");
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
	if (getPausedFlag() == "1") {
		removePausedFlag();
	}
	$.ajax({ type: "GET", url: "/status", timeout: 3000 }).done(function (data) {
		var html = String(data);
		if (html.indexOf("IAMNOTLOGINSTRINGPLEASEDONTREMOVE") >= 0) {
			d.resolve("login");
		} else {
			// Logged in: lift live session facts out of the status page itself.
			var m = html.match(/(?:var|window\.)currentVoucher\s*=\s*"([^"]*)"/);
			if (m) {
				window.currentVoucher = m[1];
				voucher = m[1];
				setActiveVoucher( m[1]);
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
		$("#statusVoucher").text(voucher);
		startCountdown();
		previewUrgencyHook();
	}
	if (state == "paused") {
		$("#pausedVoucher").text(voucher);
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
// Skip refits when the text hasn't changed: the 1s countdown tick would
// otherwise force a full shrink-loop reflow every second on every phone.
var __fitCache = {};
function fitCountdown(sel) {
	var el = $(sel);
	if (el.length == 0) { return; }
	var node = el.get(0);
	if (__fitCache[sel] === node.textContent) { return; }
	if (!window.__countdownFitBound) {
		window.__countdownFitBound = true;
		$(window).on("resize orientationchange", function () {
			__fitCache = {};
			fitCountdown("#remainTime");
			fitCountdown("#pauseRemainTime");
		});
	}
	el.css("font-size", "");
	var size = parseFloat(el.css("font-size")) || 30;
	var guard = 0;
	while (size > 20 && node.scrollWidth > node.clientWidth + 1 && guard < 20) {
		size -= 1;
		el.css("font-size", size + "px");
		guard++;
	}
	__fitCache[sel] = node.textContent;
}

function startCountdown() {
	if ($("#remainTime").length == 0 || window.sessiontime == null) { return; }
	var time = window.sessiontime;
	if (time == "0" || time == "") {
		$("#remainTime").html("Unlimited");
		return;
	}
	time = parseInt(time);
	var total = time;
	var warned5 = false, warned1 = false;
	$("#remainTime").html(compactDhms(time));
	paintCountdownUrgency(time);
	fitCountdown("#remainTime");
	if (window.remainingTimer != null) { clearInterval(window.remainingTimer); }
	window.remainingTimer = setInterval(function () {
		time--;
		$("#remainTime").html(compactDhms(time));
		paintCountdownUrgency(time);
		fitCountdown("#remainTime");
		// One-shot low-time notices (in-page: no permission needed, works
		// over plain HTTP). Skipped when the whole session is shorter than
		// the threshold so the message is never wrong.
		if (!warned5 && total > 300 && time <= 300) {
			warned5 = true;
			$.toast({ title: 'Running low', content: '5 minutes remaining — tap EXTEND TIME to add more', type: 'warning', delay: 5000 });
		}
		if (!warned1 && total > 60 && time <= 60) {
			warned1 = true;
			$.toast({ title: 'Almost out', content: '1 minute remaining! Tap EXTEND TIME now or you will be logged out', type: 'warning', delay: 8000 });
			try {
				sfxTone(880, 120, "square", 0.14);
				sfxTone(880, 120, "square", 0.14, 200);
			} catch (e) { }
		}
		if (time <= 0) {
			$.toast({ title: 'Success', content: 'Time limit exceeded, Thank you for the purchase, will be logout shortly', type: 'success', delay: 5000 });
			clearInterval(window.remainingTimer);
			setTimeout(function () { document.logout.submit(); }, 6000);
		}
	}, 1000);
}

// Preview hook, visual only (no timer/logout effect): ?urgency=warn|low
// forces the countdown color so the thresholds can be checked without
// waiting for a session to run down. Same spirit as the ?state= hook.
function previewUrgencyHook() {
	try {
		var m = new RegExp("[?&]urgency=(warn|low)").exec(location.search || "");
		if (m) {
			$("#remainTime").removeClass("time-warn time-low")
				.addClass(m[1] == "low" ? "time-low" : "time-warn");
		}
	} catch (e) { }
}

// Session countdown urgency: amber under 5 min, pulsing red under 1 min,
// so the logout at zero never comes as a surprise. Unlimited plans skip it.
function paintCountdownUrgency(time) {
	var el = $("#remainTime");
	if (el.length == 0) { return; }
	el.removeClass("time-warn time-low");
	if (time <= 60) { el.addClass("time-low"); }
	else if (time <= 300) { el.addClass("time-warn"); }
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

	// Branding from config.js — keep portal.html generic
	try {
		if (typeof brandHeaderHtml !== 'undefined' && brandHeaderHtml) {
			$("#brandHeader").html(brandHeaderHtml);
			var plain = brandHeaderHtml.replace(/<[^>]*>/g, "");
			$("#bootBrand").text(plain);
			document.title = plain + " Portal";
		}
		if (typeof footerBrandText !== 'undefined' && footerBrandText) $("#footerBrand").text(footerBrandText);
		if (typeof footerSubText !== 'undefined' && footerSubText) $("#footerSub").text(footerSubText);
	} catch(e) {}
}

// ---------- focused blocks: one action on screen at a time (no modals) ----------

// Collapse/expand a section body; headers with class "toggle" call this.
function toggleBlock(id) {
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
	$("#voucherBlock").attr("style", "");
	$("#memberSection").attr("style", "");
}

function cancelCoin() {
	clearInterval(timer);
	timer = null;
	insertingCoin = false;
	sfxStopLoop();
	if (currentTopUpXhr) { try { currentTopUpXhr.abort(); } catch(e){} currentTopUpXhr = null; }
	if (currentCheckCoinXhr) { try { currentCheckCoinXhr.abort(); } catch(e){} currentCheckCoinXhr = null; }
	$("#loaderDiv").attr("class", "spinner hidden");
	if (totalCoinReceived == 0) {
		$.ajax({
			type: "POST",
			url: "http://" + vendorIpAddress + "/cancelTopUp",
			timeout: 5000,
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
	// boot() already queues showValidity() as a job after render(); only
	// refresh here for later transitions (cancel/pause/resume) so the boot
	// path doesn't fire the same /data/*.txt GET twice.
	if (bootDone && (s == "status" || s == "paused") && $("#expirationTime").html() == "") {
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
	$("#ratesBody").html("<p>Loading promo rates…</p>");
	return $.ajax({
		type: "GET",
		url: "http://" + vendorIpAddress + "/getRates?date=" + (new Date().getTime()),
		timeout: 5000
	}).done(function (data) {
		try { dbgLog("getRates ok (" + String(data).length + " chars): " + String(data).slice(0, 120), "dbg-ok"); } catch (e) { }
		var rows = String(data).split("|");
		var usable = 0;
		for (var r = 0; r < rows.length; r++) {
			if (rows[r] == "") { continue; }
			var c = rows[r].split("#");
			if (c.length >= 4 && String(c[0]).trim() != "") { usable++; }
		}
		if (usable == 0) {
			$("#ratesBody").html("<p>No promo rates configured on this vendo yet.</p>");
			return;
		}
		var html = "<div class='table-responsive'><table class='table table-striped'>";
		html += "<thead><tr><th>Rate</th><th>Time</th><th>Validity</th>";
		html += "</tr></thead><tbody>";
		for (var r = 0; r < rows.length; r++) {
			if (rows[r] == "") { continue; }
			var c = rows[r].split("#");
			if (c.length < 4 || String(c[0]).trim() == "") { continue; }
			html += "<tr><td>" + escHtml(c[0]) + "</td>";
			html += "<td>" + humanDuration(c[2]) + "</td>";
			html += "<td>" + humanDuration(c[3]) + "</td>";
			html += "</tr>";
		}
		html += "</tbody></table></div>";
		$("#ratesBody").html(html);
	}).fail(function (xhr, status, err) {
		$("#ratesBody").html("<p>Rates unavailable — ESP unreachable. Check that the ESP is powered on.</p>");
		dbgAjaxErr("getRates", xhr, status, err);
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
		removePausedFlag();
		removeActiveVoucher();
		voucher = "";
		$.toast({ title: 'Error', content: "Invalid voucher, please make sure voucher is valid", type: 'error', delay: 5000 });
		d.resolve();
		return d.promise();
	}
	var isPaused = getPausedFlag();
	if (isPaused == "1") {
		$("#pauseRemainTime").html(getStorageValue(voucher + "remain"));
		fitCountdown("#pauseRemainTime");
	}
	var ignoreSaveCode = getStorageValue("ignoreSaveCode") || "0";
	var insertCoinTrigger = getStorageValue("insertCoinRefreshed");
	if (ignoreSaveCode != "1" && insertCoinTrigger != "1" && $("#voucherInput").length > 0) {
		$.ajax({ type: "GET", url: "/data/" + macNoColon() + ".txt?query=" + new Date().getTime(), timeout: 3000 })
			.done(function (data) {
				var parts = String(data).split("#");
				var fileVoucher = (parts[0] || "").trim();
				var validUntil = parts.length > 1 ? parseValidity(parts[1]) : null;
				// Stale session file (empty or expired voucher): never
				// auto-connect it, or a dead test code keeps logging
				// itself in on every visit to the login page.
				if (fileVoucher == "" || (validUntil != null && validUntil.getTime() < new Date().getTime())) {
					removeActiveVoucher();
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
	$.ajax({ type: "GET", url: "/data/" + macNoColon() + ".txt?query=" + new Date().getTime(), timeout: 3000 })
		.done(function (data) {
			if (String(data).length > 50) {
				if (fallbackValidity()) { d.resolve(); } else { d.reject(); }
				return;
			}
			var t = parseValidity(String(data).split("#")[1]);
			if (t == null) {
				renderExpiration("No Expiration");
				d.resolve();
				return;
			}
			renderExpiration(t.toLocaleString());
			d.resolve();
		})
		.fail(function () { if (fallbackValidity()) { d.resolve(); } else { d.reject(); } });
	return d.promise();
}

// Returns true when some expiry could be shown, false when nothing loaded.
function fallbackValidity() {
	var validity = getStorageValue(voucher + "validity");
	if (validity != null) {
		var t = new Date(parseInt(validity));
		if (t.getTime() < new Date().getTime()) {
			removeStorageValue(voucher + "validity");
			removeStorageValue(voucher + "tempValidity");
			renderExpiration("Not Available");
			return false;
		}
		renderExpiration(t.toLocaleString());
		return true;
	}
	renderExpiration("Not Available");
	return false;
}

// ---------- coin flow ----------

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
			timeout: 3000,
			success: function (data) {
				if (data.indexOf("IAMNOTLOGINSTRINGPLEASEDONTREMOVE") < 0) {
					location.reload();
				} else {
					callTopupAPI(0);
				}
			},
			error: function () { callTopupAPI(0); }
		});
	} else {
		callTopupAPI(0);
	}
	return false;
}

function callTopupAPI(retryCount) {
	$('#cncl').html("Cancel");
	var isExtend = $("#saveVoucherButton").attr('data-save-type') == "extend";

	if (retryCount === 0 && !isExtend && totalCoinReceived == 0) {
		var storedVoucher = getActiveVoucher();
		if (storedVoucher != null) {
			voucher = "";
			$("#voucherInput").val('');
			removeActiveVoucher();
		}
	}

	if (currentTopUpXhr) { try { currentTopUpXhr.abort(); } catch(e){} }
	currentTopUpXhr = $.ajax({
		type: "POST",
		url: "http://" + vendorIpAddress + "/topUp",
		timeout: 5000,
		data: "voucher=" + voucher + "&mac=" + mac + "&extendTime=" + (isExtend ? "1" : "0"),
		complete: function(){ currentTopUpXhr = null; },
		success: function (data) {
			$("#loaderDiv").attr("class", "spinner hidden");
			try { dbgLog("topUp ok voucher=" + (data && data.voucher ? data.voucher : "?"), "dbg-ok"); } catch (e) { }
			if (data.status == "true") {
				voucher = data.voucher;
				setActiveVoucher(voucher);
				showCoinPanel();
				insertingCoin = true;
				$('#codeGenerated').text(voucher);
				if (timer == null) {
					timer = setInterval(checkCoin, 1000);
				}
				if (isMultiVendo) {
					$("#coinPanelTitle").html("Please insert the coin on " + $("#vendoSelected option:selected").text());
				}
				sfxStartLoop();
			} else {
				try { dbgLog("topUp rejected errorCode=" + data.errorCode, "dbg-err"); } catch (e) { }
				notifyCoinSlotError(data.errorCode);
				clearInterval(timer);
				timer = null;
				insertingCoin = false;
			}
		}, error: function (xhr, status, err) {
			// ESP dead / timeout: retry quickly, then show unreachable error
			if (status === "timeout") { console.log("topUp timeout, retry " + retryCount); }
			dbgAjaxErr("topUp retry=" + retryCount, xhr, status, err);
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
	setActiveVoucher( voucher);
	removeStorageValue("totalCoinReceived");
	$('#voucherInput').val(voucher);

	clearInterval(timer);
	timer = null;
	sfxStopLoop();
	$.ajax({
		type: "POST",
		url: "http://" + vendorIpAddress + "/useVoucher",
		timeout: 5000,
		data: "voucher=" + voucher,
		success: function (data) {
			totalCoinReceived = 0;
			insertingCoin = false;
			$("#loaderDiv").attr("class", "spinner hidden");
			try { dbgLog("useVoucher resp " + JSON.stringify(data).slice(0, 200), (data && data.status == "true") ? "dbg-ok" : "dbg-err"); } catch (e) { }
		if (data.status == "true") {
			setStorageValue(voucher + "tempValidity", data.validity);
			$.toast({ title: 'Success', content: 'Thank you for the purchase!, will do auto login shortly', type: 'success', delay: 3000 });
			autoLoginAfterUseVoucher();
		} else if (data.errorCode == "coinslot.busy" && totalCoinReceived > 0) {
			// Lost the race with the ESP wait-expiry: the vendo already
			// registered the voucher and added the time itself (then cleared
			// its session, hence "busy"). The purchase is safe — tempValidity
			// was stored by the checkCoin polls — so log in normally.
			$.toast({ title: 'Success', content: 'Thank you for the purchase!, will do auto login shortly', type: 'success', delay: 3000 });
			autoLoginAfterUseVoucher();
		} else {
			notifyCoinSlotError(data.errorCode);
		}
		}, error: function (jqXHR, status, err) {
			$("#loaderDiv").attr("class", "spinner hidden");
			dbgAjaxErr("useVoucher", jqXHR, status, err);
			if (status === "timeout") {
				$.toast({ title: 'Error', content: 'ESP unreachable — check that the vendo is powered on and WiFi connected', type: 'error', delay: 5000 });
			} else if (totalCoinReceived > 0) {
				$.toast({ title: 'Warning', content: 'Connect/Login failed, however coin has been process, please manually connect using this voucher: ' + voucher, type: 'info', delay: 8000 });
			}
		}
	});
}

function autoLoginAfterUseVoucher() {
	if ($("#saveVoucherButton").attr('data-save-type') == "extend") {
		// A reload alone keeps the same router session, whose
		// time-left never picks up the extended limit. End the
		// session like pause/resume does; boot auto-logs back
		// in with the extended voucher for a fresh countdown.
		setReLoginFlag();
		setTimeout(function () {
			try { document.logout.submit(); }
			catch (e) { location.reload(); }
		}, 3000);
	} else {
		// Fresh purchase on login page: auto-login with the new voucher
		// so the customer never has to click CONNECT manually.
		setTimeout(function () {
			try { doLogin(); } catch (e) { newLogin(); }
		}, 3000);
	}
}

var checkCoinFailStreak = 0;
var currentTopUpXhr = null;
var currentCheckCoinXhr = null;
function checkCoin() {
	// Skip the tick while a poll is still in flight — aborting it can kill
	// the very response carrying status:true/newCoin (ESP is single-threaded
	// and slow under telnet), which looked like "error, retry shows coins".
	if (currentCheckCoinXhr) { return; }
	currentCheckCoinXhr = $.ajax({
		type: "POST",
		url: "http://" + vendorIpAddress + "/checkCoin",
		timeout: 5000,
		data: "voucher=" + voucher,
		success: function (data) {
			checkCoinFailStreak = 0;
			$("#noticeDiv").attr('style', 'display: none');
			if (data.status == "true") {
			try { dbgLog("checkCoin COIN +" + data.newCoin + " total=" + data.totalCoin + " timeAdded=" + data.timeAdded + "s", "dbg-ok"); } catch (e) { }
			totalCoinReceived = parseInt(data.totalCoin);
			$('#totalCoin').html(data.totalCoin);
			$('#totalTime').html(secondsToDhms(parseInt(data.timeAdded)));
			$('#voucherInput').val(voucher);
				setActiveVoucher( voucher);
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
				$('#voucherInput').val(voucher);
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
			} else if (data.errorCode == "coin.is.reading") {
				// Transient: coin pulse is being verified on the ESP.
				// Keep polling — killing the timer here is what forced a
				// re-tap to reveal already-latched coins.
				$("#noticeDiv").attr('style', 'display: block');
				$("#noticeText").html("Verifying, please wait..");
			} else {
				try { dbgLog("checkCoin end errorCode=" + data.errorCode, "dbg-err"); } catch (e) { }
				notifyCoinSlotError(data.errorCode);
				clearInterval(timer);
				timer = null;
				insertingCoin = false;
			}
		}, error: function (xhr, status, err) {
			if (status === "abort") return;
			checkCoinFailStreak++;
			console.log('checkCoin error (' + status + '), streak ' + checkCoinFailStreak);
			dbgAjaxErr("checkCoin streak=" + checkCoinFailStreak, xhr, status, err);
			if (checkCoinFailStreak >= 5) {
				$("#noticeDiv").attr('style', 'display: block');
				$("#noticeText").html("ESP unreachable — check power &amp; WiFi, then tap Cancel to retry.");
			}
		},
		complete: function(){ currentCheckCoinXhr = null; }
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
		setReLoginFlag();
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
	var vc = getActiveVoucher();
	setPausedFlag();
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
	var vc = getActiveVoucher() || voucher;
	removePausedFlag();
	insertingCoin = false;
	removeActiveVoucher();
	removeStorageValue("ignoreSaveCode");
	if (vc) { removeStorageValue(vc + "remain"); }
	if (!vc) { location.reload(); return; }
	// Re-login directly: no reload, no login-page flash.
	voucher = vc;
	setActiveVoucher( vc);
	$('#voucherInput').val(vc);
	doLogin();
}

function notifyCoinSlotError(errorCode) {
	try { dbgLog("portal error: " + (errorCodeMap[errorCode] || ("Request failed (" + errorCode + ")")), "dbg-err"); } catch (e) { }
	$.toast({ title: 'Error', content: errorCodeMap[errorCode] || ('Request failed (' + errorCode + '), please try again'), type: 'error', delay: 5000 });
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
	return dDisplay + " " + h + "h : " + m + "m : " + s + "s";
}
