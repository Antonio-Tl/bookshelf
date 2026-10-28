// Design vor dem ersten Zeichnen setzen, damit nichts aufflackert.
// Eigene Datei statt Inline-Skript, damit die Content-Security-Policy (_headers) kein Inline-JS erlauben muss.
(function(){
  var t = 'oak';
  try { t = localStorage.getItem('bookshelf-theme') || 'oak'; } catch(e){}
  if(t === 'auto') t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
})();

// Kein Zoomen auf dem Handy. Android hält sich an user-scalable=no im Viewport-Tag, iOS-Safari ignoriert es
// und lässt sich nur über seine Gesten-Events stoppen. Doppeltipp-Zoom verhindert touch-action in style.css.
(function(){
  var stop = function(e){ e.preventDefault(); };
  document.addEventListener('gesturestart', stop);
  document.addEventListener('gesturechange', stop);
  document.addEventListener('touchmove', function(e){
    if(typeof e.scale === 'number' && e.scale !== 1) e.preventDefault();
  }, { passive: false });
})();
