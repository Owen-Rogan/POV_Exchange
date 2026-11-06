// Light/dark theme. The saved choice is applied before first paint by
// theme-init.js; this module adds the toggle and lets the graph react.

const root = document.documentElement;
const media = matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();

export function isDark() {
  const t = root.getAttribute('data-theme');
  return t === 'dark' || (t !== 'light' && media.matches);
}

export function onTheme(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

const fire = () => listeners.forEach((cb) => cb(isDark()));
new MutationObserver(fire).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
media.addEventListener('change', fire);

export function initThemeToggle() {
  for (const button of document.querySelectorAll('[data-theme-toggle]')) {
    button.hidden = false;
    const sync = () => button.setAttribute('aria-label', isDark() ? 'Switch to light theme' : 'Switch to dark theme');
    sync();
    onTheme(sync);
    button.addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('pov-theme', next); } catch { /* storage blocked: the choice lasts for this visit */ }
    });
  }
}
