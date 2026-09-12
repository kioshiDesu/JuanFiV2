// Thin-shell loader: the router files (login/status/logout.html) carry only
// client vars + this script. Everything else lives in portal.html, which is
// fetched, injected into #app, and executed in document order.
(function () {
  function fail() {
    var bt = document.getElementById("bootText");
    if (bt) { bt.innerHTML = "Failed to load portal. Please reload."; }
  }
  fetch("portal.html", { cache: "no-store" }).then(function (r) {
    if (!r.ok) { throw 0; }
    return r.text();
  }).then(function (html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var app = doc.getElementById("app");
    if (!app) { throw 0; }
    document.getElementById("app").innerHTML = app.innerHTML;
    var scripts = Array.prototype.slice.call(doc.querySelectorAll("script"));
    var chain = Promise.resolve();
    scripts.forEach(function (s) {
      chain = chain.then(function () {
        return new Promise(function (res) {
          var el = document.createElement("script");
          if (s.src) {
            el.src = s.src;
            el.onload = res;
            el.onerror = res;
          } else {
            el.text = s.textContent;
          }
          document.body.appendChild(el);
          if (!s.src) { res(); }
        });
      });
    });
    return chain;
  }).catch(fail);
})();
