// Each page sets PAGE ("login"|"status") plus its MikroTik vars
// (mac, uIp, hotspotAddress, interfaceName, loginError) before this loads,

var errorCodeMap = {
	'coins.wait.expired': 'Coin slot expired',
	'coin.not.inserted': 'Coin not inserted',
	'coin.is.reading': 'Verifying coin, please wait…',
	'coinslot.cancelled': 'Coinslot was cancelled',
	'coinslot.busy': 'Coin slot is busy',
	'session.expired': 'Coin session expired, tap INSERT COIN to start over',
	'coin.slot.banned': 'You have been banned from using coin slot, due to multiple request for insert coin, please try again later!',
	'coin.slot.notavailable': 'Coin slot is not available as of the moment, Please try again later',
	'no.internet.detected': 'No internet connection as of the moment, Please try again later',
	'invalid.voucher': 'Invalid voucher code',
	'invalid.request': 'Invalid request, please try again'
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
var currencySym = "₱";
var showMemberSection = true;
var showTrialLogin = false;
var showInternetStatus = true;
var offlineText = "No internet connection as of the moment, please try again later";
var trialNoExtend = true;
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
		if (typeof __setJson.footerBrandText === "string" && __setJson.footerBrandText) { footerBrandText = __setJson.footerBrandText; }
		if (typeof __setJson.footerSubText === "string" && __setJson.footerSubText) { footerSubText = __setJson.footerSubText; }
		if (typeof __setJson.currency === "string" && __setJson.currency) { currencySym = __setJson.currency; }
		if (typeof __setJson.showMemberSection === "boolean") { showMemberSection = __setJson.showMemberSection; }
		if (typeof __setJson.showTrialLogin === "boolean") { showTrialLogin = __setJson.showTrialLogin; }
		if (typeof __setJson.showInternetStatus === "boolean") { showInternetStatus = __setJson.showInternetStatus; }
		if (typeof __setJson.offlineText === "string" && __setJson.offlineText) { offlineText = __setJson.offlineText; }
		if (typeof __setJson.trialNoExtend === "boolean") { trialNoExtend = __setJson.trialNoExtend; }
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
function clearDebugLog() {
	__dbgLines = [];
	if (dbgOn()) { try { console.clear(); } catch (e) { } }
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
var SOUND_V = "?v=87";
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
		if (loop) {
			a.loop = true;
			var p = a.play();
			if (p && typeof p.catch === "function") {
				p.catch(function () { try { fallback && fallback(); } catch (e) {} });
			}
		} else {
			var c = a.cloneNode(true);
			c.loop = false;
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
	try { if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { return; } } catch (e) {}
	sfxStopLoop();
	sfxPlayFile("insert", snd("assets/sounds/insertcoinbg.mp3"), true, null);
}
function sfxPreload() {
	try {
		if (!sfxAudio["insert"]) { sfxAudio["insert"] = new Audio(snd("assets/sounds/insertcoinbg.mp3")); sfxAudio["insert"].preload = "auto"; }
		if (!sfxAudio["inserted"]) { sfxAudio["inserted"] = new Audio(snd("assets/sounds/insertedcoin.mp3")); sfxAudio["inserted"].preload = "auto"; }
		if (!sfxAudio["success"]) { sfxAudio["success"] = new Audio(snd("assets/sounds/success.mp3")); sfxAudio["success"].preload = "auto"; }
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
	document.cookie = name + '=; Max-Age=-99999999;';
}

// Venue-scoped voucher storage — same browser visiting two neighbouring
// vendos at 10.0.0.1 would otherwise share one localStorage key and a
function venueScopeSuffix() {
	var v = "";
	try {
		if (typeof siteIdSuffix !== 'undefined' && siteIdSuffix) v = siteIdSuffix;
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
	try {
		var ts = getStorageValue(scopedKey('activeVoucher_ts'));
		var age = Date.now() - parseInt(ts, 10);
		if (v && ts && (!isFinite(age) || age > 7*24*60*60*1000)) { removeActiveVoucher(); removeStorageValue(scopedKey('activeVoucher_ts')); return ""; }
	} catch(e){}
	return v;
}
function setActiveVoucher(v) {
	try { setStorageValue(scopedKey('activeVoucher_ts'), String(Date.now())); } catch(e){}
	return setStorageValue(scopedKey('activeVoucher'), v);
}
function removeActiveVoucher() { try { removeStorageValue(scopedKey('activeVoucher_ts')); } catch(e){} return removeStorageValue(scopedKey('activeVoucher')); }
// Voucher history: venue-scoped, max 30, newest first — a new entry pushes
// the oldest out. List only, codes only (member usernames never recorded).
var VOUCH_HISTORY_MAX = 30;
var __pendingHistPush = [];
function siteScopeReady() { try { return typeof siteIdSuffix !== 'undefined' && !!siteIdSuffix; } catch (e) { return false; } }
function flushPendingHistory() {
	var q = __pendingHistPush; __pendingHistPush = [];
	for (var i = 0; i < q.length; i++) { try { pushVoucherHistory(q[i]); } catch (e) {} }
}
function getVoucherHistory() { try { var h = JSON.parse(getStorageValue(scopedKey('voucherHistory')) || "[]"); return Array.isArray(h) ? h : []; } catch (e) { return []; } }
function pushVoucherHistory(vc) {
	vc = String(vc || "").trim();
	if (!vc) { return; }
	if (!siteScopeReady()) { try { if (__pendingHistPush.indexOf(vc) === -1 && __pendingHistPush.length < 30) { __pendingHistPush.push(vc); } } catch (e) {} return; }
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
	if (!siteScopeReady()) { box.textContent = ""; return; }
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
	try { if (typeof insertingCoin !== "undefined" && insertingCoin && totalCoinReceived > 0) { e.preventDefault(); e.returnValue = ""; } } catch (err) {}
});
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
	var vouchers = [];
	try {
		var bare = getStorageValue('activeVoucher');
		if (bare) { vouchers.push(bare); }
		try {
			var sc = getStorageValue(scopedKey('activeVoucher'));
			if (sc && vouchers.indexOf(sc) < 0) { vouchers.push(sc); }
		} catch (e) {}
	} catch (e) {}
	try {
		if (typeof localStorage === 'undefined' || localStorage == null) { return; }
		var kill = [];
		for (var i = 0; i < localStorage.length; i++) {
			var k = localStorage.key(i);
			if (k == null) { continue; }
			if (fixed.indexOf(k) >= 0) { kill.push(k); continue; }
			var scopedHit = false;
			for (var b = 0; b < scopedBases.length; b++) {
				if (k === scopedBases[b] || k.indexOf(scopedBases[b] + "_") === 0) { kill.push(k); scopedHit = true; break; }
			}
			if (scopedHit) { continue; }
			if (/(remain|tempValidity|validity)$/.test(k)) { kill.push(k); continue; }
			for (var v = 0; v < vouchers.length; v++) {
				var hit = false;
				if (vouchers[v]) {
					var tails = ["remain", "tempValidity", "validity"];
					for (var t = 0; t < tails.length; t++) {
						var base = vouchers[v] + tails[t];
						if (k === base || k.indexOf(base + "_") === 0) { hit = true; break; }
					}
				}
				if (hit) { kill.push(k); break; }
			}
		}
		for (var j = 0; j < kill.length; j++) { try { localStorage.removeItem(kill[j]); } catch (e) {} }
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
			try {
				var scopedV = getActiveVoucher();
				if (scopedV && scopedV !== voucher) {
					voucher = scopedV;
					if ($("#voucherInput").length > 0 && !$("#voucherInput").val()) {
						$('#voucherInput').val(voucher);
					}
				}
			} catch (e) {}
			try {
				var bareSel = getStorageValue('selectedVendo');
				if (bareSel) {
					setStorageValue(scopedKey('selectedVendo'), bareSel);
					if (typeof multiVendoOption !== 'undefined' && multiVendoOption === 0) {
						vendorIpAddress = bareSel;
						$("#vendoSelected").val(bareSel);
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
			try { dbgLog("site-id missing, fallback scope in use"); } catch (e) { }
			try {
				if (((window.__pendingHistPush && window.__pendingHistPush.length) || (typeof voucher !== "undefined" && voucher)) && !getSessionValue("__siteIdWarned")) {
					try { setSessionValue("__siteIdWarned", "1"); } catch (e) {}
					$.toast({ title: "Site ID missing", content: "Failed saving voucher history. Site ID file is missing - paste Scripts-F first.", type: "error", delay: 6000 });
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
			if (String(t || "").toLowerCase().indexOf("up") === 0) { $("#netBanner").hide(); }
			else {
				var msg = "No internet connection as of the moment, please try again later";
				try { if (typeof offlineText !== "undefined" && offlineText) { msg = offlineText; } } catch (e2) {}
				$("#netBanner").text(msg).show();
			}
		} catch (e) {}
		d.resolve();
	})
	.fail(function () { try { $("#netBanner").hide(); } catch (e) {} d.resolve(); });
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
	try {
		var scopedV = getActiveVoucher();
		if (scopedV && scopedV !== voucher) { voucher = scopedV; }
	} catch(e){}
	if (getReLoginFlag() == '1') {
		removeReLoginFlag();
		var sv = getActiveVoucher();
		if (sv && !$("#voucherInput").val()) { $("#voucherInput").val(sv); }
		try { markAutoLoginTried(); } catch (e) {}
		try { setBootText("Renewing session…"); } catch (e) {}
		var goReLogin = function () {
			setTimeout(function () {
				var code = $("#voucherInput").val() || voucher || getActiveVoucher();
				if (!code) { hideBoot(); return; }
				try { doLogin(); } catch (e) { newLogin(); }
			}, 500);
		};
		try {
			window.__siteIdLoaded = true;
			var siteP = loadSiteId();
			if (siteP && siteP.always) { siteP.always(goReLogin); } else { goReLogin(); }
		} catch (e) { goReLogin(); }
		return;
	}
	try { if (!window.__siteIdLoaded) { loadSiteId(); } } catch (e) {}
	if (voucher != "" && $("#voucherInput").length > 0) {
		$('#voucherInput').val(voucher);
	}
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
			if (cvEl && cvEl.textContent) { facts.voucher = cvEl.textContent; }
		} catch (e2) {}
		var root = doc.getElementById("loginBody") || doc.body;
		if (root) {
			if (!facts.voucher) {
				var cv = root.getAttribute("data-current-voucher");
				if (cv) { facts.voucher = cv; }
			}
			var st = root.getAttribute("data-session-time");
			if (st) { facts.sessiontime = st; }
			if (facts.voucher || facts.sessiontime) { return facts; }
		}
	} catch (e) {}
	try {
		var m = String(html).match(/<span id="curV"[^>]*>([^<]*)<\/span>/);
		if (m) { facts.voucher = m[1]; }
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
	// A reload while paused means the user is coming back: drop the pause
	if (getPausedFlag() == "1") {
		removePausedFlag();
		try { dbgLog("paused flag dropped on reload"); } catch (e) { }
	}
	// Single retry: a slow router (>3s) used to misclassify logged-in
	probeStatus(0);
	function probeStatus(attempt) {
	$.ajax({ type: "GET", url: "/status", timeout: ROUTER_TIMEOUT }).done(function (data) {
		var html = String(data);
		if (html.indexOf("IAMNOTLOGINSTRINGPLEASEDONTREMOVE") >= 0) {
			try { dbgLog("detect: login"); } catch (e) { }
			d.resolve("login");
		} else {
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

function render(state) {
	setPortalState(state);
	try { if (state != "login" && voucher) { pushVoucherHistory(voucher); } } catch (e) {}
	try { paintVoucherHistory(); } catch (e) {}
	try { dbgLog("render: " + state); } catch (e) { }
	// Login succeeded (status/paused views): arm the next auto-login.
	try { if (state != "login") { clearAutoLoginTried(); } } catch (e) {}
	if (state == "login") {
		return;
	}
	if (state == "status") {
		$("#statusVoucher").text(voucher);
		try { if (typeof trialNoExtend !== "undefined" && trialNoExtend && voucher && voucher.indexOf("T-") === 0) { $("#statusVoucher").text("FREE TRIAL"); $("#extendBtn").hide(); } } catch (e) {}
		try {
			if (typeof window.bytesIn !== "undefined" && window.bytesIn) { $("#upUsed").text(window.bytesIn); }
			if (typeof window.bytesOut !== "undefined" && window.bytesOut) { $("#downUsed").text(window.bytesOut); }
		} catch (e) {}
		startCountdown();
		previewUrgencyHook();
	}
	if (state == "paused") {
		$("#pausedVoucher").text(voucher);
		renderStoredRemain("#pauseRemainTime", voucher);
	}
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
	return [tbox(d, "Day", "Days"), tbox(h, "Hour", "Hours"),
		tbox(m, "Min", "Mins"), tbox(s, "Sec", "Secs")].join(sep);
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
	var time = window.sessiontime;
	if (time == "0" || time == "") {
		$("#remainTime").html("Unlimited");
		return;
	}
	time = parseInt(time, 10);
	if (!isFinite(time) || time < 0) { time = 0; }
	window.__remainSecs = time;
	var total = time;
	var warned5 = false, warned1 = false;
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
			$.toast({ title: 'Running low', content: '5 minutes remaining — tap EXTEND TIME to add more', type: 'warning', delay: 5000 });
		}
		if (!warned1 && total > 60 && time <= 60) {
			warned1 = true;
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
		if (typeof footerBrandText !== 'undefined' && footerBrandText) $("#footerBrand").text(footerBrandText);
		try { if (typeof currencySym !== 'undefined' && currencySym) $(".coin-peso").text(currencySym); } catch (e) {}
		if (typeof footerSubText !== 'undefined' && footerSubText) $("#footerSub").text(footerSubText);
		try { if (typeof showMemberSection !== 'undefined' && !showMemberSection) $("#memberSection").hide(); } catch (e) {}
		try { if (typeof showTrialLogin !== "undefined" && showTrialLogin) { $("#trialWrap").show(); } } catch (e) {}
		try { $("#trialBtn").off("click.trial").on("click.trial", function () { if (window.trialAllowed && window.trialUrl) { try { window.location.href = window.trialUrl; } catch (e) {} } else { try { $.toast({ title: "Trial unavailable", content: "Free trial is not enabled on this router", type: "error", delay: 5000 }); } catch (e) {} } return false; }); } catch (e) {}
		try { if (!$("#portalVer").text()) { $("#portalVer").text("v67"); } } catch (e) {}
		try { renderSiteTag(); } catch (e) {}
	} catch(e) {}
}

function renderSiteTag() {
	try {
		var el = $("#siteTag");
		if (!el || el.length === 0) { return; }
		var s = "";
		try { s = venueScopeSuffix(); } catch (e) {}
		if (s) { el.text(s); }
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
}

function paintSaveBtn() {
	var t = $("#saveVoucherButton").attr('data-save-type') || "purchase";
	$("#saveVoucherButton").text(t == "extend" ? "Add Time" : "Claim Code");
}

function restoreCoinChrome() {
	document.body.classList.remove("coin-focus");
	window.__coinOpen = false;
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
	topUpGen++;
	clearInterval(timer);
	timer = null;
	insertingCoin = false;
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
	try { paintSaveBtn(); } catch (e) {}
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
			html += "<tr><td>" + escHtml(rateDisplay(c[0])) + "</td>";
			html += "<td>" + humanDuration(c[2]) + "</td>";
			html += "<td>" + humanDuration(c[3]) + "</td>";
			html += "</tr>";
		}
		html += "</tbody></table></div>";
		$("#ratesBody").html(html);
	}).fail(function (xhr, status, err) {
		// Timeout vs refuse vs HTTP error need different fixes (power,
		var why = (status === "timeout")
			? "Rates unavailable — vendo not answering (timeout). Check power & WiFi."
			: "Rates unavailable — vendo error (" + (xhr && xhr.status ? "HTTP " + xhr.status : status || "network") + ").";
		$("#ratesBody").html('<p class="rates-err">' + why + "</p>");
		dbgAjaxErr("getRates", xhr, status, err);
	});
}

function escHtml(s) {
	return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function rateDisplay(raw) {
	var t = String(raw == null ? "" : raw).trim();
	var m = t.match(/(\d+(?:\.\d+)?)/);
	if (m) { try { return currencySym + new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(parseFloat(m[1])); } catch (e) {} return currencySym + m[1]; }
	return t;
}

// ---------- session resume (login page) ----------

function resumeSession() {
	var d = $.Deferred();
	if (typeof STATE !== 'undefined' && STATE != "login") { d.resolve(); return d.promise(); }
	// Router rejection lands back here with loginError set — show it
	// BEFORE the one-shot guard below, or a failed submit (which marks
	if (loginError != "") {
		removePausedFlag();
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
			// Member typo (errors.txt invalid-username) — not a voucher
			try { dbgLog("resume: member bad credentials", "dbg-err"); } catch (e) { }
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
	var isPaused = getPausedFlag();
	if (isPaused == "1") {
		renderStoredRemain("#pauseRemainTime", voucher);
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
	var d;
	if (raw.length > 15) { d = new Date(Date.parse(raw)); }
	else if (raw.length > 8) {
		var dt = raw.split(" ");
		d = new Date(Date.parse(dt[0] + "/" + new Date().getFullYear() + " " + dt[1]));
	} else {
		var cur = new Date();
		d = new Date(Date.parse((cur.getMonth() + 1) + "/" + cur.getDate() + "/" + cur.getFullYear() + " " + raw));
	}
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
			if (String(data).length > 50) {
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
			renderExpiration("Not Available");
			return false;
		}
		if (t.getTime() < new Date().getTime()) {
			removeVouchValue(voucher, "validity");
			removeVouchValue(voucher, "tempValidity");
			renderExpiration("Not Available");
			return false;
		}
		renderExpiration(formatExpiryLeft(t));
		return true;
	}
	renderExpiration("Not Available");
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
	insertingCoin = true;
	coinToastKey = null;
	$("#saveVoucherButton").attr('data-save-type', STATE == "status" ? "extend" : "purchase");
	try { paintSaveBtn(); } catch (e) {}
	try { dbgLog("insert: type=" + $("#saveVoucherButton").attr('data-save-type') + " page=" + PAGE); } catch (e) { }
	$("#progressDiv").css('width', '100%');
	$("#progressDiv").attr("aria-valuenow", 100).attr("aria-valuetext", "Waiting for coins");
	$("#progressDiv").removeClass("time-half time-low").addClass("time-ok");
	$("#progressDiv").html("");
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
				if (data.indexOf("IAMNOTLOGINSTRINGPLEASEDONTREMOVE") < 0) {
					try { dbgLog("insert: already logged in, bouncing to status"); } catch (e) { }
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

	if (retryCount === 0 && !isExtend && totalCoinReceived == 0) {
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
					$("#coinPanelTitle").text("Please insert coins on " + $("#vendoSelected option:selected").text());
				}
				sfxStartLoop();
			} else {
				try { dbgLog("topUp rejected errorCode=" + data.errorCode, "dbg-err"); } catch (e) { }
				notifyCoinSlotError(data.errorCode);
				clearInterval(timer);
				timer = null;
				insertingCoin = false;
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
	if (currentUseVoucherXhr) { try { currentUseVoucherXhr.abort(); } catch(e){} }
	currentUseVoucherXhr = $.ajax({
		type: "POST",
		url: "http://" + vendorIpAddress + "/useVoucher",
		timeout: VENDO_TIMEOUT,
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
		} else if (data.errorCode == "coinslot.busy" && totalCoinReceived > 0) {
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
			totalCoinReceived = parseInt(data.totalCoin, 10);
			$('#totalCoin').text(data.totalCoin);
			$('#totalTime').html(secondsToDhms(parseInt(data.timeAdded, 10)));
			$('#voucherInput').val(voucher);
			setActiveVoucher( voucher);
			setVouchValue(voucher, "tempValidity", data.validity);
				notifyCoinSuccess(data.newCoin);
			} else if (data.errorCode == "coin.not.inserted") {
				setVouchValue(voucher, "tempValidity", data.validity);
				var remainTime = parseInt(parseInt(data.remainTime, 10) / 1000, 10);
				var waitTime = parseFloat(data.waitTime);
				// Clamped 0-100: waitTime=0 used to yield Infinity% width.
				var percent = (!isFinite(remainTime) || !isFinite(waitTime) || waitTime <= 0) ? 0 :
					Math.max(0, Math.min(100, parseInt(((remainTime * 1000) / waitTime) * 100, 10)));
			totalCoinReceived = parseInt(data.totalCoin, 10);
			if (totalCoinReceived > 0) {
				$("#saveVoucherButton").prop('disabled', false);
				$('#voucherInput').val(voucher);
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
					bar.css('width', percent + '%');
					bar.attr('aria-valuenow', percent);
					bar.attr('aria-valuetext', remainTime + ' seconds remaining');
					bar.removeClass("time-ok time-half time-low");
					bar.addClass(percent > 50 ? "time-ok" : (percent >= 25 ? "time-half" : "time-low"));
					bar.html(remainTime + "s");
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
				insertingCoin = false;
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
				insertingCoin = false;
				notifyCoinSlotError("coin.slot.notavailable");
			}
		},
		complete: function(){ currentCheckCoinXhr = null; }
	});
}

function closeCoinModal() {
	sfxStopLoop();
	coinToastKey = null;
	clearInterval(timer);
	timer = null;
	insertingCoin = false;
	window.__useVoucherBusy = false;
	window.__cancelVoucher = null;
	render(STATE);
}

function autoLoginAfterCoin() {
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
	try { if (window.__logoutTimer) { clearTimeout(window.__logoutTimer); window.__logoutTimer = null; } } catch (e) {}
	setPausedFlag();
	// Store seconds, not markup: the old code saved $("#remainTime").html()
	setVouchValue(vc, "remain", String(window.__remainSecs == null ? -1 : window.__remainSecs));
	try { dbgLog("pause: remain saved"); } catch (e) { }
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
	removePausedFlag();
	insertingCoin = false;
	// Keep the voucher + remain until the router verdict: the old code
	if (!vc) { location.reload(); return; }
	voucher = vc;
	setActiveVoucher( vc);
	$('#voucherInput').val(vc);
	doLogin();
}

function notifyCoinSlotError(errorCode) {
	try { dbgLog("portal error: " + (errorCodeMap[errorCode] || ("Request failed (" + errorCode + ")")), "dbg-err"); } catch (e) { }
	try {
		sfxPlayFile("error", snd("assets/sounds/error.mp3"), false, null);
	} catch (e) { }
	var coinMsg = errorCodeMap[errorCode] || ('Request failed (' + errorCode + '), please try again');
	try { $("#coinErr").text(coinMsg).show(); $("#coinErr").focus(); } catch (e) {}
	$.toast({ title: 'Error', content: coinMsg, type: 'error', delay: 5000 });
}

function notifyCoinSuccess(coin) {
	// checkCoin polls every second and the ESP may repeat status:true for
	if (coinToastOnce("coin-" + totalCoinReceived, { title: 'Coin inserted', content: coin + ' peso(s) was inserted', type: 'success', delay: 2000 })) {
		coinBlip();
	}
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
