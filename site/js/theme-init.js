// Runs before first paint (a classic script in <head>) so the saved colour
// theme is applied before anything is drawn. No flash of the wrong theme.
(function () {
  var theme = null;
  try { theme = localStorage.getItem('pov-theme'); } catch (e) { /* storage blocked: follow the system */ }
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.classList.add('js');
}());
