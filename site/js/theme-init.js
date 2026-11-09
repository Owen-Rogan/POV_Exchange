// Runs before first paint (a classic script in <head>) so the saved colour
// theme is applied before anything is drawn. No flash of the wrong theme.
(function () {
  var theme = null;
  try { theme = localStorage.getItem('pov-theme'); } catch (e) { /* storage blocked: follow the system */ }
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.classList.add('js');

  // Page-to-page fades (CSS @view-transition) can be skipped by the browser, for
  // example when the tab is in the background or a second click arrives early.
  // The page still loads normally, but the skipped transition rejects its
  // promises and logs an "Uncaught AbortError". Handle them here. This must be a
  // classic script in <head>: the events fire before a module script would run.
  var quiet = function (event) {
    var vt = event && event.viewTransition;
    if (!vt) return;
    ['ready', 'finished', 'updateCallbackDone'].forEach(function (name) {
      if (vt[name] && vt[name].catch) vt[name].catch(function () { /* skipped: nothing to do */ });
    });
  };
  addEventListener('pagereveal', quiet);
  addEventListener('pageswap', quiet);
}());
