// Design vor dem ersten Zeichnen setzen, damit nichts aufflackert.
// Eigene Datei statt Inline-Skript, damit die Content-Security-Policy (_headers) kein Inline-JS erlauben muss.
(function(){
  var t = 'oak';
  try { t = localStorage.getItem('bookshelf-theme') || 'oak'; } catch(e){}
  if(t === 'auto') t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
})();

