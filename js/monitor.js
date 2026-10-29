// Fehler im Browser an den Worker melden (POST /api/log), damit sie in den Worker-Logs auftauchen.
// Nur Fehlertext, Datei, Zeile und Seite, ohne Nutzerdaten; höchstens drei Meldungen pro Seitenaufruf.
// Früh geladen (im <head>), damit auch Fehler beim Start erfasst werden. Lokal wird nichts gemeldet.
(function(){
  if(/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.hostname.endsWith('.localhost')) return;
  var sent = 0, seen = {};
  function report(message, source, line, stack){
    var key = message + '|' + source + '|' + line;
    if(sent >= 3 || seen[key]) return;
    seen[key] = true;
    sent++;
    var body = JSON.stringify({
      message: String(message || '').slice(0, 500),
      source: String(source || '').slice(0, 300),
      line: line || null,
      stack: String(stack || '').slice(0, 2000),
      page: location.pathname + location.search,
    });
    try {
      if(navigator.sendBeacon) navigator.sendBeacon('/api/log', body);
      else fetch('/api/log', { method: 'POST', body: body, keepalive: true });
    } catch(e){}
  }
  window.addEventListener('error', function(e){
    // Bilder, die nicht laden (fremde Cover), sind keine Programmfehler.
    if(!e.message) return;
    report(e.message, e.filename, e.lineno, e.error && e.error.stack);
  });
  window.addEventListener('unhandledrejection', function(e){
    var r = e.reason || {};
    report('Unhandled rejection: ' + (r.message || String(r)), '', null, r.stack);
  });
})();
