// Entry point for every page. Small things run straight away; the heavy parts
// (the graph engine, three.js) load after first paint so a page is readable first.

import { initTitleTransition, initReveal, initTilt } from './motion.js';
import { initThemeToggle } from './theme.js';

initThemeToggle();
initReveal();
initTilt();
initTitleTransition();

// Run after first paint. A browser that is not painting (an unfocused window or a background tab)
// may hold animation frames back, so a short timer is the fallback: whichever comes first runs it, once.
const afterPaint = (fn) => {
  let done = false;
  const go = () => { if (!done) { done = true; fn(); } };
  requestAnimationFrame(() => setTimeout(go, 0));
  setTimeout(go, 400);
};
const failed = (what) => (err) => console.warn(`POV Exchange: ${what} failed to start.`, err);

if (document.querySelector('.gp')) {
  afterPaint(() => import('./graph-page.js').then((m) => m.initGraphPage()).catch(failed('the graph')));
} else if (document.querySelector('.by-topic')) {
  import('./library.js').then((m) => m.initLibrary()).catch(failed('the library'));
}
if (document.querySelector('.article')) {
  import('./article.js').then((m) => m.initArticle());
}
if (document.getElementById('add-form')) {
  import('./add.js').then((m) => m.initAdd()).catch(failed('the add form'));
}
