// Entry point for every page. Small things run straight away; the hero graph
// (the heavy part) starts after first paint so the page is readable first.

import { initTitleTransition, initReveal, initTilt } from './motion.js';
import { initThemeToggle } from './theme.js';

initThemeToggle();
initReveal();
initTilt();
initTitleTransition();

const afterPaint = (fn) => requestAnimationFrame(() => setTimeout(fn, 0));

if (document.getElementById('hero')) {
  afterPaint(() => import('./home.js').then((m) => m.initHome()).catch((err) => console.warn('POV Exchange: home failed to start.', err)));
}
if (document.querySelector('.article')) {
  import('./article.js').then((m) => m.initArticle());
}
if (document.getElementById('add-form')) {
  import('./add.js').then((m) => m.initAdd()).catch((err) => console.warn('POV Exchange: add form failed to start.', err));
}
