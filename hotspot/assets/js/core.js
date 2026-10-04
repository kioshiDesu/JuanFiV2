// Each page sets PAGE ("login"|"status") plus its MikroTik vars
// (mac, uIp, hotspotAddress, interfaceName, loginError) before this loads,

var errorCodeMap = {
	'coins.wait.expired': 'Coin slot expired',
	'coin.not.inserted': 'Coin not inserted',
	'coin.is.reading': 'Verifying coin, please wait…',
	'coinslot.cancelled': 'Coinslot was cancelled',
	'coinslot.busy': 'Another purchase is still finishing. Please wait a moment and tap INSERT COIN again',
	'session.expired': 'Coin session expired, tap INSERT COIN to start over',
	'coin.slot.banned': 'You have been banned from using coin slot, due to multiple request for insert coin, please try again later!',
	'coin.slot.notavailable': 'Coin slot is not available as of the moment, Please try again later',
	'no.internet.detected': 'No internet connection as of the moment, Please try again later',
	'invalid.voucher': 'Invalid voucher code',
	'invalid.request': 'Invalid request, please try again',
	'convertVoucher.empty': 'Enter the voucher code you want to add',
	'convertVoucher.nosession': 'Tap INSERT COIN first, then add the other code',
	'convertVoucher.refused': 'This code cannot be added to your session',
	'convertVoucher.unsupported': 'This coin box cannot add time from another code'
};

// ---------- settings (config.js folded in) ----------
// Single source of truth is settings.json; below are offline fallbacks
// used when the JSON fetch fails. Same key names (currency→currencySym).
var isMultiVendo = false;
var multiVendoOption = 0;
var multiVendoAddresses = [
	{ vendoName: "Vendo 1", vendoIp: "10.0.0.254", hotspotAddress: "10.0.0.1", interfaceName: "vlan1" }
];
var vendorIpAddress = "10.0.0.254";
var portalDebug = false;
var brandHeaderHtml = "JUANFI<em>V2</em>";
var footerBrandText = "@NETBRO";
var footerSubText = "INTERNET SERVICES";
// Footer link to the operator's page. The URL defaults to empty, which keeps
// the pill hidden until settings.json names one - a router that was never
// configured shows no dead link. Only http(s) is honoured; see
// renderFooterSocial() for why the scheme is checked.
var footerSocialUrl = "";
var footerSocialLabel = "Facebook";
var footerSocialIcon = "facebook";
var currencySym = "₱";
var showMemberSection = true;
var showTrialLogin = false;
var showInternetStatus = true;
var offlineText = "No internet connection as of the moment, please try again later";
var trialNoExtend = true;
// Send the client's own MAC as the voucher code. The coin box only mints
// a random code when the topUp POST carries an empty voucher, so a
// filled-in MAC makes it register that MAC as the hotspot user. The
// namespace becomes 48 bits instead of 8,999 codes. Typeable codes are
// not lost - the input stays editable and doLogin reads it first.
var macAsVoucherCode = false;
// Add time from a second voucher without inserting coins. The coin box
// does the merge itself and only answers on builds that expose
// /convertVoucher, so this is opt-out per site.
var showConvertVoucher = true;
	try {
		var __setReq = new XMLHttpRequest();
		__setReq.open("GET", "/settings.json?t=" + new Date().getTime(), false);
		try { __setReq.send(null); } catch (e) { __setReq = null; }
		if ((!__setReq || __setReq.status !== 200)) {
			try {
				__setReq = new XMLHttpRequest();
				__setReq.open("GET", "settings.json?t=" + new Date().getTime(), false);
				__setReq.send(null);
			} catch (e2) { __setReq = null; }
		}
		if (__setReq && __setReq.status === 200) {
		var __setJson = JSON.parse(__setReq.responseText || "{}");
		if (typeof __setJson.isMultiVendo === "boolean") { isMultiVendo = __setJson.isMultiVendo; }
		if (typeof __setJson.multiVendoOption === "number") { multiVendoOption = __setJson.multiVendoOption; }
		if (__setJson.multiVendoAddresses instanceof Array) { multiVendoAddresses = __setJson.multiVendoAddresses; }
		if (typeof __setJson.vendorIpAddress === "string" && __setJson.vendorIpAddress) { vendorIpAddress = __setJson.vendorIpAddress; }
		if (typeof __setJson.portalDebug === "boolean") { portalDebug = __setJson.portalDebug; }
		if (typeof __setJson.brandHeaderHtml === "string" && __setJson.brandHeaderHtml) { brandHeaderHtml = __setJson.brandHeaderHtml; }
		// Blank is honoured here, unlike every other string below: an operator who
		// sets footerBrandText to "" wants the big footer wordmark gone (the brand
		// then lives in the social pill), not the hardcoded fallback text.
		if (typeof __setJson.footerBrandText === "string") { footerBrandText = __setJson.footerBrandText; }
		if (typeof __setJson.footerSubText === "string" && __setJson.footerSubText) { footerSubText = __setJson.footerSubText; }
		if (typeof __setJson.footerSocialUrl === "string" && __setJson.footerSocialUrl) { footerSocialUrl = __setJson.footerSocialUrl; }
		if (typeof __setJson.footerSocialLabel === "string" && __setJson.footerSocialLabel) { footerSocialLabel = __setJson.footerSocialLabel; }
		if (typeof __setJson.footerSocialIcon === "string" && __setJson.footerSocialIcon) { footerSocialIcon = __setJson.footerSocialIcon; }
		if (typeof __setJson.currency === "string" && __setJson.currency) { currencySym = __setJson.currency; }
		if (typeof __setJson.showMemberSection === "boolean") { showMemberSection = __setJson.showMemberSection; }
		if (typeof __setJson.showTrialLogin === "boolean") { showTrialLogin = __setJson.showTrialLogin; }
		if (typeof __setJson.showInternetStatus === "boolean") { showInternetStatus = __setJson.showInternetStatus; }
		if (typeof __setJson.offlineText === "string" && __setJson.offlineText) { offlineText = __setJson.offlineText; }
		if (typeof __setJson.trialNoExtend === "boolean") { trialNoExtend = __setJson.trialNoExtend; }
		if (typeof __setJson.macAsVoucherCode === "boolean") { macAsVoucherCode = __setJson.macAsVoucherCode; }
		if (typeof __setJson.showConvertVoucher === "boolean") { showConvertVoucher = __setJson.showConvertVoucher; }
	}
} catch (e) {}

var ROUTER_TIMEOUT = 3000;
var VENDO_TIMEOUT = 5000;

// ---------- console debug log (nothing injected into body) ----------
var __dbgLines = [];
function __dbgTime() {
	try { return new Date().toLocaleTimeString(); } catch (e) { return ""; }
}
function dbgOn() {
	try { return typeof portalDebug !== 'undefined' && !!portalDebug; } catch (e) { return false; }
}
function dbgLog(msg, cls) {
	var line = "[" + __dbgTime() + "] " + String(msg == null ? "" : msg);
	__dbgLines.push(line);
	if (__dbgLines.length > 150) { __dbgLines = __dbgLines.slice(-150); }
	if (!dbgOn()) { return; }
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

var voucher = (function(){ try { var k = scopedKey('activeVoucher'); var v = getStorageValue(k); if (v != null) return v; // migrate bare key once
	var bare = getStorageValue('activeVoucher'); if (bare != null && bare !== "") { setActiveVoucher(bare); removeStorageValue('activeVoucher'); return bare; } return ""; } catch(e){ return ""; } })();
if (voucher == null) { voucher = ""; }
var STATE = (typeof PAGE !== 'undefined') ? PAGE : 'login';
var insertingCoin = false;
var totalCoinReceived = 0;
var timer = null;
var bootDone = false;
// Pending auto-login: queued by resumeSession/reLogin, drained by hideBoot
var AUTO_LOGIN_DWELL_MS = 1000;
window.__pendingAutoLogin = null;
function queueAutoLogin(fn) {
	window.__pendingAutoLogin = fn;
	try { if (typeof bootDone !== "undefined" && bootDone) { drainAutoLogin(); } } catch (e) {}
}
function drainAutoLogin() {
	var fn = window.__pendingAutoLogin;
	window.__pendingAutoLogin = null;
	if (fn) { setTimeout(function () { try { fn(); } catch (e) {} }, AUTO_LOGIN_DWELL_MS); }
}
// Per-site scope from the router-published site ID (data/site-id.txt, written
var siteIdSuffix = "";

function sfxVibrate(pattern) {
	try { if (navigator.vibrate) { navigator.vibrate(pattern); } } catch (e) { }
}
// iOS Safari only lets audio through when play() runs inside a real tap.
// Every sound here fires from an XHR callback (topUp success, coin poll,
// countdown tick), which is outside the gesture, so play() rejected with
// NotAllowedError and sfxPlayFile swallowed it: the customer got a completely
// silent portal on iPhone while Android played every blip.
//
// The fix is to spend the gesture on the tap that STARTS the flow, priming
// both an AudioContext (which is what iOS actually gates) and each Audio
// element. A silent one-frame buffer through the context, plus a muted
// play()/pause() on the looping bed, and every later play() is already
// unlocked. Once, on the first gesture — cost is zero after that.
var sfxUnlocked = false;
function sfxUnlock() {
	if (sfxUnlocked) { return; }
	sfxUnlocked = true;
	try {
		var AC = window.AudioContext || window.webkitAudioContext;
		if (AC) {
			var ctx = new AC();
			// One frame of silence: enough to open the audio session without
			// making a sound. resume() is for the case where iOS created the
			// context already suspended.
			var buf = ctx.createBuffer(1, 1, 22050);
			var srcNode = ctx.createBufferSource();
			srcNode.buffer = buf;
			srcNode.connect(ctx.destination);
			srcNode.start(0);
			if (ctx.state === "suspended" && ctx.resume) { ctx.resume(); }
		}
	} catch (e) { }
	// Prime the loop bed itself. It is the element that plays on INSERT COIN,
	// and iOS unlocks per-element, so the one-shots still need their own
	// gesture-time play(). Muted + zero volume keeps this inaudible.
	var SRC = {
		insert: snd("assets/sounds/insertcoinbg.mp3"),
		inserted: snd("assets/sounds/insertedcoin.mp3"),
		success: snd("assets/sounds/success.mp3"),
		error: snd("assets/sounds/error.mp3")
	};
	// One element per call, held as a PARAMETER. It used to be a `var` inside
	// the loop below, which is function-scoped: all four play() callbacks shared
	// one binding, so every reset() un-paused and un-muted the LAST element and
	// left insert/inserted/success pinned at volume 0 for the rest of the
	// session. That is what made the portal silent everywhere, not just iPhone.
	function primeOne(a) {
		if (!a) { return; }
		// volume 0 rather than muted: iOS treats a muted element as not worth
		// unlocking, and `muted` would also have to be unset again later. Volume
		// is restored before anything audible can play.
		a.volume = 0;
		var reset = function () {
			try { a.pause(); a.currentTime = 0; a.volume = 1; } catch (e) { }
		};
		var p = a.play();
		if (p && typeof p.then === "function") { p.then(reset, reset); }
		else { reset(); }
	}
	for (var k in SRC) {
		try {
			if (!Object.prototype.hasOwnProperty.call(SRC, k)) { continue; }
			if (!sfxAudio[k]) { sfxAudio[k] = new Audio(SRC[k]); }
			primeOne(sfxAudio[k]);
		} catch (e) { }
	}
}
// Capture phase, once. Catches taps anywhere (the coin button, CONNECT, the
// member toggle) without touching every onclick handler, and also catches the
// case where the customer's first interaction is a keyboard Enter on desktop.
(function () {
	if (typeof document === "undefined") { return; }
	var armed = true;
	function firstGesture() {
		if (!armed) { return; }
		armed = false;
		try { sfxUnlock(); } catch (e) { }
		try {
			document.removeEventListener("touchend", firstGesture, true);
			document.removeEventListener("click", firstGesture, true);
			document.removeEventListener("keydown", firstGesture, true);
		} catch (e) { }
	}
	try {
		document.addEventListener("touchend", firstGesture, true);
		document.addEventListener("click", firstGesture, true);
		document.addEventListener("keydown", firstGesture, true);
	} catch (e) { }
})();
// ponytail: the version used to be a hand-kept literal here AND in the script
// tags AND in a vNNN string in the footer, so a partial bump stranded the
// sounds and the footer behind the CSS. core.js is loaded from a URL that
// already carries its own ?v=, so read it from there and use it for both the
// sounds and the displayed build. One place to bump: the <script> tags.
var SOUND_V = (function () {
	try {
		var s = (document.currentScript && document.currentScript.src) || "";
		var m = /(\?v=[\w.\-]+)/.exec(s);
		if (m) { return m[1]; }
	} catch (e) { }
	return "?v=26";
})();
function snd(p) { return p + SOUND_V; }
var sfxAudio = {};
function sfxPlayFile(name, src, loop, fallback) {
	try {
		var a = sfxAudio[name];
		if (!a) {
			a = new Audio(src);
			a.preload = "auto";
			sfxAudio[name] = a;
		}
		// sfxUnlock primes these elements at volume 0 and restores it when the
		// play() promise settles. If that restore is ever lost (an aborted
		// decode, a rejected play that never fires its callback), the sound
		// stays silent forever. Re-assert full volume on the way out so a stuck
		// element cannot mute the portal.
		try { a.volume = 1; } catch (e) {}
		if (loop) {
			a.loop = true;
			var p = a.play();
			if (p && typeof p.catch === "function") {
				p.catch(function () { try { fallback && fallback(); } catch (e) {} });
			}
		} else {
			// Reuse the cached element instead of cloning a fresh Audio per
			// blip (one per coin, countdown warning and error toast).
			var c = a;
			c.loop = false;
			try { c.pause(); c.currentTime = 0; } catch (e) {}
			var p = c.play();
			if (p && typeof p.catch === "function") {
				p.catch(function () { try { fallback && fallback(); } catch (e) {} });
			}
		}
	} catch (e) {
		try { fallback && fallback(); } catch (e2) {}
	}
}
function sfxStartLoop() {
	// No reduced-motion gate here. That preference is about movement, not
	// sound: it was silencing the coin slot for the wrong users while
	// everyone else got an audio loop they never asked for.
	sfxStopLoop();
	sfxPlayFile("insert", snd("assets/sounds/insertcoinbg.mp3"), true, null);
}
// ponytail: this is a metered captive portal, so boot-time bytes are the
// expensive kind. "insert" is the looping bed that plays the moment the
// customer taps INSERT COIN, so it stays eager (2.7 KB). "inserted" and
// "success" are one-shots that only fire after a coin lands — success.mp3
// alone is 26 KB — so they load on first play instead. sfxPlayFile already
// creates-and-caches, so nothing is fetched twice. Saves ~30 KB and two
// parallel requests off the critical path.
function sfxPreload() {
	try {
		if (!sfxAudio["insert"]) { sfxAudio["insert"] = new Audio(snd("assets/sounds/insertcoinbg.mp3")); sfxAudio["insert"].preload = "auto"; }
		if (!sfxAudio["inserted"]) { sfxAudio["inserted"] = new Audio(snd("assets/sounds/insertedcoin.mp3")); sfxAudio["inserted"].preload = "none"; }
		if (!sfxAudio["success"]) { sfxAudio["success"] = new Audio(snd("assets/sounds/success.mp3")); sfxAudio["success"].preload = "none"; }
	} catch (e) {}
}
function coinBlip() {
	sfxPlayFile("inserted", snd("assets/sounds/insertedcoin.mp3"), false, null);
	sfxVibrate(40);
}
function sfxStopLoop() {
	try {
		var a = sfxAudio["insert"];
		if (a) { a.pause(); try { a.currentTime = 0; } catch (e) {} }
	} catch (e) {}
	sfxVibrate(0);
}

(function ($) {
	if (!$ || $.toast) { return; }
	var COLORS = { success: "#067647", error: "#d92d20", info: "#175cd3", warning: "#b7791f" };
	$.toast = function (o) {
		o = o || {};
		var box = document.getElementById("juanfi-toasts");
		if (!box) {
			box = document.createElement("div");
			box.id = "juanfi-toasts";
			box.setAttribute("role", "status");
			box.setAttribute("aria-live", "polite");
			document.body.appendChild(box);
		}
		var el = document.createElement("div");
		el.className = "jtoast";
		if (o.type === "error") { el.setAttribute("role", "alert"); }
		el.style.borderLeftColor = COLORS[o.type] || COLORS.info;
		var b = document.createElement("b");
		b.textContent = o.title || "";
		var s = document.createElement("span");
		s.textContent = o.content || "";
		var x = document.createElement("button");
		x.className = "jclose";
		x.setAttribute("type", "button");
		x.setAttribute("aria-label", "Dismiss");
		x.textContent = "×";
		x.onclick = function () { try { if (el.parentNode) { el.parentNode.removeChild(el); } } catch (e) {} };
		el.appendChild(b);
		el.appendChild(s);
		el.appendChild(x);
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
	// Values encoded: raw vouchers/member names can contain ";" or "=",
	document.cookie = name + "=" + encodeURIComponent(value || "") + expires + "; path=/";
}

function getCookie(name) {
	var nameEQ = name + "=";
	var ca = document.cookie.split(';');
	for (var i = 0; i < ca.length; i++) {
		var c = ca[i];
		while (c.charAt(0) == ' ') c = c.substring(1, c.length);
		if (c.indexOf(nameEQ) == 0) {
			try { return decodeURIComponent(c.substring(nameEQ.length, c.length)); }
			catch (e) { return c.substring(nameEQ.length, c.length); }
		}
	}
	return null;
}

function eraseCookie(name) {
	// Same path setCookie writes, otherwise the delete targets a cookie
	// scoped to the current document and silently leaves the key behind.
	document.cookie = name + '=; Max-Age=-99999999; path=/';
}

// Venue-scoped voucher storage. A browser on two neighbouring vendos,
// or a router with no site id file, would otherwise share one bucket.
function venueScopeSuffix() {
	var v = "";
	try {
		if (typeof siteIdSuffix !== 'undefined' && siteIdSuffix) v = siteIdSuffix;
		else v = "ERROR SITE ID";
	} catch (e) { }
	return String(v).replace(/[^A-Za-z0-9]/g, "_");
}
function scopedKey(base) {
	var s = venueScopeSuffix();
	return s ? base + "_" + s : base;
}
function getActiveVoucher() {
	var v = getStorageValue(scopedKey('activeVoucher'));
	try {
		var ts = getStorageValue(scopedKey('activeVoucher_ts'));
		var age = Date.now() - parseInt(ts, 10);
		if (v && !ts) {
			// A code saved before the timestamp existed (or written while
			// the ts write was failing) would otherwise never age out.
			// Stamp it now so the 7-day cap starts from here.
			setStorageValue(scopedKey('activeVoucher_ts'), String(Date.now()));
		} else if (v && (!isFinite(age) || age > 7*24*60*60*1000)) {
			removeActiveVoucher();
			return "";
		}
	} catch(e){}
	return v;
}
function setActiveVoucher(v) {
	try { setStorageValue(scopedKey('activeVoucher_ts'), String(Date.now())); } catch(e){}
	return setStorageValue(scopedKey('activeVoucher'), v);
}
function removeActiveVoucher() { try { removeStorageValue(scopedKey('activeVoucher_ts')); } catch(e){} return removeStorageValue(scopedKey('activeVoucher')); }
// Adopt the venue-scoped voucher and prefill the box, safe to run twice.
// boot() runs before loadSiteId() resolves, so its first pass reads the
// "ERROR SITE ID" bucket and loadSiteId() has to correct it afterwards. Only
// ever overwrites values WE wrote (__prefillVoucher / __adoptedPre) so a live
// voucher from detectState() and anything the customer is typing survive.
function adoptScopedVoucher(fill) {
	try {
		var sv = getActiveVoucher();
		var mine = (voucher === "" || voucher === window.__adoptedPre);
		if (mine) { voucher = sv; window.__adoptedPre = sv; }
		if (fill && $("#voucherInput").length > 0) {
			var cur = String($("#voucherInput").val() || "");
			if (cur === "" || cur === window.__prefillVoucher) {
				$("#voucherInput").val(sv);
				window.__prefillVoucher = sv;
			}
		}
		return sv;
	} catch (e) { return ""; }
}
// Voucher history: venue-scoped, max 30, newest first — a new entry pushes
// the oldest out. List only, codes only (member usernames never recorded).
var VOUCH_HISTORY_MAX = 30;
var __pendingHistPush = [];
function siteScopeReady() { try { return typeof siteIdSuffix !== 'undefined' && !!siteIdSuffix; } catch (e) { return false; } }
// Site ID missing => the scope would be the shared "ERROR SITE ID" bucket, so
// codes leak between neighbouring vendos. Save nothing and show nothing until
// the file is published; the queue drains if it arrives (Scripts-F).
var __histBlocked = false;
function histBlocked() { return !!__histBlocked || !siteScopeReady(); }
function flushPendingHistory() {
	var q = __pendingHistPush; __pendingHistPush = [];
	for (var i = 0; i < q.length; i++) { try { pushVoucherHistory(q[i]); } catch (e) {} }
}
function getVoucherHistory() { if (histBlocked()) { return []; } try { var h = JSON.parse(getStorageValue(scopedKey('voucherHistory')) || "[]"); return Array.isArray(h) ? h : []; } catch (e) { return []; } }
function pushVoucherHistory(vc) {
	vc = String(vc || "").trim();
	if (!vc) { return; }
	if (histBlocked()) { try { if (__pendingHistPush.indexOf(vc) === -1 && __pendingHistPush.length < 30) { __pendingHistPush.push(vc); } } catch (e) {} return; }
	var h = getVoucherHistory().filter(function (e) { return String((e && e.v) || "") !== vc; });
	var m = "";
	try { m = String(window.mac || "").toUpperCase(); } catch (e2) {}
	h.unshift({ v: vc, t: Date.now(), m: m });
	try { setStorageValue(scopedKey('voucherHistory'), JSON.stringify(h.slice(0, VOUCH_HISTORY_MAX))); } catch (e) {}
	try { paintVoucherHistory(); } catch (e) {}
}
function useHistoryVoucher(vc) {
	vc = String(vc || "");
	if (!vc) { return; }
	try {
		if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(vc); }
		else { var ta = document.createElement('textarea'); ta.value = vc; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) {} document.body.removeChild(ta); }
	} catch (e) {}
	try { $.toast({ title: 'Copied', content: "Voucher copied to clipboard", type: 'success', delay: 2500 }); } catch (e) {}
}
function paintVoucherHistory() {
	var box = document.getElementById('vhistFull');
	if (!box) { return; }
	if (histBlocked()) { box.textContent = "Voucher history is unavailable on this network."; return; }
	var h = getVoucherHistory();
	box.innerHTML = "";
	if (!h.length) { box.textContent = "No vouchers yet."; return; }
	h.forEach(function (e) {
		var r = document.createElement('button');
		r.type = 'button';
		r.className = 'vhist-row';
		var left = document.createElement('span');
		left.className = 'vhist-left';
		var c = document.createElement('span');
		c.className = 'vhist-code';
		c.textContent = e.v;
		left.appendChild(c);
		var sub = "";
		try { sub = new Date(e.t).toLocaleDateString(); } catch (err) {}
		if (e.m) { sub += (sub ? " · " : "") + e.m; }
		if (sub) {
			var s = document.createElement('span');
			s.className = 'vhist-sub';
			s.textContent = sub;
			left.appendChild(s);
		}
		r.appendChild(left);
		var cp = document.createElement('span');
		cp.className = 'vhist-copy';
		cp.setAttribute('aria-hidden', 'true');
		cp.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
		r.appendChild(cp);
		r.setAttribute('data-vc', e.v);
		r.addEventListener('click', function () { useHistoryVoucher(this.getAttribute('data-vc')); });
		box.appendChild(r);
	});
}
function showHistoryView() {
	try { window.__histOpener = document.activeElement; } catch (e) {}
	try { paintVoucherHistory(); } catch (e) {}
	try { document.getElementById('view-history').style.display = "block"; } catch (e) {}
	window.__histOpen = true;
	try { document.getElementById('histBack').focus(); } catch (e) {}
}
function closeHistoryView() {
	try { document.getElementById('view-history').style.display = "none"; } catch (e) {}
	window.__histOpen = false;
	try { if (window.__histOpener && document.contains(window.__histOpener)) { window.__histOpener.focus(); } window.__histOpener = null; } catch (e) {}
}
// Keep Tab inside the history overlay while open (it lives inside #app,
// so inert on #app would trap the overlay itself).
if (!window.__histTrapBound) { window.__histTrapBound = true; try {
document.getElementById('view-history').addEventListener('keydown', function (ev) {
	if (ev.key !== 'Tab' || !window.__histOpen) { return; }
	var f = Array.prototype.filter.call(this.querySelectorAll('button,[href],[tabindex]:not([tabindex="-1"])'), function (el) { return !el.disabled && el.offsetParent !== null; });
	if (!f.length) { return; }
	var first = f[0], last = f[f.length - 1];
	if (ev.shiftKey && document.activeElement === first) { last.focus(); ev.preventDefault(); }
	else if (!ev.shiftKey && document.activeElement === last) { first.focus(); ev.preventDefault(); }
});
} catch (e) {} }
// Warn before back/refresh/CNA reclaim forfeits inserted coins.
window.addEventListener("beforeunload", function (e) {
	// Any unload while a coin insert is in flight asks first: the ESP slot may
	// already hold money even before /checkCoin reports it, and reloading
	// drops the slot on the floor. The old totalCoinReceived > 0 condition
	// left the whole wait window unguarded.
	// Keyed on __coinInsertLive, NOT on insertingCoin: pause() sets that one
	// too (to hold off the router's session refresh) and reading the persisted
	// isPaused flag here leaked across pages -- resume() keeps it set until
	// the router rules, so the guard could go dead on a later page.
	// __internalNav is the escape hatch for reloads the portal wants itself.
	try {
		if (window.__internalNav) { return; }
		if (window.__coinInsertLive) { e.preventDefault(); e.returnValue = ""; }
	} catch (err) {}
});
// Abandoned insert = orphaned coin slot. The box keeps the code it minted
// and rejects the NEXT customer with coinslot.busy until its own wait
// window expires, so release the slot when the page goes away.
function releaseCoinSlotOnExit() {
	try {
		if (typeof insertingCoin === "undefined" || !insertingCoin) { return; }
		var vc = window.__cancelVoucher || "";
		if (!vc) { return; }
		if (typeof navigator === "undefined" || !navigator.sendBeacon) { return; }
		var body = "voucher=" + encodeURIComponent(vc) + "&mac=" + encodeURIComponent(String(typeof mac === "undefined" ? "" : mac));
		var blob = new Blob([body], { type: "application/x-www-form-urlencoded" });
		navigator.sendBeacon("http://" + vendorIpAddress + "/cancelTopUp", blob);
		try { dbgLog("exit: coin slot released for " + vc); } catch (e) { }
	} catch (e) { }
}
// pagehide only, NOT visibilitychange: switching apps to read the code
// hides the tab too, and releasing then would throw away their coins.
window.addEventListener("pagehide", releaseCoinSlotOnExit);
// Same POST but readable, so the caller can carry on. With no pinned code
// we still ask: an empty code just makes the box answer busy and nothing
// else, which costs nothing and occasionally is all a stale slot needs.
function releaseCoinSlot(done) {
	var finish = function () { try { done(); } catch (e) { } };
	try {
		var vc = window.__cancelVoucher || voucher || "";
		$.ajax({
			url: "http://" + vendorIpAddress + "/cancelTopUp",
			type: "POST",
			data: "voucher=" + encodeURIComponent(vc) + "&mac=" + encodeURIComponent(String(typeof mac === "undefined" ? "" : mac)),
			dataType: "text",
			timeout: VENDO_TIMEOUT
		}).always(function () { finish(); });
	} catch (e) { finish(); }
}
// Per-voucher keys (remain/tempValidity/validity) are venue-scoped like
// activeVoucher itself, or the same VCxxxxxx code collides across
function vKey(vc, suffix) { return (vc ? scopedKey(vc + suffix) : null); }
function getVouchValue(vc, suffix) { var k = vKey(vc, suffix); return k ? getStorageValue(k) : null; }
function setVouchValue(vc, suffix, val) { var k = vKey(vc, suffix); if (k) { setStorageValue(k, val); } }
function removeVouchValue(vc, suffix) { var k = vKey(vc, suffix); if (k) { removeStorageValue(k); } }
function getPausedFlag() { return getStorageValue(scopedKey('isPaused')); }
function setPausedFlag() { return setStorageValue(scopedKey('isPaused'), "1"); }
function removePausedFlag() { return removeStorageValue(scopedKey('isPaused')); }
// Deliberately UNSCOPED (like autoLoginTried): set before logout and read
// after reload, potentially under a different site scope. Scoped reads used
function getReLoginFlag() { return getStorageValue('reLogin'); }
function setReLoginFlag() { return setStorageValue('reLogin', "1"); }
function removeReLoginFlag() { return removeStorageValue('reLogin'); }

// ---------- session-scoped auto-login guard (one shot per tab) ----------
// sessionStorage survives reloads in the same tab but dies with the tab,
var __memSession = {};
// Fallback chain: sessionStorage → persistent storage (localStorage/cookie
function setSessionValue(key, value) {
	try {
		if (typeof sessionStorage !== 'undefined' && sessionStorage != null) {
			sessionStorage.setItem(key, value);
			return;
		}
	} catch (e) {}
	try { setStorageValue(key, value); return; } catch (e) {}
	try { __memSession[key] = String(value); } catch (e) {}
}
function getSessionValue(key) {
	try {
		if (typeof sessionStorage !== 'undefined' && sessionStorage != null) {
			var v = sessionStorage.getItem(key);
			if (v != null) { return v; }
		}
	} catch (e) {}
	try { var s = getStorageValue(key); if (s != null) { return s; } } catch (e) {}
	try { if (key in __memSession) { return __memSession[key]; } } catch (e) {}
	return null;
}
function removeSessionValue(key) {
	try {
		if (typeof sessionStorage !== 'undefined' && sessionStorage != null) {
			sessionStorage.removeItem(key);
		}
	} catch (e) {}
	try { removeStorageValue(key); } catch (e) {}
	try { delete __memSession[key]; } catch (e) {}
}
// Deliberately UNSCOPED: one-shot per tab, no venue aspect. Scoping by
// siteIdSuffix used to mark under one key and check under another when the
// async site-id arrived mid-boot, bypassing the guard.
function autoLoginTried() { return getSessionValue('autoLoginTried') === '1'; }
function markAutoLoginTried() { setSessionValue('autoLoginTried', '1'); }
function clearAutoLoginTried() {
	try { removeSessionValue('autoLoginTried'); } catch (e) {}
	try {
		if (typeof sessionStorage !== 'undefined' && sessionStorage != null) {
			var kill = [];
			for (var i = 0; i < sessionStorage.length; i++) {
				var k = sessionStorage.key(i);
				if (k != null && k.indexOf('autoLoginTried') === 0) { kill.push(k); }
			}
			for (var j = 0; j < kill.length; j++) { sessionStorage.removeItem(kill[j]); }
		}
	} catch (e) {}
	try {
		for (var m in __memSession) {
			if (m.indexOf('autoLoginTried') === 0) { delete __memSession[m]; }
		}
	} catch (e) {}
}

function wipePortalStorage() {
	var fixed = ["activeVoucher", "activeVoucher_ts", "isPaused", "forceLogout",
		"redirectLogin", "ignoreSaveCode", "insertCoinRefreshed",
		"totalCoinReceived", "reLogin", "selectedVendo"];
	var scopedBases = ["activeVoucher", "activeVoucher_ts", "isPaused", "reLogin", "selectedVendo"];
	// Per-voucher keys are <voucher>remain / tempValidity / validity with an
	// optional _<scope> tail. The old regex was tail-anchored with no scope
	// allowed, so it only ever matched unscoped ones and every code the
	// customer ever used leaked three permanent entries.
	// ponytail: anchored at the start too — unanchored, this matched ANY key on
	// the router origin ending in "validity" and deleted it.
	var perVoucher = /^(.+)?(remain|tempValidity|validity)(_.+)?$/;
	function isOurs(k) {
		if (fixed.indexOf(k) >= 0) { return true; }
		for (var b = 0; b < scopedBases.length; b++) {
			if (k === scopedBases[b] || k.indexOf(scopedBases[b] + "_") === 0) { return true; }
		}
		return perVoucher.test(k);
	}
	// localStorage path: scan the real key list.
	try {
		if (typeof localStorage !== 'undefined' && localStorage != null) {
			var kill = [];
			for (var i = 0; i < localStorage.length; i++) {
				var k = localStorage.key(i);
				if (k != null && isOurs(k)) { kill.push(k); }
			}
			for (var j = 0; j < kill.length; j++) { try { localStorage.removeItem(kill[j]); } catch (e) {} }
		}
	} catch (e) {}
	// Cookie path (no localStorage): the only way to see the keys is the
	// cookie string itself. Skipping this left every deletion a no-op,
	// which is exactly the case the fallback exists for.
	try {
		if (typeof document !== 'undefined' && document.cookie) {
			var names = [];
			var parts = document.cookie.split(';');
			for (var p = 0; p < parts.length; p++) {
				var c = parts[p];
				while (c.charAt(0) == ' ') { c = c.substring(1); }
				var eq = c.indexOf('=');
				var nm = (eq >= 0) ? c.substring(0, eq) : c;
				if (nm && isOurs(nm)) { names.push(nm); }
			}
			for (var n = 0; n < names.length; n++) { try { removeStorageValue(names[n]); } catch (e) {} }
		}
	} catch (e) {}
}

function macNoColon() {
	return String(mac).split(":").join("");
}

// Fetch the router-published site ID (publish-site-id scheduler writes
function loadSiteId() {
	return $.ajax({ type: "GET", url: "/data/site-id.txt?date=" + (new Date().getTime()), timeout: ROUTER_TIMEOUT })
		.done(function (data) {
			var m = String(data == null ? "" : data).replace(/[^A-Za-z0-9]/g, "");
			if (/^[A-Za-z0-9]{4,32}$/.test(m)) {
				try { siteIdSuffix = m.toUpperCase(); } catch (e) {}
			// Scope is real now — correct whatever boot() adopted from the
			// "ERROR SITE ID" bucket before this fetch resolved.
			__histBlocked = false;
			adoptScopedVoucher(true);
			// The paused view may already be on screen, painted under the
			// pre-scope bucket. Repaint it now that the real venue scope is
			// live, or the remaining time stays a dash until the next reload.
			try { if (typeof STATE !== 'undefined' && STATE === "paused") { paintPausedView(); } } catch (e) {}
			try {
				// Venue-scoped with the bare key as the pre-scope fallback,
				// then the bare key is dropped so there is one source.
				var sel = getStorageValue(scopedKey('selectedVendo'));
				if (!sel) { sel = getStorageValue('selectedVendo'); }
				if (sel) {
					setStorageValue(scopedKey('selectedVendo'), sel);
					removeStorageValue('selectedVendo');
					if (typeof multiVendoOption !== 'undefined' && multiVendoOption === 0) {
						vendorIpAddress = sel;
						$("#vendoSelected").val(sel);
					}
				}
			} catch (e) {}
				try { dbgLog("site scope: " + siteIdSuffix, "dbg-ok"); } catch (e) {}
try { renderSiteTag(); } catch (e) {}
		try { removeStorageValue('voucherHistory'); } catch (e) {}
		try { flushPendingHistory(); } catch (e) {}
		try { paintVoucherHistory(); } catch (e) {}
			}
		})
		.fail(function (xhr, status, err) {
			dbgAjaxErr("siteScope", xhr, status, err);
			try { dbgLog("site-id missing, history saving paused"); } catch (e) { }
			// No site id => a shared "ERROR SITE ID" bucket, so voucher history
			// is neither saved nor shown until the file is published.
			__histBlocked = true;
			try { paintVoucherHistory(); } catch (e) {}
			try {
				if (!getSessionValue("__siteIdWarned")) {
					try { setSessionValue("__siteIdWarned", "1"); } catch (e) {}
					$.toast({ title: "Site ID missing", content: "Failed saving voucher history. Site ID file is missing.", type: "error", delay: 6000 });
				}
			} catch (e) { }
		});
}

// ---------- boot loader ----------

function setBootText(t) {
	$("#bootText").text(t);
}

function hideBoot() {
	if (bootDone) { return; }
	bootDone = true;
	$("#app").attr("style", "display: block");
	try { $("#bootLoader").addClass("boot-fade"); } catch (e) {}
	// Arm the one-shot halo fade-in now that the view is actually on screen.
	// Running it from render() would burn the animation while #app was
	// still display:none.
	try { document.body.classList.add("haze-in"); } catch (e) {}
	try { $("#readyNote").text("Portal ready"); } catch (e) {}
	try { drainAutoLogin(); } catch (e) {}
	setTimeout(function () {
		$("#bootLoader").attr("style", "display: none");
		try {
			__fitCache = {};
			fitCountdown("#remainTime");
			fitCountdown("#pauseRemainTime");
		} catch (e) { }
	}, 450);
}

function __stepSecs(t0) {
	try { return (((new Date()).getTime() - t0) / 1000).toFixed(1) + "s"; }
	catch (e) { return ""; }
}
var __bootTotal = 0;
var __bootDoneCount = 0;
function __renderBoot() {
	setBootText("Loading… " + __bootDoneCount + "/" + __bootTotal);
}
function __bootSettle(label, t0, promise, soft) {
	__bootDoneCount++;
	__renderBoot();
	try {
		var ok = (promise && typeof promise.state === "function") ? promise.state() == "resolved" : true;
		dbgLog("boot step " + label + " " + ((ok || soft) ? "done" : "fail") + " (" + __stepSecs(t0) + ")");
	} catch (e) {}
}
function timedStep(label, promise, soft) {
	var t0 = (new Date()).getTime();
	__bootTotal++;
	__renderBoot();
	if (!promise || typeof promise.always !== "function") {
		setTimeout(function () { __bootSettle(label, t0, promise, soft); }, 500);
		return promise;
	}
	var elapsed0 = (new Date()).getTime() - t0;
	var delay0 = Math.max(0, 500 - elapsed0);
	setTimeout(function () {
		try {
			if (promise.state && promise.state() != "pending") { __bootSettle(label, t0, promise, soft); return; }
		} catch (e) {}
		promise.always(function () { __bootSettle(label, t0, promise, soft); });
	}, delay0);
	return promise;
}

function checkNetStatus() {
	var d = $.Deferred();
	try {
		if (typeof showInternetStatus !== "undefined" && !showInternetStatus) { d.resolve(); return d.promise(); }
	} catch (e) { d.resolve(); return d.promise(); }
	$.ajax({ type: "GET", url: "data/netstatus.txt?query=" + new Date().getTime(), timeout: ROUTER_TIMEOUT, dataType: "text" })
	.done(function (t) {
		try {
			var raw = String(t || "").toLowerCase();
			// Script writes plain up/down, but a RouterOS-created file can
			// carry print-header comments — only an explicit "down" means offline.
			if (raw.indexOf("down") !== -1) {
				var msg = "No internet connection as of the moment, please try again later";
				try { if (typeof offlineText !== "undefined" && offlineText) { msg = offlineText; } } catch (e2) {}
				$("#netBannerText").text(msg); $("#netBanner").show();
			} else {
				try { dbgLog("net: up"); } catch (e2) {}
				$("#netBanner").hide();
			}
		} catch (e) {}
		d.resolve();
	})
	.fail(function () { try { $("#netBanner").hide(); } catch (e) {} try { if ((typeof showInternetStatus === "undefined" || showInternetStatus) && !getSessionValue("__netWarned")) { setSessionValue("__netWarned", "1"); $.toast({ title: "Status file missing", content: "Internet status file missing.", type: "error", delay: 5000 }); } } catch (e2) {} d.resolve(); });
	return d.promise();
}

function boot() {
	__bootTotal = 0;
	__bootDoneCount = 0;
	try { bootDone = false; } catch (e) {}
	try {
		if (getStorageValue("portalBuild") !== "r5") {
			var wipeKeys = ["activeVoucher", "isPaused", "forceLogout",
				"redirectLogin", "ignoreSaveCode", "insertCoinRefreshed",
				"totalCoinReceived", "reLogin", "selectedVendo"];
			for (var w = 0; w < wipeKeys.length; w++) { eraseCookie(wipeKeys[w]); }
			wipePortalStorage();
			setStorageValue("portalBuild", "r5");
			voucher = "";
		}
	} catch (e) { }
	$("#footYear").text(new Date().getFullYear());
	applyFlags();
	try { sfxPreload(); } catch (e) {}
	try { dbgLog("boot page=" + (typeof PAGE !== 'undefined' ? PAGE : "?") + " vendo=" + (typeof vendorIpAddress !== 'undefined' ? vendorIpAddress : "?") + " mac=" + (typeof mac !== 'undefined' ? mac : "?")); } catch (e) { }
	// Records the value in __adoptedPre so loadSiteId can correct it later.
	try { adoptScopedVoucher(false); } catch (e) {}
	if (getReLoginFlag() == '1') {
		removeReLoginFlag();
		// NO prefill here: the venue scope is still unknown, so a read now
		// lands in the "ERROR SITE ID" bucket and loadSiteId's correction
		// would skip a box that is no longer empty. goReLogin reads after.
		try { markAutoLoginTried(); } catch (e) {}
		try { setBootText("Renewing session…"); } catch (e) {}
		var reLoginFired = false;
		var goReLogin = function () {
			if (reLoginFired) { return; }
			reLoginFired = true;
			setTimeout(function () {
				adoptScopedVoucher(true);
				var code = $("#voucherInput").val() || voucher || getActiveVoucher();
				if (!code) { hideBoot(); return; }
				try { doLogin(); } catch (e) { newLogin(); }
			}, 500);
		};
		// ponytail: this path returns at the end of the block, so it never reaches
		// the 9s failsafe further down. loadSiteId() normally settles and calls
		// goReLogin itself, but a promise that never settles would strand the
		// customer behind the loader with no in-page backstop. The guard makes the
		// timer and the promise idempotent, so whichever fires first wins.
		setTimeout(goReLogin, 9000);
		try {
			window.__siteIdLoaded = true;
			var siteP = loadSiteId();
			if (siteP && siteP.always) { siteP.always(goReLogin); } else { goReLogin(); }
		} catch (e) { goReLogin(); }
		// Not awaited: this path must submit fast or the extend looks stuck.
		// Fire-and-forget so a FAILED renew still shows rates + net banner.
		try { loadRates(); } catch (e) {}
		try { checkNetStatus(); } catch (e) {}
		return;
	}
	try { if (!window.__siteIdLoaded) { loadSiteId(); } } catch (e) {}
	try { adoptScopedVoucher(false); } catch (e) {}
	// Failsafe: never trap the customer behind the loader (dead vendo,
	var bootStateKnown = false;
	setTimeout(function () {
		if (bootStateKnown) { hideBoot(); return; }
		setBootText("Loading… still trying, check your connection.");
		setTimeout(hideBoot, 11000);
	}, 9000);

	var bootT0 = (new Date()).getTime();
	timedStep("Detecting session", detectState(), true).done(function (state) {
		try { dbgLog("boot state=" + state); } catch (e) { }
		bootStateKnown = true;
		render(state);
		// Paused: show the view first, then verify it is still resumable.
		// Waiting on every job here meant a dead ESP held the customer behind
		// the loader for 5s for a page they were only trying to look at.
		// Router calls (expiry, net) still run; only loadRates is deferred
		// until after the reveal because that is the one that waits on the ESP.
		if (state == "paused") {
			setTimeout(hideBoot, 120);
			timedStep("Loading session", showValidity(), true);
			timedStep("Checking internet", checkNetStatus(), true);
			timedStep("Checking session", checkStalePause(), true).always(function () {
				try { loadRates(); } catch (e) {}
			});
			return;
		}
		var jobs = [timedStep("Loading Wi-Fi rates", loadRates(), true), timedStep("Checking internet", checkNetStatus(), true)];
		if (state == "login") {
			jobs.push(timedStep("Checking session", resumeSession(), true));
		} else {
			jobs.push(timedStep("Loading session", showValidity(), true));
			jobs.push(timedStep("Checking voucher", validateStatusVoucher(), true));
		}
		$.when.apply($, jobs).always(function () {
			try { dbgLog("boot ready (" + __stepSecs(bootT0) + ")"); } catch (e) { }
			setTimeout(hideBoot, 500);
		});
	});
}

// Read live session facts out of the status page. Prefers data-* attributes
function parseStatusFacts(html) {
	var facts = { voucher: "", sessiontime: "" };
	try {
		var doc = new DOMParser().parseFromString(String(html), "text/html");
		// Shells carry the voucher as span text (never inline JS/attrs —
		try {
			var cvEl = doc.getElementById("curV");
			// .trim() on every source: an untrimmed voucher is persisted by
			// detectState and re-submitted by doLogin, so one stray space
			// round-trips forever and the router rejects it every time.
			if (cvEl && cvEl.textContent) { facts.voucher = String(cvEl.textContent).trim(); }
		} catch (e2) {}
		var root = doc.getElementById("loginBody") || doc.body;
		if (root) {
			if (!facts.voucher) {
				var cv = root.getAttribute("data-current-voucher");
				if (cv) { facts.voucher = String(cv).trim(); }
			}
			var st = root.getAttribute("data-session-time");
			if (st) { facts.sessiontime = st; }
			if (facts.voucher || facts.sessiontime) { return facts; }
		}
	} catch (e) {}
	try {
		var m = String(html).match(/<span id="curV"[^>]*>([^<]*)<\/span>/);
		if (m) { facts.voucher = String(m[1]).trim(); }
		var t = String(html).match(/(?:var|window\.)sessiontime\s*=\s*"([^"]*)"/);
		if (t) { facts.sessiontime = t[1]; }
	} catch (e) {}
	return facts;
}

function detectState() {
	var d = $.Deferred();
	try {
		var force = new URLSearchParams(location.search).get("state");
		if (force == "login" || force == "status" || force == "paused") {
			try { dbgLog("state forced: " + force); } catch (e) { }
			d.resolve(force);
			return d.promise();
		}
	} catch (e) { }
	// Single retry: a slow router (>3s) used to misclassify logged-in
	probeStatus(0);
	function probeStatus(attempt) {
	$.ajax({ type: "GET", url: "/status", timeout: ROUTER_TIMEOUT }).done(function (data) {
		var html = String(data);
		if (html.indexOf("IAMNOTLOGINSTRINGPLEASEDONTREMOVE") >= 0) {
			// Router says logged out. A pause flag means the customer left on
			// purpose — keep them paused instead of auto-logging them back in.
			// (Dropping the flag here is what made every refresh resurrect the
			// session.) Validity of the pause itself is checked async by
			// checkStalePause() once the paused view is up.
			if (getPausedFlag() == "1") {
				try { window.__resolvedState = "paused"; dbgLog("detect: paused"); } catch (e) { }
				d.resolve("paused");
				return;
			}
			try { dbgLog("detect: login"); } catch (e) { }
			d.resolve("login");
		} else {
			// Logged in, so a pause cannot be in effect (pausing ends the
			// router session). Clear the flag here or the next timeout lands
			// on the paused view instead of auto-logging back in.
			try { if (getPausedFlag() == "1") { removePausedFlag(); dbgLog("detect: pause cleared, logged in"); } } catch (e) {}
			try {
				var facts = parseStatusFacts(html);
				if (facts.voucher) {
					window.currentVoucher = facts.voucher;
					voucher = facts.voucher;
					setActiveVoucher( facts.voucher);
				}
				if (facts.sessiontime) { window.sessiontime = facts.sessiontime; }
			} catch (e) {}
			try { dbgLog("detect: status" + (voucher ? " voucher-len=" + voucher.length : " no-voucher")); } catch (e) { }
			d.resolve("status");
		}
	}).fail(function () {
		if (attempt < 1) {
			try { dbgLog("detect: retrying /status once"); } catch (e) { }
			probeStatus(attempt + 1);
			return;
		}
		try { dbgLog("detect: /status unreachable, assuming login"); } catch (e) { }
		d.resolve("login");
	});
	}
	return d.promise();
}

// Paused-time restore: seconds from storage → locally-built boxes. Never
// .html() stored markup; garbage/negative renders a dash, not attacker HTML.
function renderStoredRemain(sel, vc) {
	var secs = parseInt(getVouchValue(vc, "remain"), 10);
	$(sel).html(isNaN(secs) || secs < 0 ? "—" : boxesDhms(secs));
	fitCountdown(sel);
}

// The hero haze doubles as a state tell: gold on the live status view,
// red on the two "not being served right now" views (login + paused).
// The fade-in itself is armed once by hideBoot().
function paintStateHaze(state) {
	var b = document.body;
	if (!b) { return; }
	b.classList.remove("haze-gold", "haze-red");
	b.classList.add(state == "status" ? "haze-gold" : "haze-red");
}

function render(state) {
	setPortalState(state);
	try { paintStateHaze(state); } catch (e) {}
	try { if (state != "login" && voucher) { pushVoucherHistory(voucher); } } catch (e) {}
	try { paintVoucherHistory(); } catch (e) {}
	try { dbgLog("render: " + state); } catch (e) { }
	// Login succeeded (status/paused views): arm the next auto-login.
	try { if (state != "login") { clearAutoLoginTried(); removeSessionValue("__loginRetry"); } } catch (e) {}
	if (state == "login") {
		return;
	}
	if (state == "status") {
		$("#statusVoucher").text(voucher);
		try { if (typeof trialNoExtend !== "undefined" && trialNoExtend && voucher && voucher.indexOf("T-") === 0) { $("#statusVoucher").text("FREE TRIAL"); $("#extendBtn").hide(); } } catch (e) {}
		try {
			if (typeof window.bytesIn !== "undefined" && window.bytesIn) { $("#upUsed").text(window.bytesIn); } else { $("#upUsed").text("—"); }
			if (typeof window.bytesOut !== "undefined" && window.bytesOut) { $("#downUsed").text(window.bytesOut); } else { $("#downUsed").text("—"); }
		} catch (e) {}
		// Cache last known usage so the paused view can show it (router
		// drops the byte counters once the session is paused/logged out).
		try {
			if (typeof window.bytesIn !== "undefined" && window.bytesIn) { setStorageValue(scopedKey("lastUp"), window.bytesIn); }
			if (typeof window.bytesOut !== "undefined" && window.bytesOut) { setStorageValue(scopedKey("lastDown"), window.bytesOut); }
		} catch (e) {}
		startCountdown();
		previewUrgencyHook();
	}
	if (state == "paused") { paintPausedView(); }
}

// Paused-view paint, split out of render() because it has to run twice on a
// refresh. boot() fires detectState() and loadSiteId() at the same moment, and
// whichever HTTP response lands first wins. When detectState won, render()
// painted the countdown under the "ERROR SITE ID" venue scope -- the site id
// had not arrived yet, so activeVoucher and its <code>remain</code> key were
// both missing and the boxes came up as a bare dash. loadSiteId() corrects the
// scope afterwards but used to stop at adoptScopedVoucher(), so nothing ever
// repainted. Hence this function is also called from there.
function paintPausedView() {
	// `voucher` is NOT trustworthy here, which is what made a refresh-while-
	// paused show a bare dash. On a fresh load it holds the router's
	// MAC-as-voucher placeholder, so it is non-empty, so adoptScopedVoucher()
	// refuses to overwrite it (that guard exists to protect a live voucher),
	// so the stored seconds were looked up under the MAC instead of the code
	// pause() actually keyed them with. Read the active voucher straight back
	// out of storage; fall back to `voucher` only when storage has none, which
	// is the member-login case (no voucher code at all).
	var vc = "";
	try { vc = getActiveVoucher() || ""; } catch (e) {}
	if (!vc) { try { vc = voucher || ""; } catch (e) {} }
	$("#pausedVoucher").text(vc);
	renderStoredRemain("#pauseRemainTime", vc);
	try {
		var lastUp = getStorageValue(scopedKey("lastUp"));
		var lastDown = getStorageValue(scopedKey("lastDown"));
		if (lastUp) { $("#upUsedPaused").text(lastUp); } else { $("#upUsedPaused").text("—"); }
		if (lastDown) { $("#downUsedPaused").text(lastDown); } else { $("#downUsedPaused").text("—"); }
	} catch (e) {}
}

function tbox(n, one, many) {
	var num = (n < 10 ? "0" : "") + n;
	return '<span class="tbox"><span class="tnum">' + num + '</span><span class="tlab">' + (n == 1 ? one : many) + "</span></span>";
}
function boxesDhms(seconds) {
	var t = Math.max(0, parseInt(seconds || 0, 10));
	var d = Math.floor(t / 86400), h = Math.floor(t % 86400 / 3600);
	var m = Math.floor(t % 3600 / 60), s = t % 60;
	var sep = '<span class="tsep">:</span>';
	var units = [[d, "Day", "Days"], [h, "Hour", "Hours"], [m, "Min", "Mins"], [s, "Sec", "Secs"]];
	// All four boxes, always. Dropping the leading zero units was a fix for a
	// narrow-screen overflow that the .tbox sizing below now handles on its
	// own, and it cost more than it bought: the row jumped from 4 boxes to 2
	// the moment a session dropped under an hour, so the numbers the customer
	// was reading moved sideways mid-countdown.
	var out = [];
	for (var i = 0; i < units.length; i++) { out.push(tbox(units[i][0], units[i][1], units[i][2])); }
	return out.join(sep);
}

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

function paintRemainA11y(time) {
	try {
		var t = Math.max(0, parseInt(time || 0, 10));
		var d = Math.floor(t / 86400), h = Math.floor(t % 86400 / 3600);
		var m = Math.floor(t % 3600 / 60), s = t % 60;
		var parts = [];
		if (d) { parts.push(d + (d == 1 ? " day" : " days")); }
		if (h) { parts.push(h + (h == 1 ? " hour" : " hours")); }
		if (m) { parts.push(m + (m == 1 ? " minute" : " minutes")); }
		if (s || !parts.length) { parts.push(s + (s == 1 ? " second" : " seconds")); }
		$("#remainTime").attr("aria-label", parts.join(" ") + " left");
	} catch (e) {}
}

function startCountdown() {
	if ($("#remainTime").length == 0 || window.sessiontime == null) { return; }
	// A re-render (coin cancel, slot close, failed pause) re-enters here.
	// window.sessiontime is written once per page load, so restarting from it
	// rewound the clock to the FULL session and re-armed both warnings. Once
	// a countdown is live, window.__remainSecs is the truth.
	var live = (typeof window.__remainSecs === "number" && isFinite(window.__remainSecs)) ? window.__remainSecs : null;
	var time = (live != null) ? live : window.sessiontime;
	if (time == "0" || time == "") {
		$("#remainTime").html("Unlimited");
		return;
	}
	time = parseInt(time, 10);
	if (!isFinite(time) || time < 0) { time = 0; }
	window.__remainSecs = time;
	// The original session length, kept across re-renders so the 5m/1m
	// warnings still arm at the right thresholds after a mid-session restart.
	var total = (typeof window.__sessionTotal === "number" && isFinite(window.__sessionTotal)) ? window.__sessionTotal : time;
	window.__sessionTotal = total;
	// Warnings are sticky for the page: once shown they must not re-fire
	// because the view was re-rendered.
	var warned5 = !!window.__warned5, warned1 = !!window.__warned1;
	$("#remainTime").html(boxesDhms(time));
	paintRemainA11y(time);
	paintCountdownUrgency(time);
	fitCountdown("#remainTime");
	if (window.remainingTimer != null) { clearInterval(window.remainingTimer); }
	window.remainingTimer = setInterval(function () {
		time--;
		window.__remainSecs = time;
		$("#remainTime").html(boxesDhms(time));
		paintRemainA11y(time);
		paintCountdownUrgency(time);
		fitCountdown("#remainTime");
		if (!warned5 && total > 300 && time <= 300) {
			warned5 = true;
			window.__warned5 = true;
			$.toast({ title: 'Running low', content: '5 minutes remaining — tap EXTEND TIME to add more', type: 'warning', delay: 5000 });
		}
		if (!warned1 && total > 60 && time <= 60) {
			warned1 = true;
			window.__warned1 = true;
			$.toast({ title: 'Almost out', content: '1 minute remaining! Tap EXTEND TIME now or you will be logged out', type: 'warning', delay: 8000 });
			try {
				sfxPlayFile("error", snd("assets/sounds/error.mp3"), false, null);
			} catch (e) { }
		}
		if (time <= 0) {
			$.toast({ title: 'Success', content: 'Time limit exceeded, Thank you for the purchase, will be logout shortly', type: 'success', delay: 5000 });
			clearInterval(window.remainingTimer);
			try { if (window.__logoutTimer) { clearTimeout(window.__logoutTimer); } } catch (e) {}
			window.__logoutTimer = setTimeout(function () { document.logout.submit(); }, 6000);
		}
	}, 1000);
}

function previewUrgencyHook() {
	try {
		var m = new RegExp("[?&]urgency=(warn|low)").exec(location.search || "");
		if (m) {
			$("#remainTime").removeClass("time-warn time-low")
				.addClass(m[1] == "low" ? "time-low" : "time-warn");
		}
	} catch (e) { }
}

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
			var currentHotspot = hotspotAddress.split(":")[0];
			for (var i = 0; i < multiVendoAddresses.length; i++) {
				if (multiVendoAddresses[i].hotspotAddress == currentHotspot) {
					vendorIpAddress = multiVendoAddresses[i].vendoIp;
				}
			}
		} else if (multiVendoOption == 2) {
			for (var j = 0; j < multiVendoAddresses.length; j++) {
				if (multiVendoAddresses[j].interfaceName == interfaceName) {
					vendorIpAddress = multiVendoAddresses[j].vendoIp;
				}
			}
		} else {
			// ponytail: this was the one unguarded .on() in the file — no .off(), no
			// namespace — and the append loop above had no clear, so a second
			// applyFlags() would duplicate every <option> and run this handler
			// twice per change. Clear first, namespace the binding.
			$("#vendoSelected").empty();
			for (var k = 0; k < multiVendoAddresses.length; k++) {
				$("#vendoSelected").append($('<option>', {
					value: multiVendoAddresses[k].vendoIp,
					text: multiVendoAddresses[k].vendoName
				}));
			}
			// Venue-scoped, like every other saved value, with the old bare
			// key as the pre-scope fallback. A truthy test, not "!= null":
			// a cookie written with an empty value reads back as "" and
			// would blank vendorIpAddress into http:///topUp.
			var selectedVendo = getStorageValue(scopedKey('selectedVendo'));
			if (!selectedVendo) { selectedVendo = getStorageValue('selectedVendo'); }
			if (selectedVendo) {
				vendorIpAddress = selectedVendo;
			}
			$("#vendoSelected").val(vendorIpAddress);
			$("#vendoSelected").off("change.vendo").on("change.vendo", function () {
				vendorIpAddress = $("#vendoSelected").val();
				setStorageValue(scopedKey('selectedVendo'), vendorIpAddress);
			});
			$("#vendoSelected").trigger("change");
			// Manual multi-vendo: isMultiVendo is the single switch,
			// picker always shows here (auto modes resolve silently).
			$("#vendoSelectDiv").attr("style", "display: block");
		}
	}

	// value: allow <em> only, strip everything else so a per-site edit
	// can't inject script/img handlers via .html().
	function brandSafe(html) {
		var tmp = document.createElement("div");
		tmp.innerHTML = String(html == null ? "" : html);
		var out = "";
		var nodes = tmp.childNodes;
		for (var bi = 0; bi < nodes.length; bi++) {
			var n = nodes[bi];
			if (n.nodeType === 3) { out += n.nodeValue; }
			else if (n.nodeType === 1 && n.tagName === "EM") { out += "<em>" + n.textContent + "</em>"; }
			else if (n.nodeType === 1) { out += n.textContent; }
		}
		return out;
	}
	try {
		if (typeof brandHeaderHtml !== 'undefined' && brandHeaderHtml) {
			$("#brandHeader").html(brandSafe(brandHeaderHtml));
			var plain = brandHeaderHtml.replace(/<[^>]*>/g, "");
			$("#bootBrand").text(plain);
			document.title = plain + " Portal";
		}
		if (typeof footerBrandText !== 'undefined') {
			if (footerBrandText) { $("#footerBrand").text(footerBrandText).css("display", ""); }
			else { $("#footerBrand").hide(); }
		}
		try { if (typeof currencySym !== 'undefined' && currencySym) $(".coin-peso").text(currencySym); } catch (e) {}
		try { if (typeof currencySym !== 'undefined' && currencySym) $("#coinCur").text(currencySym); } catch (e) {}
		if (typeof footerSubText !== 'undefined' && footerSubText) $("#footerSub").text(footerSubText);
		try { if (typeof showMemberSection !== 'undefined' && !showMemberSection) $("#memberSection").hide(); } catch (e) {}
		try { if (typeof showTrialLogin !== "undefined" && showTrialLogin) { $("#trialWrap").show(); } } catch (e) {}
		try { if (typeof showConvertVoucher !== "undefined" && !showConvertVoucher) { $("#convertWrap").hide(); } } catch (e) {}
		// Pre-fill the MAC as the voucher. Skipped when the box already
		// holds something, so a returning customer keeps the code that
		// actually has time on it.
		try {
			if (typeof macAsVoucherCode !== "undefined" && macAsVoucherCode && !$("#voucherInput").val() && !getActiveVoucher()) {
				voucher = macNoColon();
				$("#voucherInput").val(voucher);
			}
		} catch (e) {}
		try { $("#trialBtn").off("click.trial").on("click.trial", function () { if (window.trialAllowed && window.trialUrl) { try { window.location.href = window.trialUrl; } catch (e) {} } else { try { $.toast({ title: "Trial unavailable", content: "Free trial is not enabled on this router", type: "error", delay: 5000 }); } catch (e) {} } return false; }); } catch (e) {}
		try { if (!$("#portalVer").text()) { $("#portalVer").text(SOUND_V.replace(/^\?v=/, "v")); } } catch (e) {}
		try { renderSiteTag(); } catch (e) {}
		try { renderFooterSocial(); } catch (e) {}
	} catch(e) {}
}

function renderSiteTag() {
	try {
		var el = $("#siteTag");
		if (!el || el.length === 0) { return; }
		var s = "";
		try { s = venueScopeSuffix(); } catch (e) {}
		// venueScopeSuffix() answers "ERROR SITE ID" when the router never
		// published /data/site-id.txt. Printing that in the footer of every
		// page tells the customer nothing and reads as a broken build; an
		// operator who does publish a site id still sees it.
		if (!s || s === "ERROR_SITE_ID") { el.text("").hide(); return; }
		el.text(s).show();
	} catch (e) {}
}

// Glyphs for the footer link, keyed by the footerSocialIcon setting so the
// same pill can point at a Facebook page or any other site without touching
// portal.html. Unknown keys fall back to the globe: a wrong-but-plausible
// brand icon reads worse than a neutral one.
var SOCIAL_ICONS = {
	facebook: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M22.675 0h-21.35C.593 0 0 .593 0 1.325v21.351C0 23.407.593 24 1.325 24H12.82v-9.293H9.692v-3.62h3.128V8.413c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24h-1.918c-1.5 0-1.793.713-1.793 1.763v2.313h3.584l-.467 3.62h-3.117V24h6.112c.73 0 1.323-.593 1.323-1.325V1.325C24 .593 23.407 0 22.675 0z"/></svg>',
	globe: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
};

// The portal's one outbound link. Hidden until settings.json supplies a URL,
// so the markup ships without a hardcoded destination and an unconfigured
// router renders nothing rather than a link that goes nowhere.
function renderFooterSocial() {
	try {
		var el = $("#footerSocial");
		if (!el || el.length === 0) { return; }
		var url = "";
		try { if (typeof footerSocialUrl !== "undefined" && footerSocialUrl) { url = String(footerSocialUrl).replace(/^\s+|\s+$/g, ""); } } catch (e) {}
		// http(s) only, and no whitespace. settings.json is operator-editable
		// and a typo there would otherwise let a javascript: URL through into
		// an anchor customers tap.
		if (!/^https?:\/\/[^\s]+$/i.test(url)) { el.removeAttr("href").hide(); return; }
		var label = "Facebook";
		try { if (typeof footerSocialLabel !== "undefined" && footerSocialLabel) { label = String(footerSocialLabel); } } catch (e) {}
		var key = "facebook";
		try { if (typeof footerSocialIcon !== "undefined" && footerSocialIcon) { key = String(footerSocialIcon).toLowerCase(); } } catch (e) {}
		if (!SOCIAL_ICONS[key]) { key = "globe"; }
		try { $("#socialIco").attr("class", "sico sico-" + key).html(SOCIAL_ICONS[key]); } catch (e) {}
		try { $("#socialLabel").text(label); } catch (e) {}
		el.attr("href", url).attr("aria-label", label + " page, opens in a new tab").show();
	} catch (e) {}
}

// ---------- focused blocks: one action on screen at a time (no modals) ----------

function toggleBlock(id) {
	var el = document.getElementById(id);
	if (!el) { return; }
	var hidden = el.style.display == "none";
	el.style.display = hidden ? "block" : "none";
	var head = document.getElementById(id + "Head");
	if (head) {
		try { head.setAttribute("aria-expanded", hidden ? "true" : "false"); } catch (e) {}
		var h = head.innerHTML;
		if (h.indexOf("&#9656;") >= 0 || h.indexOf("▸") >= 0) {
			head.innerHTML = h.replace("&#9656;", "&#9662;").replace("▸", "▾");
		} else {
			head.innerHTML = h.replace("&#9662;", "&#9656;").replace("▾", "▸");
		}
	}
}

// Persistent coin-loss warning, painted whenever the insert state changes.
//
// The browser's own unload dialog cannot carry our wording: Chrome and Firefox
// discard e.returnValue and show fixed text ("Changes you made may not be
// saved"), and Safari ignores beforeunload entirely. So the warning the
// customer actually reads has to be on the page, for as long as leaving the
// page would cost them money.
// One line that always says what the coin box is doing and what to do next.
// The toasts used to carry this, but they vanish in 2-4s and the panel is a
// modal people read at arm's length from a machine. Deliberately does NOT
// repeat the per-second countdown: a live region that changes every second
// is the reason #loNote lost its aria-live.
// Reveals the "add time with another code" field. Kept collapsed until asked
// for: it is a different job from paying, and it used to sit under the CANCEL
// button where a thumb lands.
function toggleConvertBlock() {
	try {
		var btn = document.getElementById("convertToggle");
		var body = document.getElementById("convertBody");
		if (!btn || !body) { return false; }
		var open = body.style.display != "none" && body.offsetParent !== null;
		body.style.display = open ? "none" : "";
		btn.setAttribute("aria-expanded", open ? "false" : "true");
		if (open) { try { body.getElementsByTagName("input")[0].value = ""; } catch (e) {} }
		else { try { body.getElementsByTagName("input")[0].focus(); } catch (e) {} }
	} catch (e) {}
	return false;
}

function paintCoinStage() {
	var el = document.getElementById("coinStage");
	if (!el) { return; }
	var txt = "";
	try {
		var panel = document.getElementById("coinPanel");
		var open = false;
		try { open = !!panel && panel.offsetParent !== null; } catch (e) { open = !!panel && panel.style.display != "none"; }
		if (!open) { txt = ""; }
		else if (window.__useVoucherBusy) { txt = "Confirming your purchase\u2026"; }
		// No idle/coins text on purpose: the customer already sees the amount
		// on the progress bar and the DONE button lights up when it is live.
	} catch (e) { txt = ""; }
	try { el.textContent = txt; el.style.display = txt ? "" : "none"; } catch (e) {}
}

function paintCoinLiveNote() {
	var el = document.getElementById("coinLiveNote");
	if (!el) { return; }
	if (!window.__coinInsertLive) { el.style.display = "none"; return; }
	var cur = "";
	try { cur = (typeof currencySym !== "undefined" && currencySym) ? currencySym : ""; } catch (e) {}
	var coins = 0;
	try { coins = parseInt(totalCoinReceived, 10) || 0; } catch (e) {}
	el.textContent = coins > 0
		? cur + coins + " inserted — leaving this page now loses it."
		: "Leaving this page now cancels the coin insert.";
	el.style.display = "";
}

function showCoinPanel() {
	var slot = (STATE == "status") ? "#coinSlot-status" : "#coinSlot-login";
	var panel = document.getElementById("coinPanel");
	var dest = document.querySelector(slot);
	if (panel && dest && panel.parentNode !== dest) { dest.appendChild(panel); }
	if (STATE == "status") {
		$("#extendBtn").attr("style", "display: none");
		$("#statusHero").attr("style", "display: none");
		$("#view-status .btnrow").attr("style", "display: none");
	} else {
		$("#insertBtn").attr("style", "display: none");
	}
	$("#voucherBlock").attr("style", "display: none");
	$("#memberSection").attr("style", "display: none");
	try {
		$("#voucherBlock").attr("aria-hidden", "true");
		$("#memberSection").attr("aria-hidden", "true");
	} catch (e) {}
	document.body.classList.add("coin-focus");
	$("#coinPanel").attr("style", "display: block");
	var el = document.getElementById("coinPanel");
	if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: "nearest", behavior: ((window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) ? "auto" : "smooth") }); } catch (e) { el.scrollIntoView(); } }
	try {
		var t = document.getElementById("coinPanelTitle");
		if (t && t.focus) { t.focus({ preventScroll: true }); }
	} catch (e) {}
	if (!window.__coinEscBound) {
		window.__coinEscBound = true;
		try {
			document.addEventListener("keydown", function (ev) {
				if ((ev.key === "Escape" || ev.keyCode === 27) && window.__histOpen) {
					try { closeHistoryView(); } catch (e) {}
					return;
				}
				if ((ev.key === "Escape" || ev.keyCode === 27) && window.__coinOpen) {
					try { cancelCoin(); } catch (e) {}
				}
			});
		} catch (e) {}
	}
	window.__coinOpen = true;
	paintCoinStage();
	// Pull-to-refresh is a browser gesture: beforeunload cannot be relied on
	// to stop it, so the coin window suppresses it outright. Everywhere else
	// swipe-down refresh stays available.
	document.body.classList.add("coin-live");
}

// One label for both flows: the button finishes the insert, it does not
// "claim" anything. The coin panel already shows time + code amounts.
function restoreCoinChrome() {
	document.body.classList.remove("coin-focus");
	document.body.classList.remove("coin-live");
	window.__coinOpen = false;
	window.__coinInsertLive = false;
	paintCoinLiveNote();
	$("#statusHero").attr("style", "");
	$("#view-status .btnrow").attr("style", "");
	$("#voucherBlock").attr("style", "");
	try { $("#voucherBlock").removeAttr("aria-hidden"); } catch (e) {}
	if (typeof showMemberSection === 'undefined' || showMemberSection) {
		$("#memberSection").attr("style", "");
		try { $("#memberSection").removeAttr("aria-hidden"); } catch (e) {}
	}
	try {
		var back = (typeof STATE !== "undefined" && STATE == "status") ? "#extendBtn" : "#insertBtn";
		var b = document.querySelector(back);
		if (b && b.focus) { b.focus({ preventScroll: true }); }
	} catch (e) {}
}

function cancelCoin() {
	// Coins in the slot? Show the inline forfeit bar — window.confirm is
	// suppressed in CNA sheets, which used to strand paid credit (a stray
	if (totalCoinReceived > 0) {
		try {
			$("#forfeitText").text(currencySym + totalCoinReceived + " inserted — cancelling forfeits it.");
			$("#forfeitBar").show();
			try { $("#forfeitYes").focus(); } catch (e) {}
			$("#forfeitYes").off("click").on("click", function () { try { $("#forfeitBar").hide(); } catch (e) {} cancelCoinForfeit(); });
			$("#forfeitNo").off("click").on("click", function () {
				try { $("#forfeitBar").hide(); } catch (e) {}
				try { dbgLog("cancel: kept session with coins=" + totalCoinReceived); } catch (e) { }
			});
		} catch (e) { cancelCoinForfeit(); }
		return;
	}
	cancelCoinForfeit();
}
function cancelCoinForfeit() {
	var forfeited = totalCoinReceived;
	try { dbgLog("cancel: forfeited coins=" + forfeited); } catch (e) { }
	checkCoinFailStreak = 0;
	topUpGen++;
	clearInterval(timer);
	timer = null;
	insertingCoin = false;
	window.__coinInsertLive = false;
	paintCoinLiveNote();
	window.__useVoucherBusy = false;
	coinToastKey = null;
	sfxStopLoop();
	try { dbgLog("cancel: received=" + totalCoinReceived + " forfeited=" + forfeited); } catch (e) { }
	if (currentTopUpXhr) { try { currentTopUpXhr.abort(); } catch(e){} currentTopUpXhr = null; }
	if (currentCheckCoinXhr) { try { currentCheckCoinXhr.abort(); } catch(e){} currentCheckCoinXhr = null; }
	if (currentUseVoucherXhr) { try { currentUseVoucherXhr.abort(); } catch(e){} currentUseVoucherXhr = null; }
	$("#loaderDiv").attr("class", "spinner hidden");try{$("#paidNote").text("");}catch(e){}
	if (forfeited > 0) {
		$.toast({ title: 'Cancelled', content: 'Coin insertion cancelled — ' + currencySym + forfeited + ' forfeited', type: 'info', delay: 3000 });
	} else {
		$.toast({ title: 'Cancelled', content: 'Coin insertion cancelled', type: 'info', delay: 3000 });
	}
	try { sfxPlayFile("error", snd("assets/sounds/error.mp3"), false, null); } catch (e) { }
	// Always release the ESP slot — including after a forfeit — so the next
	var cancelVc = voucher;
	try { if (window.__cancelVoucher) { cancelVc = window.__cancelVoucher; } } catch (e) {}
	$.ajax({
		type: "POST",
		url: "http://" + vendorIpAddress + "/cancelTopUp",
		timeout: VENDO_TIMEOUT,
		data: { voucher: cancelVc, mac: mac },
		success: function () { $("#loaderDiv").attr("class", "spinner hidden");try{$("#paidNote").text("");}catch(e){} },
		error: function () { $("#loaderDiv").attr("class", "spinner hidden");try{$("#paidNote").text("");}catch(e){} }
	});
	totalCoinReceived = 0;
	// Put the stashed code back. topUp blanked it for a fresh purchase and
	// only restored it on success or retry-exhausted, so cancelling left
	// the box empty and the status view showing a blank voucher until the
	// next reload.
	try {
		if (window.__stashedVoucher) {
			voucher = window.__stashedVoucher;
			window.__stashedVoucher = null;
			$("#voucherInput").val(voucher);
		}
	} catch (e) {}
	render(STATE);
}

function setPortalState(s) {
	STATE = s;
	$("#coinPanel").attr("style", "display: none");
	$("#insertBtn").attr("style", "");
	$("#extendBtn").attr("style", "");
	try { if (typeof trialNoExtend !== "undefined" && trialNoExtend && voucher && voucher.indexOf("T-") === 0) { $("#extendBtn").hide(); } } catch (e) {}
	restoreCoinChrome();
	$("#view-login").attr("style", s == "login" ? "display: block" : "display: none");
	$("#view-status").attr("style", s == "status" ? "display: block" : "display: none");
	$("#view-paused").attr("style", s == "paused" ? "display: block" : "display: none");
	$("#ratesSection").attr("style", "display: block");
	$("#saveVoucherButton").attr('data-save-type', s == "status" ? "extend" : "purchase");
	if (bootDone && (s == "status" || s == "paused") && $("#expirationTime").html() == "") {
		showValidity();
	}
}

// ---------- promo rates (inline section, no modal) ----------

function humanDuration(mins) {
	mins = parseInt(mins || 0, 10);
	if (mins <= 0) { return "—"; }
	if (mins < 60) { return mins + (mins == 1 ? " min" : " mins"); }
	var h = Math.floor(mins / 60);
	if (h < 24) { return h + (h == 1 ? " hour" : " hours"); }
	var d = Math.floor(h / 24);
	return d + (d == 1 ? " day" : " days");
}

function loadRates() {
	$("#ratesBody").html("<p>Loading Wi-Fi rates…</p>");
	return $.ajax({
		type: "GET",
		url: "http://" + vendorIpAddress + "/getRates?date=" + (new Date().getTime()),
		timeout: VENDO_TIMEOUT
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
			$("#ratesBody").html("<p>No Wi-Fi rates configured on this vendo yet.</p>");
			return;
		}
		var html = "<div class='table-responsive'><table class='table table-striped'>";
		html += "<thead><tr><th scope=\"col\">Rate</th><th scope=\"col\">Time</th><th scope=\"col\">Expiry</th>";
		html += "</tr></thead><tbody>";
		for (var r = 0; r < rows.length; r++) {
			if (rows[r] == "") { continue; }
			var c = rows[r].split("#");
			if (c.length < 4 || String(c[0]).trim() == "") { continue; }
			html += "<tr><td>" + escHtml(rateDisplay(c[0], c[1])) + "</td>";
			html += "<td>" + humanDuration(c[2]) + "</td>";
			html += "<td>" + humanDuration(c[3]) + "</td>";
			html += "</tr>";
		}
		html += "</tbody></table></div>";
		$("#ratesBody").html(html);
	}).fail(function (xhr, status, err) {
		// Timeout vs refuse vs HTTP error need different fixes (power,
		// Customer-facing copy stays plain; the machine detail already goes to
		// dbgAjaxErr below for whoever is debugging the box.
		var why = "Rates are unavailable right now.";
		$("#ratesBody").html('<p class="rates-err">' + why + "</p>");
		dbgAjaxErr("getRates", xhr, status, err);
	});
}

function escHtml(s) {
	return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// priceHint is the authoritative price column (rates.data field 1). The name
// normally already carries the number, so output is unchanged for every shipped
// row; the hint only rescues names that do not, e.g. "2-hour promo" scraping
// as 2 when the real price is 5.
// ponytail: kept the scrape rather than adding a column, so today's table is
// byte-identical and only the broken case changes.
function rateDisplay(raw, priceHint) {
	var t = String(raw == null ? "" : raw).trim();
	var m = t.match(/(\d+(?:\.\d+)?)/);
	if (m) { try { return currencySym + new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(parseFloat(m[1])); } catch (e) {} return currencySym + m[1]; }
	if (priceHint != null && String(priceHint).trim() != "") { return rateDisplay(String(priceHint)); }
	return t;
}

// ---------- session resume (login page) ----------

// The pause itself can outlive the code it was holding. The per-MAC session
// file is the only client-side signal that the code still exists: On-Login
// writes it, the expiry scheduler deletes it. Missing / empty / past validity
// = the code is gone and there is nothing left to resume into.
function clearStalePause(msg) {
	try {
		var vc = getActiveVoucher() || voucher;
		if (vc) { removeVouchValue(vc, "remain"); removeVouchValue(vc, "tempValidity"); removeVouchValue(vc, "validity"); }
		removeActiveVoucher();
		removePausedFlag();
		insertingCoin = false;
		voucher = "";
		try { $("#voucherInput").val(""); } catch (e) {}
		if (msg && !getSessionValue("__stalePauseWarned")) {
			try { setSessionValue("__stalePauseWarned", "1"); } catch (e) {}
			$.toast({ title: 'Session ended', content: msg, type: 'warning', delay: 6000 });
		}
	} catch (e) {}
}
function checkStalePause() {
	var d = $.Deferred();
	if (getPausedFlag() != "1") { d.resolve(false); return d.promise(); }
	$.ajax({ type: "GET", url: "/data/" + macNoColon() + ".txt?query=" + new Date().getTime(), timeout: ROUTER_TIMEOUT })
	.done(function (data) {
		var str = String(data == null ? "" : data);
		var hash = str.lastIndexOf("#");
		var fv = (hash < 0 ? str : str.slice(0, hash)).trim();
		var vu = hash < 0 ? null : parseValidity(str.slice(hash + 1));
		var stale = (!fv || vu == null || vu.getTime() < new Date().getTime());
		if (stale) {
			try { dbgLog("stale pause: session file gone, clearing"); } catch (e) {}
			// clearStalePause clears the flag and storage, then render() shows
			// the login view. Order matters: render last, or the paused view
			// is re-painted with a voucher that no longer exists.
			clearStalePause("This session is no longer valid.");
			try { render("login"); } catch (e) {}
		}
		d.resolve(stale);
	})
	.fail(function () { d.resolve(false); });
	return d.promise();
}

function resumeSession() {
	var d = $.Deferred();
	if (typeof STATE !== 'undefined' && STATE != "login") { d.resolve(); return d.promise(); }
	// Router rejection lands back here with loginError set — show it
	// BEFORE the one-shot guard below, or a failed submit (which marks
	if (loginError != "") {
		// A failed RESUME arrives here with the flag still set. Keep it, or a
		// customer who is merely online on another device comes back to an
		// auto-login on the next refresh instead of their paused view.
		var resumePending = false;
		try { resumePending = (getSessionValue("__resumePending") == "1"); } catch (e) {}
		if (!resumePending) { removePausedFlag(); }
		try { removeSessionValue("__resumePending"); } catch (e) {}
		try { markAutoLoginTried(); } catch (e) {}
		var loginErrLower = String(loginError).toLowerCase();
		if (loginErrLower.indexOf("no more sessions") !== -1 || loginErrLower.indexOf("session limit") !== -1 || loginErrLower.indexOf("simultaneous") !== -1) {
			// Code valid but online elsewhere (shared-users=1) — keep it
			try { $('#voucherInput').val(voucher); } catch (e) {}
			try { dbgLog("resume: code in use elsewhere, voucher kept", "dbg-err"); } catch (e) { }
			$.toast({ title: 'In use', content: "This code is online on another device — pause it there or wait 30s, then tap CONNECT to retry", type: 'warning', delay: 8000 });
		} else if (loginErrLower.indexOf("uptime limit") !== -1) {
			removeActiveVoucher();
			voucher = "";
			try { dbgLog("resume: uptime exhausted, voucher cleared", "dbg-err"); } catch (e) { }
			$.toast({ title: 'Expired', content: "This code has used up all its time", type: 'error', delay: 5000 });
		} else if (loginErrLower.indexOf("invalid username or password") !== -1 || loginErrLower.indexOf("wrong password") !== -1) {
			// The box writes the new user to the router over telnet and
			// never reads the reply, so a code it just minted can be
			// rejected for a second or two. Retry once before believing it.
			try {
				var retried = getSessionValue("__loginRetry");
				if (voucher && retried !== "1") {
					setSessionValue("__loginRetry", "1");
					try { dbgLog("resume: bad credentials, retrying once in 1.5s"); } catch (e) { }
					// ponytail: this called val(voucher), which is defined nowhere in
					// the repo. The ReferenceError was swallowed and the retry ran off
					// the setTimeout below regardless, so it never did anything.
					$.toast({ title: 'Checking your code', content: "One moment while the Wi-Fi confirms your code", type: 'info', delay: 4000 });
					setTimeout(function () {
						try { clearAutoLoginTried(); } catch (e) { }
						try { doLogin(); } catch (e) { }
					}, 1500);
					d.resolve();
					return d.promise();
				}
				removeSessionValue("__loginRetry");
			} catch (e) { }
			try { dbgLog("resume: bad credentials, giving up", "dbg-err"); } catch (e) { }
			$.toast({ title: 'Login failed', content: "Wrong username or password — check and try again", type: 'error', delay: 5000 });
		} else {
			removeActiveVoucher();
			voucher = "";
			try { dbgLog("resume: rejected by loginError, voucher cleared", "dbg-err"); } catch (e) { }
			$.toast({ title: 'Error', content: "Invalid voucher, please make sure voucher is valid", type: 'error', delay: 5000 });
		}
		d.resolve();
		return d.promise();
	}
	// One-shot per tab: a reload after a failed submit lands back here
	try {
		if (autoLoginTried()) {
			dbgLog("resume: already tried this tab, skipping auto-login");
			d.resolve();
			return d.promise();
		}
	} catch (e) {}
	// Paused: never auto-connect. The customer chose to stop, and auto-login
	// here is exactly what made every refresh resurrect the session.
	if (getPausedFlag() == "1") {
		try { dbgLog("resume: paused, skipping auto-login"); } catch (e) {}
		d.resolve();
		return d.promise();
	}
	if ($("#voucherInput").length > 0) {
		$.ajax({ type: "GET", url: "/data/" + macNoColon() + ".txt?query=" + new Date().getTime(), timeout: ROUTER_TIMEOUT })
		.done(function (data) {
			// Split on the LAST "#" — member names may contain "#",
			var str = String(data);
			var hash = str.lastIndexOf("#");
			var fileVoucher = (hash < 0 ? str : str.slice(0, hash)).trim();
			var validUntil = hash < 0 ? null : parseValidity(str.slice(hash + 1));
				// Stale session file (empty, dateless, or expired voucher):
				if (fileVoucher == "" || validUntil == null || validUntil.getTime() < new Date().getTime()) {
					removeActiveVoucher();
					try { dbgLog("resume: stale session file, skipping auto-connect"); } catch (e) { }
					d.resolve();
					return;
				}
			voucher = fileVoucher;
			$('#voucherInput').val(voucher);
			try { dbgLog("resume: auto-connect queued len=" + fileVoucher.length); } catch (e) { }
				try { markAutoLoginTried(); } catch (e) {}
				queueAutoLogin(function () { $("#connectBtn").click(); });
			})
			.always(function () { d.resolve(); });
	} else {
		d.resolve();
	}
	return d.promise();
}

// ---------- validity (status / logout pages) ----------

function parseValidity(raw) {
	// Invalid dates come back null (never Invalid Date) — callers render
	raw = String(raw == null ? "" : raw);
	if (raw.length == 0) { return null; }
	if (raw.length > 15) { return parsedDate(Date.parse(raw)); }
	var dt = raw.split(" ");
	var now = new Date();
	if (dt.length >= 2) {
		// "MM/DD HH:MM(:SS)" carries no year. Picking the current year read
		// every code as valid for ~a year across New Year, which let the
		// staleness gate in resumeSession auto-login a dead code. Test the
		// three plausible years and keep the one closest to now — the truth is
		// always the nearest, since a code is never more than a year out.
		var best = null, bestDist = Infinity;
		for (var y = now.getFullYear() - 1; y <= now.getFullYear() + 1; y++) {
			var c = parsedDate(Date.parse(dt[0] + "/" + y + " " + dt[1]));
			if (!c) { continue; }
			var dist = Math.abs(c.getTime() - now.getTime());
			if (dist < bestDist) { bestDist = dist; best = c; }
		}
		return best;
	}
	return parsedDate(Date.parse((now.getMonth() + 1) + "/" + now.getDate() + "/" + now.getFullYear() + " " + raw));
}
function parsedDate(ms) {
	var d = new Date(ms);
	return (d instanceof Date && isFinite(d.getTime())) ? d : null;
}

function renderExpiration(html) {
	$("#expirationTime").html(html);
	$("#expirationTimePaused").html(html);
}

function formatExpiryLeft(t) {
	var diff = t.getTime() - new Date().getTime();
	if (diff <= 0) { return "expired"; }
	var mins = Math.floor(diff / 60000);
	if (mins < 1) { return "less than a minute left"; }
	if (mins < 90) { return mins + (mins == 1 ? " min left" : " mins left"); }
	var hours = Math.floor(mins / 60);
	if (hours < 48) { return hours + (hours == 1 ? " hour left" : " hours left"); }
	var days = Math.floor(hours / 24);
	return days + (days == 1 ? " day left" : " days left");
}

// Status-boot stale check: the per-MAC session file should name the same
// voucher the router reports. Mismatch = stale neighbour code — drop its
function validateStatusVoucher() {
	var d = $.Deferred();
	// Paused: the file voucher's remain/validity are what RESUME needs. This
	// check would wipe them whenever the file names a different code.
	if (getPausedFlag() == "1") { d.resolve(); return d.promise(); }
	$.ajax({ type: "GET", url: "/data/" + macNoColon() + ".txt?query=" + new Date().getTime(), timeout: ROUTER_TIMEOUT })
	.done(function (data) {
		try {
			var str = String(data);
			var hash = str.lastIndexOf("#");
			var fv = (hash < 0 ? str : str.slice(0, hash)).trim();
			if (fv && fv !== voucher) {
				removeVouchValue(fv, "remain");
				removeVouchValue(fv, "tempValidity");
				removeVouchValue(fv, "validity");
				dbgLog("status-boot: stale file voucher cleared");
			}
		} catch (e) {}
		d.resolve();
	})
	.fail(function () { d.resolve(); });
	return d.promise();
}

function showValidity() {
	var d = $.Deferred();
	$.ajax({ type: "GET", url: "/data/" + macNoColon() + ".txt?query=" + new Date().getTime(), timeout: ROUTER_TIMEOUT })
		.done(function (data) {
			// Body is "$user#$validity". The old 50-char cap threw away the
			// real expiry for any member name of 30+ chars (52 total) and the
			// two sibling parsers had no cap at all. 300 still catches a router
			// error page while never touching a real session file.
			if (String(data == null ? "" : data).length > 300) {
				try { dbgLog("validity: long body, fallback"); } catch (e) { }
				if (fallbackValidity()) { d.resolve(); } else { d.reject(); }
				return;
			}
		var str = String(data);
		var hash = str.lastIndexOf("#");
		var t = hash < 0 ? null : parseValidity(str.slice(hash + 1));
		if (t == null) {
			try { dbgLog("validity: unparseable, No expiry"); } catch (e) { }
			renderExpiration("No expiry");
			d.resolve();
			return;
		}
		try { dbgLog("validity: file " + t.toLocaleString()); } catch (e) { }
		renderExpiration(formatExpiryLeft(t));
		d.resolve();
		})
		.fail(function () {
			try { dbgLog("validity: fetch failed, fallback"); } catch (e) { }
			if (fallbackValidity()) { d.resolve(); } else { d.reject(); } });
	return d.promise();
}

function fallbackValidity() {
	var validity = getVouchValue(voucher, "validity");
	if (validity != null) {
		var t = new Date(parseInt(validity, 10));
		if (!isFinite(t.getTime())) {
			removeVouchValue(voucher, "validity");
			removeVouchValue(voucher, "tempValidity");
			renderExpiration("—");
			return false;
		}
		if (t.getTime() < new Date().getTime()) {
			removeVouchValue(voucher, "validity");
			removeVouchValue(voucher, "tempValidity");
			renderExpiration("—");
			return false;
		}
		renderExpiration(formatExpiryLeft(t));
		return true;
	}
	renderExpiration("—");
	return false;
}

// ---------- coin flow ----------

// Coin-session generation: bumped on every fresh insert AND every cancel.
// topUp retries captured an old generation never fire — without this a
var topUpGen = 0;
function insertBtnAction() {
	// No double-submit: one coin session at a time (second tap = busy error).
	if (insertingCoin) { return false; }
	topUpGen++;
	// Fresh session, fresh fail budget. Without this the streak left over from
	// a previous give-up trips the >=8 stop on the FIRST poll of the new
	// insert, and the ===5 warning can never re-arm.
	checkCoinFailStreak = 0;
	insertingCoin = true;
	// Arms the beforeunload guard for the whole insert, including the wait
	// before the ESP reports anything. Cleared by every exit below.
	window.__coinInsertLive = true;
	paintCoinLiveNote();
	try { dbgLog("guard: armed (coin insert live)"); } catch (e) { }
	coinToastKey = null;
	$("#saveVoucherButton").attr('data-save-type', STATE == "status" ? "extend" : "purchase");
	try { dbgLog("insert: type=" + $("#saveVoucherButton").attr('data-save-type') + " page=" + PAGE); } catch (e) { }
	$("#progressDiv").css('width', '100%');
	$("#progressDiv").attr("aria-valuenow", 100).attr("aria-valuetext", "Waiting for coins");
	$("#progressDiv").removeClass("time-half time-low").addClass("time-ok");
	// Caption the track instead of blanking it: an empty 38px bar with no
	// text reads as a broken widget.
	$("#progressLabel").text("Confirming purchase…");
	$("#saveVoucherButton").prop('disabled', true);
	$("#cncl").prop('disabled', false);
	$("#loaderDiv").attr("class", "spinner");try{$("#paidNote").text("Confirming purchase…");}catch(e){}
	try { closeHistoryView(); } catch (e) {}
	totalCoinReceived = 0;
	$('#totalCoin').text("0");
	$('#totalTime').html(secondsToDhms(0));

	if ($("#saveVoucherButton").attr('data-save-type') != "extend" && PAGE === "login") {
		$.ajax({
			type: "GET",
			url: "/status",
			timeout: ROUTER_TIMEOUT,
			success: function (data) {
				// String() + try: a non-string body made indexOf throw, which
				// left insertingCoin stuck true and Done permanently disabled.
				var probe = "";
				try { probe = String(data == null ? "" : data); } catch (e) { probe = ""; }
				if (probe.indexOf("IAMNOTLOGINSTRINGPLEASEDONTREMOVE") < 0) {
					try { dbgLog("insert: already logged in, bouncing to status"); } catch (e) { }
					window.__internalNav = true;
					location.reload();
				} else {
					callTopupAPI(0);
				}
			},
			error: function () {
				try { dbgLog("insert: status probe failed, topping up"); } catch (e) { }
				callTopupAPI(0);
			}
		});
	} else {
		callTopupAPI(0);
	}
	return false;
}

// Failed fresh topUp: hand the stashed code back so cancelTopUp and
function restoreStashedVoucher() {
	try {
		if (window.__stashedVoucher) {
			voucher = window.__stashedVoucher;
			setActiveVoucher(voucher);
			if (!$("#voucherInput").val()) { $("#voucherInput").val(voucher); }
			window.__stashedVoucher = null;
		}
	} catch (e) {}
}
function callTopupAPI(retryCount, gen) {
	if (typeof gen === 'undefined') { gen = topUpGen; }
	// Stale generation (cancelled/superseded while in flight): never retry.
	if (gen !== topUpGen) { return; }
	$('#cncl').html("Cancel");
	var isExtend = $("#saveVoucherButton").attr('data-save-type') == "extend";
	try { dbgLog("topUp start retry=" + retryCount + " extend=" + (isExtend ? "1" : "0")); } catch (e) { }

	// With MAC-as-voucher the pre-fill IS the code being bought, so it
	// must survive a fresh insert - otherwise the topUp posts an empty
	// voucher and the box mints a random code again.
	if (retryCount === 0 && !isExtend && totalCoinReceived == 0 && !macAsVoucherCode) {
		var storedVoucher = getActiveVoucher();
		if (storedVoucher != null) {
			// Stash, don't wipe: the fresh post still sends voucher:"",
			try { window.__stashedVoucher = storedVoucher; } catch (e) {}
			voucher = "";
			$("#voucherInput").val('');
		}
	}

	if (currentTopUpXhr) { try { currentTopUpXhr.abort(); } catch(e){} }
	currentTopUpXhr = $.ajax({
		type: "POST",
		url: "http://" + vendorIpAddress + "/topUp",
		timeout: VENDO_TIMEOUT,
		data: { voucher: voucher, mac: mac, extendTime: (isExtend ? "1" : "0") },
		complete: function(){ currentTopUpXhr = null; },
		success: function (data) {
			$("#loaderDiv").attr("class", "spinner hidden");try{$("#paidNote").text("");}catch(e){}
			try { dbgLog("topUp ok voucher=" + (data && data.voucher ? data.voucher : "?"), "dbg-ok"); } catch (e) { }
		if (gen !== topUpGen) { return; }
		if (data.status == "true") {
			try { window.__stashedVoucher = null; } catch (e) {}
			voucher = data.voucher;
			setActiveVoucher(voucher);
			// Pin the voucher for cancelTopUp: the global gets cleared on
			try { window.__cancelVoucher = data.voucher; } catch (e) {}
				showCoinPanel();
				insertingCoin = true;
				$('#codeGenerated').text(voucher);
				if (timer == null) {
					timer = setInterval(checkCoin, 1000);
				}
				if (isMultiVendo) {
					// The picker is only populated in manual mode; in the
					// auto modes its selected option text is empty and the
					// old unconditional read left a dangling "on ".
					var vname = "";
					try { vname = String($("#vendoSelected option:selected").text() || "").trim(); } catch (e) {}
					$("#coinPanelTitle").text(vname ? ("Please insert coins on " + vname) : "Please insert coins");
				}
				sfxStartLoop();
			} else {
				// A stale slot (someone walked away mid-purchase) makes the
				// box reject every later topUp. Releasing the pinned code
				// lets its own wait timer close, so try again once.
				if (data.errorCode == "coinslot.busy" && retryCount === 0) {
					try { dbgLog("topUp: slot busy, releasing and retrying"); } catch (e) { }
					releaseCoinSlot(function () {
						setTimeout(function () {
							if (gen !== topUpGen) { return; }
							callTopupAPI(1, gen);
						}, 1200);
					});
					return;
				}
				try { dbgLog("topUp rejected errorCode=" + data.errorCode, "dbg-err"); } catch (e) { }
				// ponytail: the retry-exhausted branch below hides the loader but this
				// plain-reject path did not, leaving a full-screen opaque cover with
				// reload as the only exit. Keep the two branches consistent.
				try { $("#loaderDiv").attr("class", "spinner hidden"); try { $("#paidNote").text(""); } catch (e) { } } catch (e) { }
				notifyCoinSlotError(data.errorCode);
				clearInterval(timer);
				timer = null;
				insertingCoin = false;
				// No slot was ever opened on this path (coin.slot.banned and the
				// other /topUp rejects), so nothing is at stake and the unload
				// guard must stand down too. Otherwise a customer who taps
				// INSERT COIN while banned is asked to confirm every later
				// navigation for a coin session that never started.
				window.__coinInsertLive = false;
				try { paintCoinLiveNote(); } catch (e) {}
				restoreStashedVoucher();
			}
	}, error: function (xhr, status, err) {
		// Generation-checked: a cancel during the 1s wait kills the retry.
		dbgAjaxErr("topUp retry=" + retryCount, xhr, status, err);
		setTimeout(function () {
			if (gen !== topUpGen) { return; }
			if (retryCount < 3) {
				callTopupAPI(retryCount + 1, gen);
			} else {
					$("#loaderDiv").attr("class", "spinner hidden");try{$("#paidNote").text("");}catch(e){}
					notifyCoinSlotError("coin.slot.notavailable");
					insertingCoin = false;
					// Same as the plain-reject branch: the slot never opened, so
					// the guard stands down with insertingCoin.
					window.__coinInsertLive = false;
					try { paintCoinLiveNote(); } catch (e) {}
					restoreStashedVoucher();
				}
			}, 1000);
		}
	});
}

var currentUseVoucherXhr = null;
function saveVoucherBtnAction() {
	// Entry guard: Done double-tap and the wait-expiry auto-finalize used
	if (window.__useVoucherBusy) { return; }
	window.__useVoucherBusy = true;
	paintCoinStage();
	// Snapshot the slot total BEFORE anything can clear it: the poll and the
	// POST race, and "did the customer pay" must not be read afterwards.
	var paidCoins = totalCoinReceived;
	$("#saveVoucherButton").prop('disabled', true);
	$("#cncl").prop('disabled', true);
	$("#loaderDiv").attr("class", "spinner");try{$("#paidNote").text("Confirming purchase…");}catch(e){}
	try { closeHistoryView(); } catch (e) {}
	setActiveVoucher( voucher);
	try { dbgLog("useVoucher start type=" + $("#saveVoucherButton").attr('data-save-type')); } catch (e) { }
	$('#voucherInput').val(voucher);

	clearInterval(timer);
	timer = null;
	sfxStopLoop();
	// Kill the poll too. A queued /checkCoin can land after this POST and its
	// coinslot.busy branch closes the panel + re-enables an auto-login that
	// races the login the success path is about to schedule.
	if (currentCheckCoinXhr) { try { currentCheckCoinXhr.abort(); } catch (e) {} currentCheckCoinXhr = null; }
	if (currentUseVoucherXhr) { try { currentUseVoucherXhr.abort(); } catch(e){} }
	currentUseVoucherXhr = $.ajax({
		type: "POST",
		url: "http://" + vendorIpAddress + "/useVoucher",
		// ponytail: useVoucher is the one endpoint that can exceed VENDO_TIMEOUT.
		// It does two blocking telnet round-trips inside the request
		// (registerNewVoucher + addTimeToVoucher), so on a slow MikroTik it timed
		// out and told the customer the coin was processed when the router may
		// never have received the command. Only this call gets the longer budget;
		// the rest stay at 5000.
		timeout: 10000,
		data: { voucher: voucher },
		complete: function(){ currentUseVoucherXhr = null; },
		success: function (data) {
			totalCoinReceived = 0;
			insertingCoin = false;
			window.__useVoucherBusy = false;
			window.__cancelVoucher = null;
			$("#loaderDiv").attr("class", "spinner hidden");try{$("#paidNote").text("");}catch(e){}
			try { dbgLog("useVoucher resp " + JSON.stringify(data).slice(0, 200), (data && data.status == "true") ? "dbg-ok" : "dbg-err"); } catch (e) { }
		if (data.status == "true") {
			setVouchValue(voucher, "tempValidity", data.validity);
			try { sfxPlayFile("success", snd("assets/sounds/success.mp3"), false, null); } catch (e) { }
			$.toast({ title: 'Success', content: 'Thank you for the purchase!, will do auto login shortly', type: 'success', delay: 3000 });
			autoLoginAfterUseVoucher();
		} else if (data.errorCode == "coinslot.busy" && paidCoins > 0) {
			// Lost the race with the ESP wait-expiry: the vendo already
			// registered the voucher and added the time itself (then cleared
			if (data.validity) { setVouchValue(voucher, "tempValidity", data.validity); }
			try { sfxPlayFile("success", snd("assets/sounds/success.mp3"), false, null); } catch (e) { }
			$.toast({ title: 'Success', content: 'Thank you for the purchase!, will do auto login shortly', type: 'success', delay: 3000 });
			autoLoginAfterUseVoucher();
		} else {
			notifyCoinSlotError(data.errorCode);
			// Release both locks or Done + Insert stay bricked till reload.
			insertingCoin = false;
			window.__useVoucherBusy = false;
			$("#loaderDiv").attr("class", "spinner hidden");try{$("#paidNote").text("");}catch(e){}
			$("#saveVoucherButton").prop('disabled', false);
			$("#cncl").prop('disabled', false);
		}
		}, error: function (jqXHR, status, err) {
			if (status === "abort") { window.__useVoucherBusy = false; return; }
			insertingCoin = false;
			window.__useVoucherBusy = false;
			$("#loaderDiv").attr("class", "spinner hidden");try{$("#paidNote").text("");}catch(e){}
			$("#saveVoucherButton").prop('disabled', false);
			$("#cncl").prop('disabled', false);
			dbgAjaxErr("useVoucher", jqXHR, status, err);
			if (status === "timeout") {
				$.toast({ title: 'Error', content: 'ESP unreachable — check that the vendo is powered on and WiFi connected', type: 'error', delay: 5000 });
			} else if (paidCoins > 0) {
				$.toast({ title: 'Warning', content: 'Connect/Login failed, however coin has been process, please manually connect using this voucher: ' + voucher, type: 'info', delay: 8000 });
			}
		}
	});
}

function autoLoginAfterUseVoucher() {
	if ($("#saveVoucherButton").attr('data-save-type') == "extend") {
		// A reload alone keeps the same router session, whose
		// time-left never picks up the extended limit. End the
		try { dbgLog("autoLogin: extend path, ending session"); } catch (e) { }
		setReLoginFlag();
		setTimeout(function () {
			try { document.logout.submit(); }
			catch (e) { location.reload(); }
		}, 3000);
	} else {
		try { dbgLog("autoLogin: purchase path, doLogin in 3s"); } catch (e) { }
		setTimeout(function () {
			try { doLogin(); } catch (e) { newLogin(); }
		}, 3000);
	}
}

var checkCoinFailStreak = 0;
var currentTopUpXhr = null;
var currentCheckCoinXhr = null;
var coinToastKey = null;
function coinToastOnce(key, opts) {
	if (coinToastKey === key) { return false; }
	coinToastKey = key;
	try { dbgLog("coin notice: " + key); } catch (e) { }
	try { $.toast(opts); } catch (e) { }
	return true;
}
function checkCoin() {
	// Skip the tick while a poll is still in flight — aborting it can kill
	// the very response carrying status:true/newCoin (ESP is single-threaded
	if (currentCheckCoinXhr) { return; }
	currentCheckCoinXhr = $.ajax({
		type: "POST",
		url: "http://" + vendorIpAddress + "/checkCoin",
		timeout: VENDO_TIMEOUT,
		data: { voucher: voucher },
		success: function (data) {
			checkCoinFailStreak = 0;
			if (data.status == "true") {
			try { dbgLog("checkCoin COIN +" + data.newCoin + " total=" + data.totalCoin + " timeAdded=" + data.timeAdded + "s", "dbg-ok"); } catch (e) { }
			totalCoinReceived = (isFinite(parseInt(data.totalCoin, 10)) ? parseInt(data.totalCoin, 10) : 0);
			paintCoinLiveNote();
			$('#totalCoin').text(data.totalCoin);
			$('#totalTime').html(secondsToDhms(parseInt(data.timeAdded, 10)));
			$('#voucherInput').val(voucher);
			setActiveVoucher( voucher);
			setVouchValue(voucher, "tempValidity", data.validity);
				try { $("#progressLabel").text("Coins received"); } catch (e) {}
				try { $("#progressDiv").attr("aria-valuetext", "Coins received"); } catch (e) {}
				paintCoinStage();
				notifyCoinSuccess(data.newCoin);
			} else if (data.errorCode == "coin.not.inserted") {
				setVouchValue(voucher, "tempValidity", data.validity);
				var remainTime = parseInt(parseInt(data.remainTime, 10) / 1000, 10);
				var waitTime = parseFloat(data.waitTime);
				// Clamped 0-100: waitTime=0 used to yield Infinity% width.
				var percent = (!isFinite(remainTime) || !isFinite(waitTime) || waitTime <= 0) ? 0 :
					Math.max(0, Math.min(100, parseInt(((remainTime * 1000) / waitTime) * 100, 10)));
			// NaN totalCoin used to make cancelCoin() skip the forfeit warning
			// and silently throw away money the customer had already inserted.
			totalCoinReceived = (isFinite(parseInt(data.totalCoin, 10)) ? parseInt(data.totalCoin, 10) : 0);
			paintCoinLiveNote();
			if (totalCoinReceived > 0) {
				$("#saveVoucherButton").prop('disabled', false);
				$('#voucherInput').val(voucher);
				paintCoinStage();
			}
				if (remainTime == 0) {
					if (totalCoinReceived > 0) {
						// Wait ran out with money in: finalize the purchase the
						try { dbgLog("checkCoin: wait expired with coins=" + totalCoinReceived + ", auto-finalizing", "dbg-ok"); } catch (e) { }
						$.toast({ title: 'Time is up', content: 'Confirming your purchase of ' + totalCoinReceived + ' peso(s)…', type: 'info', delay: 4000 });
						$("#saveVoucherButton").prop('disabled', true);
						$("#cncl").prop('disabled', true);
						saveVoucherBtnAction();
					} else {
						try { dbgLog("checkCoin: wait expired, no coins", "dbg-err"); } catch (e) { }
						notifyCoinSlotError('coins.wait.expired');
					}
				} else {
					$('#totalCoin').text(data.totalCoin);
					$('#totalTime').html(secondsToDhms(parseInt(data.timeAdded, 10)));
					var bar = $("#progressDiv");
					// Width was already clamped; the label was not, so a missing
					// remainTime painted a literal "NaNs" and read it out.
					var dispRemain = (isFinite(remainTime) ? remainTime : 0);
					bar.css('width', percent + '%');
					bar.attr('aria-valuenow', percent);
					bar.attr('aria-valuetext', dispRemain + ' seconds remaining');
					bar.removeClass("time-ok time-half time-low");
					bar.addClass(percent > 50 ? "time-ok" : (percent >= 25 ? "time-half" : "time-low"));
					$("#progressLabel").text(dispRemain + "s");
				}
			} else if (data.errorCode == "coinslot.busy") {
				closeCoinModal();
				if (totalCoinReceived == 0) {
					try { dbgLog("checkCoin: slot cleared, no coins", "dbg-err"); } catch (e) { }
					notifyCoinSlotError("coinslot.cancelled");
				} else {
					try { dbgLog("checkCoin: slot cleared with coins=" + totalCoinReceived + ", auto-login", "dbg-ok"); } catch (e) { }
					$.toast({ title: 'Success', content: 'Coin slot cancelled!, but was able to succesfully process the coin ' + totalCoinReceived + ", will do auto login shortly", type: 'info', delay: 5000 });
					setTimeout(autoLoginAfterCoin, 3000);
				}
			} else if (data.errorCode == "coin.is.reading") {
				// Transient: coin pulse is being verified on the ESP.
				coinToastOnce("reading", { title: 'Verifying coin', content: 'Verifying coin, please wait..', type: 'info', delay: 2500 });
			} else {
				coinToastKey = null;
				try { dbgLog("checkCoin end errorCode=" + data.errorCode, "dbg-err"); } catch (e) { }
				notifyCoinSlotError(data.errorCode);
				clearInterval(timer);
				timer = null;
				// Only stand down when there is nothing left to lose. Clearing
				// this with coins still in the slot disarms the beforeunload
				// guard, so a swipe-refresh would void them with no prompt.
				if (totalCoinReceived <= 0) {
					insertingCoin = false;
					// Same pairing: the guard is what protects a live coin
					// session, so it follows insertingCoin down. Left armed,
					// a customer whose ESP reports coin.slot.banned (or any
					// terminal code) is prompted to confirm every later
					// navigation for a slot that holds nothing.
					window.__coinInsertLive = false;
					try { paintCoinLiveNote(); } catch (e) {}
				}
			}
		}, error: function (xhr, status, err) {
			if (status === "abort") return;
			checkCoinFailStreak++;
			dbgAjaxErr("checkCoin streak=" + checkCoinFailStreak, xhr, status, err);
			if (checkCoinFailStreak === 5) {
				coinToastOnce("unreachable", { title: 'Connection lost', content: 'ESP unreachable — check power & WiFi, then tap Cancel to retry.', type: 'warning', delay: 4000 });
			}
			// Give up instead of polling forever with insertingCoin stuck:
			if (checkCoinFailStreak >= 8) {
				clearInterval(timer);
				timer = null;
				// Same reasoning as the branch above: stay armed while coins sit
				// in the slot so beforeunload still asks before they are lost.
				if (totalCoinReceived <= 0) {
					insertingCoin = false;
					window.__coinInsertLive = false;
					try { paintCoinLiveNote(); } catch (e) {}
				}
				notifyCoinSlotError("coin.slot.notavailable");
			}
		},
		complete: function(){ currentCheckCoinXhr = null; }
	});
}

function closeCoinModal() {
	document.body.classList.remove("coin-live");
	window.__coinInsertLive = false;
	paintCoinLiveNote();
	sfxStopLoop();
	coinToastKey = null;
	clearInterval(timer);
	timer = null;
	insertingCoin = false;
	window.__useVoucherBusy = false;
	window.__cancelVoucher = null;
	paintCoinStage();
	render(STATE);
}

function autoLoginAfterCoin() {
	window.__coinInsertLive = false;
	paintCoinLiveNote();
	try { dbgLog("autoLoginAfterCoin: type=" + $("#saveVoucherButton").attr('data-save-type')); } catch (e) { }
	if ($("#saveVoucherButton").attr('data-save-type') == "extend") {
		setReLoginFlag();
		document.logout.submit();
	} else {
		newLogin();
	}
}

function newLogin() {
	try { dbgLog("newLogin: reload"); } catch (e) { }
	location.reload();
}

// ---------- pause / resume ----------

function pause() {
	var vc = getActiveVoucher();
	// PAUSE tears the coin flow down below (poll stopped, XHRs aborted, coins
	// zeroed), so the unload guard must come off with it -- otherwise every
	// later navigation asks to leave and PAUSE looks broken.
	window.__coinInsertLive = false;
	paintCoinLiveNote();
	try { if (window.__logoutTimer) { clearTimeout(window.__logoutTimer); window.__logoutTimer = null; } } catch (e) {}
	setPausedFlag();
	// Store seconds, not markup: the old code saved $("#remainTime").html()
	setVouchValue(vc, "remain", String(window.__remainSecs == null ? -1 : window.__remainSecs));
	try { dbgLog("pause: remain saved"); } catch (e) { }
	// A coin session must not outlive the pause. Left running, the poll keeps
	// ticking against a hidden panel and the wait-expiry branch auto-finalizes
	// into a login the customer never asked for — silent re-charge.
	try { clearInterval(timer); timer = null; } catch (e) {}
	try { if (currentCheckCoinXhr) { currentCheckCoinXhr.abort(); currentCheckCoinXhr = null; } } catch (e) {}
	try { if (currentTopUpXhr) { currentTopUpXhr.abort(); currentTopUpXhr = null; } } catch (e) {}
	try { if (currentUseVoucherXhr) { currentUseVoucherXhr.abort(); currentUseVoucherXhr = null; } } catch (e) {}
	// ponytail: abort() stops the in-flight request but not the topUp retry
	// ladder's setTimeout, and nothing bumped the generation here, so a retry
	// could still pass the gen check and reopen the coin panel behind the
	// paused veil, stranding RESUME. Same guard cancelCoinForfeit uses.
	topUpGen++;
	try { sfxStopLoop(); } catch (e) {}
	try { window.__useVoucherBusy = false; } catch (e) {}
	if (totalCoinReceived > 0) {
		totalCoinReceived = 0;
		try { $.toast({ title: 'Coins not processed', content: 'Your inserted coins were not used. Tap INSERT COIN to try again.', type: 'warning', delay: 5000 }); } catch (e) {}
	}
	insertingCoin = true;
	render("paused");
	// End the router session in the background without navigating, so no
	// reload can win the race and bounce the client back to status. A
	try {
		var pauseCtl = null;
		try { pauseCtl = new AbortController(); setTimeout(function () { try { pauseCtl.abort(); } catch (e) {} }, 5000); } catch (e) { pauseCtl = null; }
		fetch(document.logout.action, { method: "GET", cache: "no-store", signal: pauseCtl ? pauseCtl.signal : undefined })
			.then(function (r) { if (!r || !r.ok) { throw new Error("logout-http"); } })
			.catch(function () {
				// The router session is still live, so the pause never took.
				// Forget the flag here or the next refresh would strand the
				// customer on a paused view for a session that is still up.
				try {
					removePausedFlag();
					insertingCoin = false;
					render("status");
					$.toast({ title: 'Error', content: 'Pause failed — still connected, please try again', type: 'error', delay: 4000 });
				} catch (e) { try { document.logout.submit(); } catch (e2) {} }
			});
	} catch (e) { document.logout.submit(); }
}

function resume() {
	var vc = getActiveVoucher() || voucher;
	try { dbgLog("resume: " + (vc ? "relogin len=" + vc.length : "no voucher, reload")); } catch (e) { }
	insertingCoin = false;
	// Keep the flag until the router rules on the code: dropping it first
	// made a failed RESUME land on the login view with the pause forgotten,
	// and the next refresh would auto-login anyway.
	if (!vc) { removePausedFlag(); location.reload(); return; }
	voucher = vc;
	setActiveVoucher( vc);
	$('#voucherInput').val(vc);
	try { setSessionValue("__resumePending", "1"); } catch (e) {}
	doLogin();
}

function notifyCoinSlotError(errorCode) {
	try { dbgLog("portal error: " + (errorCodeMap[errorCode] || ("Request failed (" + errorCode + ")")), "dbg-err"); } catch (e) { }
	try {
		sfxPlayFile("error", snd("assets/sounds/error.mp3"), false, null);
	} catch (e) { }
	var coinMsg = errorCodeMap[errorCode] || ('Request failed (' + errorCode + '), please try again');
	try {
		$("#coinErr").text(coinMsg).show();
		// Only move focus when the coin panel is actually on screen, or the
		// focus lands on a hidden div and the customer gets nothing.
		var cp = $("#coinPanel");
		if (cp && cp.is(":visible")) { $("#coinErr").focus(); }
	} catch (e) {}
	$.toast({ title: 'Error', content: coinMsg, type: 'error', delay: 5000 });
}

function notifyCoinSuccess(coin) {
	// checkCoin polls every second and the ESP may repeat status:true for
	if (coinToastOnce("coin-" + totalCoinReceived, { title: 'Coin inserted', content: coin + ' peso(s) was inserted', type: 'success', delay: 2000 })) {
		coinBlip();
	}
}

function notifyConvertFail(errorCode) {
	var msg = errorCodeMap[errorCode] || "That code could not be added";
	try { $("#coinErr").text(msg).show(); } catch (e) {}
	try { $.toast({ title: "Code not added", content: msg, type: "error", delay: 5000 }); } catch (e) {}
}

// Fold a second voucher's remaining minutes into the session the coin box
// already has open. The box does the arithmetic, so this only works on
// builds that expose /convertVoucher.
function convertVoucherAction() {
	var vc = "";
	try { vc = String($("#convertVoucherCode").val() || "").trim(); } catch (e) {}
	if (!vc) { notifyConvertFail("convertVoucher.empty"); return; }
	if (!voucher) { notifyConvertFail("convertVoucher.nosession"); return; }
	var btn = null;
	try { btn = $("#convertBtn"); btn.prop("disabled", true); } catch (e) {}
	$.ajax({
		type: "POST",
		url: "http://" + vendorIpAddress + "/convertVoucher",
		data: "voucher=" + encodeURIComponent(voucher) + "&convertVoucher=" + encodeURIComponent(vc),
		dataType: "text",
		timeout: VENDO_TIMEOUT
	}).done(function (txt) {
		try { if (btn) btn.prop("disabled", false); } catch (e) {}
		try { $("#convertVoucherCode").val(""); } catch (e) {}
		var ok = false;
		try { var d = JSON.parse(String(txt || "")); ok = (d && d.status === "true"); } catch (e) {}
		if (ok) {
			try { $.toast({ title: "Code added", content: "That code's time is now on your session", type: "success", delay: 3500 }); } catch (e) {}
		} else {
			notifyConvertFail("convertVoucher.refused");
		}
	}).fail(function (xhr) {
		try { if (btn) btn.prop("disabled", false); } catch (e) {}
		try { $("#convertVoucherCode").val(""); } catch (e) {}
		try { dbgLog("convertVoucher failed status=" + (xhr && xhr.status), "dbg-err"); } catch (e) {}
		// A 404 or a blank body means the box has no /convertVoucher route
		// at all. Never report that as a bad code - the customer's code may
		// be perfectly good and the box simply cannot merge.
		var body = "";
		try { body = String((xhr && xhr.responseText) || ""); } catch (e) {}
		var missing = !xhr || xhr.status === 404 || xhr.status === 0 || !body.trim();
		notifyConvertFail(missing ? "convertVoucher.unsupported" : "convertVoucher.refused");
	});
}

function secondsToDhms(seconds) {
	seconds = Number(seconds);
	if (!isFinite(seconds) || seconds <= 0) { return "—"; }
	seconds = Math.max(0, seconds);
	var mins = Math.floor(seconds / 60);
	if (mins < 1) { return "less than a minute"; }
	if (mins < 60) { return mins + (mins == 1 ? " min" : " mins"); }
	var hours = Math.floor(mins / 60);
	var remMins = mins % 60;
	if (hours < 48) {
		var hTxt = hours + (hours == 1 ? " hour" : " hours");
		if (remMins == 0) { return hTxt; }
		return hTxt + " and " + remMins + (remMins == 1 ? " min" : " mins");
	}
	var days = Math.floor(hours / 24);
	var remHours = hours % 24;
	var dTxt = days + (days == 1 ? " day" : " days");
	if (remHours == 0) { return dTxt; }
	return dTxt + " and " + remHours + (remHours == 1 ? " hour" : " hours");
}
