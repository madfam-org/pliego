// Pre-paint language pick (classic, render-blocking, same-origin — no inline script under CSP).
// Mirrors shared/i18n.js resolveLang(): ?lang= → stored choice → navigator languages → en.
// The class `i18n-pending` hides translatable text until the page module has applied strings;
// a timer lifts it regardless so a failed module never leaves the page blank.
(function () {
  var LANGS = ['en', 'es', 'fr', 'pt'];
  var lang = 'en';
  var found = false;
  try {
    var q = new URLSearchParams(window.location.search).get('lang');
    if (q && LANGS.indexOf(q) >= 0) { lang = q; found = true; }
  } catch (e) { /* ignore */ }
  if (!found) {
    try {
      var s = window.localStorage.getItem('pliego-lang');
      if (s && LANGS.indexOf(s) >= 0) { lang = s; found = true; }
    } catch (e) { /* private mode */ }
  }
  if (!found) {
    var navs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < navs.length; i++) {
      var p = String(navs[i] || '').toLowerCase().split('-')[0];
      if (LANGS.indexOf(p) >= 0) { lang = p; break; }
    }
  }
  var root = document.documentElement;
  root.lang = lang;
  root.setAttribute('data-lang', lang);
  if (lang !== 'en') {
    root.classList.add('i18n-pending');
    setTimeout(function () { root.classList.remove('i18n-pending'); }, 1500);
  }
})();
