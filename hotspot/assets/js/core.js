// JuanFiV2 portal core — one-page app shared by login.html / status.html / logout.html.
// Each page sets PAGE ("login"|"status"|"logout") plus its MikroTik vars
// (mac, uIp, hotspotAddress, interfaceName, loginError) before this loads,
// then calls boot() on document ready. Boot shows a loading screen, preloads
// promo rates + session data, then reveals the page.

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

// ---------- console debug log (nothing injected into body) ----------
// Every portal flow logs here; the ring buffer always fills (retrieve with
// copyDebugLog() in devtools), but console output only happens when the
// portalDebug switch in config.js is true — customer consoles stay clean.
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
// Portal state: "login" | "status" | "paused". Router pages preset PAGE;
// portal.html (single-file) switches it live via setPortalState().
var STATE = (typeof PAGE !== 'undefined') ? (PAGE === 'logout' ? 'paused' : PAGE) : 'login';
var insertingCoin = false;
var totalCoinReceived = 0;
var timer = null;
var bootDone = false;
// Per-site scope from the router-published site ID (data/site-id.txt, written
// by the publish-site-id scheduler from the board serial). Empty until the
// async boot fetch lands; venueScopeSuffix() falls back meanwhile.
var siteIdSuffix = "";

// Sounds: named MP3 files (assets/sounds/) + vibration. Files are
// pre-amplified; playback stays at full volume. Works offline (same-origin
// files, no network); degrades silently where unsupported (e.g. autoplay
// blocked long after the last tap, iOS vibration).
function sfxVibrate(pattern) {
	try { if (navigator.vibrate) { navigator.vibrate(pattern); } } catch (e) { }
}
// Named sound files (assets/sounds/): silent no-op when unavailable.
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
	sfxStopLoop();
	sfxPlayFile("insert", "assets/sounds/insertcoinbg.mp3", true, null);
}
// Per-coin sting + haptic tick (success sting stays on Done only).
function coinBlip() {
	sfxPlayFile("inserted", "assets/sounds/insertedcoin.mp3", false, null);
	sfxVibrate(40);
}
function sfxStopLoop() {
	try {
		var a = sfxAudio["insert"];
		if (a) { a.pause(); try { a.currentTime = 0; } catch (e) {} }
	} catch (e) {}
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
			box.setAttribute("role", "alert");
			box.setAttribute("aria-live", "polite");
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
// neighbour's 1FI code would auto-fill here. Scope is the router-published
// site ID (board serial); vendorIp is only a last-resort fallback.
// Scope order: site ID first, then vendorIp, then hotspotAddress.
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
// Per-voucher keys (remain/tempValidity/validity) are venue-scoped like
// activeVoucher itself, or the same VCxxxxxx code collides across
// neighbouring vendos. Null-safe: empty voucher yields null, wrappers no-op.
function vKey(vc, suffix) { return (vc ? scopedKey(vc + suffix) : null); }
function getVouchValue(vc, suffix) { var k = vKey(vc, suffix); return k ? getStorageValue(k) : null; }
function setVouchValue(vc, suffix, val) { var k = vKey(vc, suffix); if (k) { setStorageValue(k, val); } }
function removeVouchValue(vc, suffix) { var k = vKey(vc, suffix); if (k) { removeStorageValue(k); } }
function getPausedFlag() { return getStorageValue(scopedKey('isPaused')); }
function setPausedFlag() { return setStorageValue(scopedKey('isPaused'), "1"); }
function removePausedFlag() { return removeStorageValue(scopedKey('isPaused')); }
// Deliberately UNSCOPED (like autoLoginTried): set before logout and read
// after reload, potentially under a different site scope. Scoped reads used
// to miss and strand the extend flow on the login page.
function getReLoginFlag() { return getStorageValue('reLogin'); }
function setReLoginFlag() { return setStorageValue('reLogin', "1"); }
function removeReLoginFlag() { return removeStorageValue('reLogin'); }

// ---------- session-scoped auto-login guard (one shot per tab) ----------
// sessionStorage survives reloads in the same tab but dies with the tab,
// so an auto-login submit that lands back on login (bad voucher, slow
// router) won't re-submit forever. Cleared on status render (login
// succeeded), so a later expiry can auto-login again in the same tab.
var __memSession = {};
// Fallback chain: sessionStorage → persistent storage (localStorage/cookie
// via setStorageValue) → memory. Memory-only used to die on reload, looping
// auto-login forever in private mode; the persistent layer survives reload
// and is cleared on status render like the primary path.
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
	try { removeSessionValue(scopedKey('autoLoginTried')); } catch (e) {}
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

// Scoped migration wipe: removes only portal-owned keys. Never
// localStorage.clear() — that would nuke foreign data stored by any other
// app on this hotspot origin. Covers legacy bare keys, venue-scoped keys
// (<base>_<anything>, suffix-agnostic so renames and ESP swaps can't strand
// orphans) and per-voucher keys (<voucher>remain/tempValidity/validity)
// for every voucher code still on record.
function wipePortalStorage() {
	var fixed = ["activeVoucher", "activeVoucher_ts", "isPaused", "forceLogout",
		"redirectLogin", "ignoreSaveCode", "insertCoinRefreshed",
		"totalCoinReceived", "reLogin", "selectedVendo"];
	var scopedBases = ["activeVoucher", "activeVoucher_ts", "isPaused", "reLogin"];
	var vouchers = [];
	try {
	// Raw reads on purpose: getActiveVoucher() can expire-and-delete a
		// stale code (7-day check) before we harvest it for dynamic keys.
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
			for (var v = 0; v < vouchers.length; v++) {
				// Bare legacy keys plus venue-scoped variants
				// (<voucher><suffix>_<scope>).
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
// data/site-id.txt from the board serial). Fire-and-forget: never gates the
// boot jobs; on arrival re-scope the voucher the same way the multi-vendo
// vendorIp step does. Missing file (scheduler not installed yet) fails fast
// to a 404 and keeps vendorIp scoping.
function loadSiteId() {
	$.ajax({ type: "GET", url: "/data/site-id.txt?date=" + (new Date().getTime()), timeout: 3000 })
		.done(function (data) {
			var m = String(data == null ? "" : data).replace(/[^A-Za-z0-9]/g, "");
			if (/^[A-Za-z0-9]{4,32}$/.test(m)) {
				try { siteIdSuffix = m.toUpperCase(); } catch (e) {}
			try {
				// Truthy only: a new scope with no voucher yields "" —
				// adopting it would wipe the vendorIp-scoped code and
				// poison later keys ("nullremain", vc.length throws).
				var scopedV = getActiveVoucher();
				if (scopedV && scopedV !== voucher) {
					voucher = scopedV;
					if ($("#voucherInput").length > 0 && !$("#voucherInput").val()) {
						$('#voucherInput').val(voucher);
					}
				}
			} catch (e) {}
				try { dbgLog("site scope: " + siteIdSuffix, "dbg-ok"); } catch (e) {}
				try { renderSiteTag(); } catch (e) {}
			}
		})
		.fail(function (xhr, status, err) {
			dbgAjaxErr("siteScope", xhr, status, err);
			try { dbgLog("site-id missing, fallback scope in use"); } catch (e) { }
		});
}

// ---------- boot loader ----------

function setBootText(t) {
	$("#bootText").html(t);
}

function hideBoot() {
	if (bootDone) { return; }
	bootDone = true;
	// Fade the loader instead of blinking it away; reveal the app at once
	// so the fade dissolves over real content, then drop the overlay.
	$("#app").attr("style", "display: block");
	try { $("#bootLoader").addClass("boot-fade"); } catch (e) {}
	setTimeout(function () {
		$("#bootLoader").attr("style", "display: none");
		// The countdown was sized while hidden (zero widths, so the shrink loop
		// never ran) — refit now that measurements are real, or first paint
		// overflows small screens until the next 1s tick fixes it.
		try {
			__fitCache = {};
			fitCountdown("#remainTime");
			fitCountdown("#pauseRemainTime");
		} catch (e) { }
	}, 450);
}

// Boot progress: simple counter under the brand name ("Loading... 1/3").
// Step labels and timings stay in the debug buffer only — the loader
// line just counts settled steps so customers see progress, not logs.
function __stepSecs(t0) {
	try { return (((new Date()).getTime() - t0) / 1000).toFixed(1) + "s"; }
	catch (e) { return ""; }
}
var __bootTotal = 0;
var __bootDoneCount = 0;
function __renderBoot() {
	setBootText("Loading... " + __bootDoneCount + "/" + __bootTotal);
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

function boot() {
	// One-way storage migration: stale flags from older portal builds used to
	// wedge pause/cancel/auto-login (clearing browser data fixed it by hand).
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
	$("#footYear").html(new Date().getFullYear());
	applyFlags();
	try { dbgLog("boot page=" + (typeof PAGE !== 'undefined' ? PAGE : "?") + " vendo=" + (typeof vendorIpAddress !== 'undefined' ? vendorIpAddress : "?") + " mac=" + (typeof mac !== 'undefined' ? mac : "?")); } catch (e) { }
	// Re-scope voucher after vendorIp is resolved (multi-vendo selects it)
	try {
		var scopedV = getActiveVoucher();
		if (scopedV && scopedV !== voucher) { voucher = scopedV; }
	} catch(e){}
	// Re-login after an extend that outlived its session (set by
	// autoLoginAfterCoin). Runs AFTER applyFlags (multi-vendo vendorIp
	// select) and the re-scope above — reading the flag earlier used a
	// different scope than the write and stranded extends on login.
	// Runs here, not in the shell, because doLogin only exists after injection.
	if (getReLoginFlag() == '1') {
		removeReLoginFlag();
		// A logout/reload wipes the page but not storage: restore the
		// voucher into the input or doLogin has nothing to submit.
		var sv = getActiveVoucher();
		if (sv && !$("#voucherInput").val()) { $("#voucherInput").val(sv); }
		try { markAutoLoginTried(); } catch (e) {}
		doLogin();
		return;
	}
	// Site scope arrives async (site-id file); re-scope again on arrival.
	try { loadSiteId(); } catch (e) {}
	if (voucher != "" && $("#voucherInput").length > 0) {
		$('#voucherInput').val(voucher);
	}
	// Failsafe: never trap the customer behind the loader (dead vendo, no net).
	setTimeout(function () {
		setBootText("Loading... taking longer than usual.");
		hideBoot();
	}, 9000);

	var bootT0 = (new Date()).getTime();
timedStep("Detecting session", detectState(), true).done(function (state) {
		try { dbgLog("boot state=" + state); } catch (e) { }
		render(state);
		var jobs = [timedStep("Loading Wi-Fi rates", loadRates(), true)];
		if (state == "login") {
			jobs.push(timedStep("Checking session", resumeSession(), true));
		} else {
			jobs.push(timedStep("Loading session", showValidity(), true));
		}
		// jQuery promises settle fail or success — either way reveal the portal.
		$.when.apply($, jobs).always(function () {
			try { dbgLog("boot ready (" + __stepSecs(bootT0) + ")"); } catch (e) { }
			setTimeout(hideBoot, 500);
		});
	});
}

// Read live session facts out of the status page. Prefers data-* attributes
// on #loginBody (exact values, immune to JS formatting drift); falls back to
// the legacy inline-JS regex for older shells or parsers without text/html
// DOM support.
function parseStatusFacts(html) {
	var facts = { voucher: "", sessiontime: "" };
	try {
		var doc = new DOMParser().parseFromString(String(html), "text/html");
		// Shells carry the voucher as span text (never inline JS/attrs —
		// quotes in vouchers stay inert). Attribute second (legacy shells).
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

// Probe the router for the real client state and render the matching view,
// document.write-style: one file, UI follows the session, not the filename.
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
	// and fall through to auto-resume below. The paused view only ever
	// renders via pause() itself (no reload), or ?state=paused for testing.
	if (getPausedFlag() == "1") {
		removePausedFlag();
		try { dbgLog("paused flag dropped on reload"); } catch (e) { }
	}
	$.ajax({ type: "GET", url: "/status", timeout: 3000 }).done(function (data) {
		var html = String(data);
		if (html.indexOf("IAMNOTLOGINSTRINGPLEASEDONTREMOVE") >= 0) {
			try { dbgLog("detect: login"); } catch (e) { }
			d.resolve("login");
		} else {
			// Logged in: lift live session facts out of the status page itself.
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
		try { dbgLog("detect: /status unreachable, assuming login"); } catch (e) { }
		d.resolve("login");
	});
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
	try { dbgLog("render: " + state); } catch (e) { }
	// Login succeeded (status/paused views): arm the next auto-login.
	try { if (state != "login") { clearAutoLoginTried(); } } catch (e) {}
	if (state == "login") {
		return;
	}
	if (state == "status") {
		$("#statusVoucher").text(voucher);
		startCountdown();
		previewUrgencyHook();
	}
	if (state == "paused") {
		$("#pausedVoucher").text(voucher);
		renderStoredRemain("#pauseRemainTime", voucher);
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

// Segmented countdown boxes: always Day Hour Min Sec, joined with colons,
// each with a small unit label inside. Zero boxes stay visible ("00 Days")
// so the layout never shifts as time runs down.
function tbox(n, one, many) {
	var num = (n < 10 ? "0" : "") + n;
	return '<span class="tbox"><span class="tnum">' + num + '</span><span class="tlab">' + (n == 1 ? one : many) + "</span></span>";
}
function boxesDhms(seconds) {
	var t = Math.max(0, parseInt(seconds || 0));
	var d = Math.floor(t / 86400), h = Math.floor(t % 86400 / 3600);
	var m = Math.floor(t % 3600 / 60), s = t % 60;
	var sep = '<span class="tsep">:</span>';
	return [tbox(d, "Day", "Days"), tbox(h, "Hour", "Hours"),
		tbox(m, "Min", "Mins"), tbox(s, "Sec", "Secs")].join(sep);
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
	window.__remainSecs = time;
	var total = time;
	var warned5 = false, warned1 = false;
	$("#remainTime").html(boxesDhms(time));
	paintCountdownUrgency(time);
	fitCountdown("#remainTime");
	if (window.remainingTimer != null) { clearInterval(window.remainingTimer); }
	window.remainingTimer = setInterval(function () {
		time--;
		window.__remainSecs = time;
		$("#remainTime").html(boxesDhms(time));
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
				sfxPlayFile("error", "assets/sounds/error.mp3", false, null);
			} catch (e) { }
		}
		if (time <= 0) {
			$.toast({ title: 'Success', content: 'Time limit exceeded, Thank you for the purchase, will be logout shortly', type: 'success', delay: 5000 });
			clearInterval(window.remainingTimer);
			// Tracked so pause() can disarm it: tapping pause inside the
			// 6s window used to show paused UI while logout still fired.
			try { if (window.__logoutTimer) { clearTimeout(window.__logoutTimer); } } catch (e) {}
			window.__logoutTimer = setTimeout(function () { document.logout.submit(); }, 6000);
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

	// Branding from config.js — keep portal.html generic. Operator-edited
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
		if (typeof footerSubText !== 'undefined' && footerSubText) $("#footerSub").text(footerSubText);
		try { if (!$("#portalVer").text()) { $("#portalVer").text("v2"); } } catch (e) {}
		try { renderSiteTag(); } catch (e) {}
	} catch(e) {}
}

// Show the effective storage scope in the footer so support can tell which
// site a report came from. Re-rendered when the async site-id file lands.
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
	$("#view-status .btnrow").attr("style", "");
	$("#voucherBlock").attr("style", "");
	$("#memberSection").attr("style", "");
}

function cancelCoin() {
	// Coins in the slot? Confirm first — cancelling forfeits them, and a
	// stray tap used to silently strand paid credit (next topUp starts a
	// fresh voucher and abandons this one on the ESP).
	var forfeited = 0;
	if (totalCoinReceived > 0) {
		var ok = false;
		try { ok = window.confirm("₱" + totalCoinReceived + " inserted — cancelling forfeits it.\n\nOK = forfeit, Cancel = keep going (then tap Done to claim)."); } catch (e) { ok = false; }
		if (!ok) {
			try { dbgLog("cancel: kept session with coins=" + totalCoinReceived); } catch (e) { }
			return;
		}
		forfeited = totalCoinReceived;
		try { dbgLog("cancel: forfeited coins=" + forfeited); } catch (e) { }
	}
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
	$("#loaderDiv").attr("class", "spinner hidden");
	if (forfeited > 0) {
		$.toast({ title: 'Cancelled', content: 'Coin insertion cancelled — ₱' + forfeited + ' forfeited', type: 'info', delay: 3000 });
	} else {
		$.toast({ title: 'Cancelled', content: 'Coin insertion cancelled', type: 'info', delay: 3000 });
	}
	try { sfxPlayFile("error", "assets/sounds/error.mp3", false, null); } catch (e) { }
	// Always release the ESP slot — including after a forfeit — so the next
	// customer never opens against our abandoned session (busy recovery
	// paths already cover a slot that stays held).
	var cancelVc = voucher;
	try { if (window.__cancelVoucher) { cancelVc = window.__cancelVoucher; } } catch (e) {}
	$.ajax({
		type: "POST",
		url: "http://" + vendorIpAddress + "/cancelTopUp",
		timeout: 5000,
		data: { voucher: cancelVc, mac: mac },
		success: function () { $("#loaderDiv").attr("class", "spinner hidden"); },
		error: function () { $("#loaderDiv").attr("class", "spinner hidden"); }
	});
	totalCoinReceived = 0;
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
	$("#ratesBody").html("<p>Loading Wi-Fi rates…</p>");
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
			$("#ratesBody").html("<p>No Wi-Fi rates configured on this vendo yet.</p>");
			return;
		}
		var html = "<div class='table-responsive'><table class='table table-striped'>";
		html += "<thead><tr><th>Rate</th><th>Time</th><th>Validity</th>";
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
		$("#ratesBody").html("<p>Rates unavailable — ESP unreachable. Check that the ESP is powered on.</p>");
		dbgAjaxErr("getRates", xhr, status, err);
	});
}

function escHtml(s) {
	return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Rate cell: pull the number out of labels like "1 pesos" / "P10" and show
// it with a peso sign ("₱1"); verbatim for numberless names ("UNLI").
function rateDisplay(raw) {
	var t = String(raw == null ? "" : raw).trim();
	var m = t.match(/(\d+(?:\.\d+)?)/);
	if (m) { return "₱" + m[1]; }
	return t;
}

// ---------- session resume (login page) ----------

function resumeSession() {
	var d = $.Deferred();
	// Single-file portal keeps all views in the DOM: only auto-connect on login state.
	if (typeof STATE !== 'undefined' && STATE != "login") { d.resolve(); return d.promise(); }
	// Router rejection lands back here with loginError set — show it
	// BEFORE the one-shot guard below, or a failed submit (which marks
	// tried before posting) would swallow its own error toast.
	if (loginError != "" && voucher != "") {
		removePausedFlag();
		try { markAutoLoginTried(); } catch (e) {}
		var loginErrLower = String(loginError).toLowerCase();
		if (loginErrLower.indexOf("no more sessions") !== -1 || loginErrLower.indexOf("session limit") !== -1 || loginErrLower.indexOf("simultaneous") !== -1) {
			// Code valid but online elsewhere (shared-users=1) — keep it
			// so retry is one tap instead of retyping.
			try { $('#voucherInput').val(voucher); } catch (e) {}
			try { dbgLog("resume: code in use elsewhere, voucher kept", "dbg-err"); } catch (e) { }
			$.toast({ title: 'In use', content: "This code is online on another device — pause it there or wait 30s, then tap CONNECT to retry", type: 'warning', delay: 8000 });
		} else if (loginErrLower.indexOf("uptime limit") !== -1) {
			removeActiveVoucher();
			voucher = "";
			try { dbgLog("resume: uptime exhausted, voucher cleared", "dbg-err"); } catch (e) { }
			$.toast({ title: 'Expired', content: "This code has used up all its time", type: 'error', delay: 5000 });
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
	// with the same session file — without this the page re-submits forever.
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
		$.ajax({ type: "GET", url: "/data/" + macNoColon() + ".txt?query=" + new Date().getTime(), timeout: 3000 })
			.done(function (data) {
				var parts = String(data).split("#");
				var fileVoucher = (parts[0] || "").trim();
				var validUntil = parts.length > 1 ? parseValidity(parts[1]) : null;
				// Stale session file (empty, dateless, or expired voucher):
				// never auto-connect it, or a dead test code keeps
				// logging itself in on every visit to the login page.
				if (fileVoucher == "" || validUntil == null || validUntil.getTime() < new Date().getTime()) {
					removeActiveVoucher();
					try { dbgLog("resume: stale session file, skipping auto-connect"); } catch (e) { }
					d.resolve();
					return;
				}
				voucher = fileVoucher;
				$('#voucherInput').val(voucher);
				try { dbgLog("resume: auto-connect len=" + fileVoucher.length); } catch (e) { }
				try { markAutoLoginTried(); } catch (e) {}
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

// Relative expiry for customers: "3 days left" / "5 hours left" / "12 mins left".
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

function showValidity() {
	var d = $.Deferred();
	$.ajax({ type: "GET", url: "/data/" + macNoColon() + ".txt?query=" + new Date().getTime(), timeout: 3000 })
		.done(function (data) {
			if (String(data).length > 50) {
				try { dbgLog("validity: long body, fallback"); } catch (e) { }
				if (fallbackValidity()) { d.resolve(); } else { d.reject(); }
				return;
			}
		var t = parseValidity(String(data).split("#")[1]);
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

// Returns true when some expiry could be shown, false when nothing loaded.
function fallbackValidity() {
	var validity = getVouchValue(voucher, "validity");
	if (validity != null) {
		var t = new Date(parseInt(validity));
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
// retry timer outlives cancelCoin and resurrects a dead session.
var topUpGen = 0;
function insertBtnAction() {
	// No double-submit: one coin session at a time (second tap = busy error).
	if (insertingCoin) { return false; }
	topUpGen++;
	insertingCoin = true;
	coinToastKey = null;
	$("#saveVoucherButton").attr('data-save-type', STATE == "status" ? "extend" : "purchase");
	try { dbgLog("insert: type=" + $("#saveVoucherButton").attr('data-save-type') + " page=" + PAGE); } catch (e) { }
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
		data: { voucher: voucher, mac: mac, extendTime: (isExtend ? "1" : "0") },
		complete: function(){ currentTopUpXhr = null; },
		success: function (data) {
			$("#loaderDiv").attr("class", "spinner hidden");
			try { dbgLog("topUp ok voucher=" + (data && data.voucher ? data.voucher : "?"), "dbg-ok"); } catch (e) { }
		if (gen !== topUpGen) { return; }
		if (data.status == "true") {
			voucher = data.voucher;
			setActiveVoucher(voucher);
			// Pin the voucher for cancelTopUp: the global gets cleared on
			// fresh purchases, and a failed topUp never sets it — sending
			// voucher:"" releases nothing on the ESP.
			try { window.__cancelVoucher = data.voucher; } catch (e) {}
				showCoinPanel();
				insertingCoin = true;
				$('#codeGenerated').text(voucher);
				if (timer == null) {
					timer = setInterval(checkCoin, 1000);
				}
				if (isMultiVendo) {
					$("#coinPanelTitle").text("Please insert the coin on " + $("#vendoSelected option:selected").text());
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
		// ESP dead / timeout: retry quickly, then show unreachable error.
		// Generation-checked: a cancel during the 1s wait kills the retry.
		dbgAjaxErr("topUp retry=" + retryCount, xhr, status, err);
		setTimeout(function () {
			if (gen !== topUpGen) { return; }
			if (retryCount < 3) {
				callTopupAPI(retryCount + 1, gen);
			} else {
					$("#loaderDiv").attr("class", "spinner hidden");
					notifyCoinSlotError("coin.slot.notavailable");
					insertingCoin = false;
				}
			}, 1000);
		}
	});
}

var currentUseVoucherXhr = null;
function saveVoucherBtnAction() {
	// Entry guard: Done double-tap and the wait-expiry auto-finalize used
	// to fire concurrent /useVoucher posts (plus a racing /cancelTopUp).
	if (window.__useVoucherBusy) { return; }
	window.__useVoucherBusy = true;
	$("#saveVoucherButton").prop('disabled', true);
	$("#cncl").prop('disabled', true);
	$("#loaderDiv").attr("class", "spinner");
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
		timeout: 5000,
		data: { voucher: voucher },
		complete: function(){ currentUseVoucherXhr = null; },
		success: function (data) {
			totalCoinReceived = 0;
			insertingCoin = false;
			window.__useVoucherBusy = false;
			$("#loaderDiv").attr("class", "spinner hidden");
			try { dbgLog("useVoucher resp " + JSON.stringify(data).slice(0, 200), (data && data.status == "true") ? "dbg-ok" : "dbg-err"); } catch (e) { }
		if (data.status == "true") {
			setVouchValue(voucher, "tempValidity", data.validity);
			try { sfxPlayFile("success", "assets/sounds/success.mp3", false, null); } catch (e) { }
			$.toast({ title: 'Success', content: 'Thank you for the purchase!, will do auto login shortly', type: 'success', delay: 3000 });
			autoLoginAfterUseVoucher();
		} else if (data.errorCode == "coinslot.busy" && totalCoinReceived > 0) {
			// Lost the race with the ESP wait-expiry: the vendo already
			// registered the voucher and added the time itself (then cleared
			// its session, hence "busy"). Prefer the validity riding on this
			// response — with zero polls yet the checkCoin path stored
			// nothing and mergeTempValidity would no-op the expiry.
			if (data.validity) { setVouchValue(voucher, "tempValidity", data.validity); }
			try { sfxPlayFile("success", "assets/sounds/success.mp3", false, null); } catch (e) { }
			$.toast({ title: 'Success', content: 'Thank you for the purchase!, will do auto login shortly', type: 'success', delay: 3000 });
			autoLoginAfterUseVoucher();
		} else {
			notifyCoinSlotError(data.errorCode);
			$("#saveVoucherButton").prop('disabled', false);
			$("#cncl").prop('disabled', false);
		}
		}, error: function (jqXHR, status, err) {
			if (status === "abort") { window.__useVoucherBusy = false; return; }
			// Release INSERT COIN: the old handler left insertingCoin true,
			// bricking the button until reload.
			insertingCoin = false;
			window.__useVoucherBusy = false;
			$("#loaderDiv").attr("class", "spinner hidden");
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
		// session like pause/resume does; boot auto-logs back
		// in with the extended voucher for a fresh countdown.
		try { dbgLog("autoLogin: extend path, ending session"); } catch (e) { }
		setReLoginFlag();
		setTimeout(function () {
			try { document.logout.submit(); }
			catch (e) { location.reload(); }
		}, 3000);
	} else {
		// Fresh purchase on login page: auto-login with the new voucher
		// so the customer never has to click CONNECT manually.
		try { dbgLog("autoLogin: purchase path, doLogin in 3s"); } catch (e) { }
		setTimeout(function () {
			try { doLogin(); } catch (e) { newLogin(); }
		}, 3000);
	}
}

var checkCoinFailStreak = 0;
var currentTopUpXhr = null;
var currentCheckCoinXhr = null;
// One toast per coin-state transition: checkCoin ticks every second, so a
// bare toast call here would stack one per poll while verifying.
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
	// and slow under telnet), which looked like "error, retry shows coins".
	if (currentCheckCoinXhr) { return; }
	currentCheckCoinXhr = $.ajax({
		type: "POST",
		url: "http://" + vendorIpAddress + "/checkCoin",
		timeout: 5000,
		data: { voucher: voucher },
		success: function (data) {
			checkCoinFailStreak = 0;
			coinToastKey = null;
			if (data.status == "true") {
			try { dbgLog("checkCoin COIN +" + data.newCoin + " total=" + data.totalCoin + " timeAdded=" + data.timeAdded + "s", "dbg-ok"); } catch (e) { }
			totalCoinReceived = parseInt(data.totalCoin);
			$('#totalCoin').html(data.totalCoin);
			$('#totalTime').html(secondsToDhms(parseInt(data.timeAdded)));
			$('#voucherInput').val(voucher);
			setActiveVoucher( voucher);
			setVouchValue(voucher, "tempValidity", data.validity);
				notifyCoinSuccess(data.newCoin);
			} else if (data.errorCode == "coin.not.inserted") {
				setVouchValue(voucher, "tempValidity", data.validity);
				var remainTime = parseInt(parseInt(data.remainTime) / 1000);
				var waitTime = parseFloat(data.waitTime);
				var percent = parseInt(((remainTime * 1000) / waitTime) * 100);
			totalCoinReceived = parseInt(data.totalCoin);
			if (totalCoinReceived > 0) {
				$("#saveVoucherButton").prop('disabled', false);
				$('#voucherInput').val(voucher);
			}
				if (remainTime == 0) {
					if (totalCoinReceived > 0) {
						// Wait ran out with money in: finalize the purchase the
						// same way Done does (POST /useVoucher, then auto-login)
						// instead of just reloading and hoping the ESP filed it.
						try { dbgLog("checkCoin: wait expired with coins=" + totalCoinReceived + ", auto-finalizing", "dbg-ok"); } catch (e) { }
						$.toast({ title: 'Time is up', content: 'Confirming your purchase of ' + totalCoinReceived + ' peso(s)...', type: 'info', delay: 4000 });
						$("#saveVoucherButton").prop('disabled', true);
						$("#cncl").prop('disabled', true);
						saveVoucherBtnAction();
					} else {
						try { dbgLog("checkCoin: wait expired, no coins", "dbg-err"); } catch (e) { }
						notifyCoinSlotError('coins.wait.expired');
					}
				} else {
					$('#totalCoin').html(data.totalCoin);
					$('#totalTime').html(secondsToDhms(parseInt(data.timeAdded)));
					var bar = $("#progressDiv");
					bar.css('width', percent + '%');
					bar.attr('aria-valuenow', percent);
					bar.removeClass("time-ok time-half time-low");
					bar.addClass(percent > 50 ? "time-ok" : (percent >= 25 ? "time-half" : "time-low"));
					bar.html(remainTime + "s");
				}
			} else if (data.errorCode == "coinslot.busy") {
				// Session cleared on the vendo side (manual cancel).
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
				// Keep polling — killing the timer here is what forced a
				// re-tap to reveal already-latched coins.
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
			if (checkCoinFailStreak >= 5) {
				coinToastOnce("unreachable", { title: 'Connection lost', content: 'ESP unreachable — check power & WiFi, then tap Cancel to retry.', type: 'warning', delay: 4000 });
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
	// (tbox spans) and restored it via .html() — editable storage turned
	// that into an XSS sink. Regenerate markup locally on restore.
	setVouchValue(vc, "remain", String(window.__remainSecs == null ? -1 : window.__remainSecs));
	try { dbgLog("pause: remain saved"); } catch (e) { }
	// Freeze any auto-reload while pausing, then render paused instantly.
	insertingCoin = true;
	render("paused");
	// End the router session in the background without navigating, so no
	// reload can win the race and bounce the client back to status. A
	// failed logout used to leave paused UI over a still-ticking session —
	// revert to status with a toast instead.
	try {
		fetch(document.logout.action, { method: "GET", cache: "no-store" })
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
	// deleted both before doLogin, so a rejected resume lost the code with
	// no retry. Invalid/uptime paths in resumeSession() clear it instead.
	if (!vc) { location.reload(); return; }
	// Re-login directly: no reload, no login-page flash.
	voucher = vc;
	setActiveVoucher( vc);
	$('#voucherInput').val(vc);
	doLogin();
}

function notifyCoinSlotError(errorCode) {
	try { dbgLog("portal error: " + (errorCodeMap[errorCode] || ("Request failed (" + errorCode + ")")), "dbg-err"); } catch (e) { }
	try {
		sfxPlayFile("error", "assets/sounds/error.mp3", false, null);
	} catch (e) { }
	$.toast({ title: 'Error', content: errorCodeMap[errorCode] || ('Request failed (' + errorCode + '), please try again'), type: 'error', delay: 5000 });
}

function notifyCoinSuccess(coin) {
	// checkCoin polls every second and the ESP may repeat status:true for
	// the same coin — key by running total so each coin announces (and
	// blips) exactly once, repeats swallowed.
	if (coinToastOnce("coin-" + totalCoinReceived, { title: 'Coin inserted', content: coin + ' peso(s) was inserted', type: 'success', delay: 2000 })) {
		coinBlip();
	}
}

function secondsToDhms(seconds) {
	seconds = Number(seconds);
	var d = Math.floor(seconds / (3600 * 24));
	var h = Math.floor(seconds % (3600 * 24) / 3600);
	var m = Math.floor(seconds % 3600 / 60);
	var s = Math.floor(seconds % 60);
	var dDisplay = d > 0 ? d + (d == 1 ? " Day " : " Days ") : "";
	return (dDisplay ? dDisplay + " " : "") + h + "h : " + m + "m : " + s + "s";
}
