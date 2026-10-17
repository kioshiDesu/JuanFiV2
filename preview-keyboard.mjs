// Loopback UI stub for keyboard checks only; it is not a RouterOS or vendo emulator.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("./hotspot/", import.meta.url)));
const port = Number(process.argv[2] || 8088);
const types = { ".css": "text/css", ".html": "text/html", ".ico": "image/x-icon", ".js": "text/javascript", ".json": "application/json", ".txt": "text/plain" };

function send(res, status, body, type = "text/plain; charset=utf-8", headers = {}) {
	res.writeHead(status, { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store", "Content-Type": type, "X-Content-Type-Options": "nosniff", ...headers });
	res.end(body);
}

function shell(page) {
	const status = page === "status";
	return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#101418">
<title>Keyboard Check Preview</title><link rel="stylesheet" href="assets/css/base.css?v=172"><link rel="stylesheet" href="assets/css/core.css?v=191"><link rel="stylesheet" href="assets/css/portal.css?v=180">
<script>window.PAGE=${JSON.stringify(page)};window.mac="AA:BB:CC:DD:EE:FF";window.uIp="127.0.0.2";window.hotspotAddress="10.0.0.1";window.interfaceName="keyboard-preview";window.loginError="";window.loginErrorOrig="";window.currentVoucher=${JSON.stringify(status ? "PREVIEW-ONLY" : "")};window.sessiontime="3600";window.loginAction="/portal/done";window.logoutAction="/portal/logout";</script>
</head><body id="loginBody"${status ? ' data-session-time="3600" data-current-voucher="PREVIEW-ONLY"' : ""}>
${status ? '<span id="curV" style="display:none">PREVIEW-ONLY</span><span id="bytesIn" style="display:none">0 B</span><span id="bytesOut" style="display:none">0 B</span>' : ""}
<div id="bootLoader" aria-live="off"><div class="spinner-ring"></div><div><b id="bootBrand">Loading your data…</b></div><div id="bootText"></div></div><div id="app" style="display:none"></div>
<script src="assets/js/boot.js?v=172"></script></body></html>`;
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url || "/", "http://127.0.0.1");
	const path = url.pathname;
	if (req.method === "GET") {
		if (path === "/") { res.writeHead(302, { Location: "/portal/login" }); res.end(); return; }
		if (path === "/portal/login" || path === "/portal/status") { send(res, 200, shell(path.endsWith("status") ? "status" : "login"), "text/html; charset=utf-8"); return; }
		if (path === "/mock/session/status" || path === "/mock/session/login") {
			const loggedIn = path.endsWith("status");
			res.writeHead(302, { Location: `/portal/${loggedIn ? "status" : "login"}`, "Set-Cookie": `preview-session=${loggedIn ? "1" : ""}; ${loggedIn ? "" : "Max-Age=0; "}Path=/; SameSite=Lax` }); res.end(); return;
		}
		if (path === "/settings.json") {
			send(res, 200, JSON.stringify({ isMultiVendo: false, vendorIpAddress: `127.0.0.1:${port}`, portalDebug: false, brandHeaderHtml: "Keyboard Check <em>Preview</em>", currency: "₱", showMemberSection: false, showTrialLogin: false, macAsVoucherCode: false, showConvertVoucher: false }), "application/json; charset=utf-8"); return;
		}
		if (path === "/status") {
			const loggedIn = /(?:^|;\s*)preview-session=1(?:;|$)/.test(req.headers.cookie || "");
			send(res, 200, loggedIn ? '<body id="loginBody" data-session-time="3600" data-current-voucher="PREVIEW-ONLY"><span id="curV">PREVIEW-ONLY</span></body>' : '<!-- IAMNOTLOGINSTRINGPLEASEDONTREMOVE -->'); return;
		}
		if (path === "/data/site-id.txt") { send(res, 200, "keyboardpreview01"); return; }
		if (path === "/getRates") { send(res, 200, ""); return; }
		if (path.startsWith("/portal/")) {
			let file;
			try { file = resolve(root, decodeURIComponent(path.slice(8))); } catch (e) { send(res, 400, "Bad path"); return; }
			if (file !== root && !file.startsWith(root + sep)) { send(res, 403, "Forbidden"); return; }
			try { send(res, 200, await readFile(file), types[extname(file).toLowerCase()] || "application/octet-stream"); }
			catch (e) { send(res, 404, "Not found"); }
			return;
		}
	}
	if (req.method === "POST") {
		if (path === "/topUp") { send(res, 200, '{"status":"true","voucher":"PREVIEW-ONLY"}', "application/json; charset=utf-8"); return; }
		if (path === "/checkCoin") { send(res, 200, '{"status":"false","errorCode":"coin.not.inserted","remainTime":60000,"waitTime":60000,"totalCoin":0,"timeAdded":0}', "application/json; charset=utf-8"); return; }
		if (path === "/cancelTopUp") { send(res, 200, '{"status":"true"}', "application/json; charset=utf-8"); return; }
	}
	send(res, 404, "Not found");
});

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port must be from 1 to 65535.");
server.listen(port, "127.0.0.1", () => console.log(`Keyboard preview at http://127.0.0.1:${port}/portal/login`));
