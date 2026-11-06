// Small page-wide motion: reveal on scroll, tilting cards, and the shared
// title that carries over when a card opens its POV (cross-document view
// transition). Everything here is skipped for reduced motion.

const reduced = matchMedia('(prefers-reduced-motion: reduce)');

export function initReveal() {
  const items = [...document.querySelectorAll('.reveal')];
  if (reduced.matches || !('IntersectionObserver' in window)) {
    for (const el of items) el.classList.add('in');
    return;
  }
  // Items are only hidden once this script is running, so a script failure never hides content.
  document.documentElement.classList.add('reveal-on');
  // Stagger cards inside the same list.
  for (const list of document.querySelectorAll('.cards')) {
    [...list.children].forEach((li, i) => li.style.setProperty('--i', String(Math.min(i, 8))));
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
  for (const el of items) io.observe(el);
}

export function initTilt() {
  if (reduced.matches || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  for (const card of document.querySelectorAll('.card a')) {
    let queued = false;
    let ev = null;
    const apply = () => {
      queued = false;
      const r = card.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width;
      const y = (ev.clientY - r.top) / r.height;
      card.style.setProperty('--ry', `${((x - 0.5) * 9).toFixed(2)}deg`);
      card.style.setProperty('--rx', `${((0.5 - y) * 7).toFixed(2)}deg`);
      card.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
      card.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    };
    card.addEventListener('pointermove', (e) => {
      ev = e;
      if (!queued) { queued = true; requestAnimationFrame(apply); }
    });
    card.addEventListener('pointerleave', () => {
      for (const p of ['--rx', '--ry', '--mx', '--my']) card.style.removeProperty(p);
    });
  }
}

/** Name the clicked card's title so it morphs into the POV page heading. */
export function initTitleTransition() {
  if (reduced.matches) return;
  const clear = () => {
    for (const el of document.querySelectorAll('.card-title')) el.style.viewTransitionName = '';
  };
  addEventListener('pageshow', clear);
  document.addEventListener('click', (ev) => {
    const a = ev.target instanceof Element ? ev.target.closest('.card a') : null;
    if (!a) return;
    clear();
    const title = a.querySelector('.card-title');
    if (title) title.style.viewTransitionName = 'pov-title';
  });
}
