// Thin-shell loader: the router files (login/status.html) carry only
// client vars + this script. Everything else lives in portal.html, which is
// fetched, injected into #app, and executed in document order.
// No fetch/Promise dependency: old captive-portal browsers fall back to XHR
// and callback-chained script injection instead of sticking on the loader.
(function () {
  function fail(msg) {
    var bt = document.getElementById("bootText");
    if (bt) {
      bt.textContent = msg || "Failed to load portal. Please reload.";
    }
  }
  function checkLibs() {
    // portal.html order guarantees jQuery before core.js; a 404 on either
    // leaves $ undefined and every coin/session flow throws. Fail loud
    // with a retry instead of revealing a dead page.
    if (typeof window.jQuery === "undefined") {
      fail("jQuery failed to load.");
      return false;
    }
    if (typeof window.hexMD5 === "undefined") {
      fail("Login library failed to load.");
      return false;
    }
    return true;
  }
  function injectScripts(scripts, i) {
    if (i >= scripts.length) { checkLibs(); return; }
    var s = scripts[i];
    var el = document.createElement("script");
    function next() { injectScripts(scripts, i + 1); }
    if (s.src) {
      el.src = s.src;
      el.onload = next;
      el.onerror = next;
      document.body.appendChild(el);
    } else {
      el.text = s.textContent;
      document.body.appendChild(el);
      next();
    }
  }
  function inject(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var app = doc.getElementById("app");
    if (!app) { fail("Portal page is empty."); return; }
    document.getElementById("app").innerHTML = app.innerHTML;
    injectScripts(Array.prototype.slice.call(doc.querySelectorAll("script")), 0);
  }
  // status 0 is NOT success (file:// false positive / dead radio) — the
  // portal is always served over http by the router, so demand 200.
  if (window.fetch) {
    var done = false;
    setTimeout(function () { if (!done) { done = true; fail("Portal is taking too long."); } }, 10000);
    fetch("portal.html", { cache: "no-store" }).then(function (r) {
      if (done) { return null; }
      done = true;
      if (!r.ok) { throw 0; }
      return r.text();
    }).then(function (t) { if (t !== null) { inject(t); } })
    .catch(function () { fail(); });
  } else {
    try {
      var x = new XMLHttpRequest();
      x.open("GET", "portal.html", true);
      try { x.timeout = 8000; } catch (e) {}
      x.onreadystatechange = function () {
        if (x.readyState === 4) {
          if (x.status === 200) { inject(x.responseText); }
          else { fail(); }
        }
      };
      x.onerror = function () { fail(); };
      try { x.ontimeout = function () { fail("Portal is taking too long."); }; } catch (e) {}
      x.send();
    } catch (e) { fail(); }
  }
})();
