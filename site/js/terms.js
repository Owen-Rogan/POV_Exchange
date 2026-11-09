// Pop-up definitions for glossary terms inside POV text. Each term is already a
// real link to its glossary entry (so it works without JavaScript) and carries
// its one-line definition in data-def. This adds the pop-up on hover and focus.
// Built with textContent only: the definition is never parsed as HTML.

export function initTerms(root = document) {
  const links = [...root.querySelectorAll('a.term[data-def]')];
  if (!links.length) return;

  let pop = document.getElementById('term-pop');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'term-pop';
    pop.className = 'term-pop';
    pop.setAttribute('role', 'tooltip');
    pop.hidden = true;
    document.body.append(pop);
  }
  let current = null;

  function hide() {
    if (current) current.removeAttribute('aria-describedby');
    current = null;
    pop.hidden = true;
  }
  function show(link) {
    if (current === link) return;
    hide();
    current = link;
    pop.textContent = link.dataset.def;
    link.setAttribute('aria-describedby', 'term-pop');
    pop.hidden = false;
    const r = link.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), Math.max(8, innerWidth - w - 8));
    const above = r.top - h - 8;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(above >= 8 ? above : r.bottom + 8)}px`;
  }

  // One set of listeners on the container, so terms added later (the reader) work too.
  const target = (ev) => (ev.target instanceof Element ? ev.target.closest('a.term[data-def]') : null);
  root.addEventListener('pointerover', (ev) => { const a = target(ev); if (a && ev.pointerType === 'mouse') show(a); });
  root.addEventListener('pointerout', (ev) => { if (target(ev)) hide(); });
  root.addEventListener('focusin', (ev) => { const a = target(ev); if (a) show(a); });
  root.addEventListener('focusout', (ev) => { if (target(ev)) hide(); });
  addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hide(); });
  addEventListener('scroll', hide, { passive: true });
}
