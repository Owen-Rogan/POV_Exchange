// The side browser on the Graph page: topics and their POVs as a contents list,
// beside the graph. It only draws what browse-model.js hands it and reports
// clicks and hovers; the page decides what those mean.
//
// Built with createElement and textContent only. Nothing from the data is ever
// parsed as HTML.

import { TERMS_GROUP, groupFor, rowKeyFor } from './browse-model.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * @param {HTMLElement} panel   the <aside id="browse"> from the page
 * @param {{model:object, povBySlug:Map, onPick:(id:string)=>void, onHover:(id:string|null)=>void}} deps
 */
export function createBrowser(panel, deps) {
  const { model, povBySlug } = deps;
  const body = panel.querySelector('.browse-body');
  const note = panel.querySelector('.browse-note');

  const expanded = new Set(); // groups the visitor opened
  const closedInSearch = new Set(); // groups the visitor closed while searching (everything opens by itself then)
  let tree = null;
  let current = null; // the node id of the highlighted row
  let wasSearching = false;

  const isOpen = (g) => (tree.searching ? !closedInSearch.has(g) : expanded.has(g));

  function toggle(g) {
    if (tree.searching) { if (closedInSearch.has(g)) closedInSearch.delete(g); else closedInSearch.add(g); }
    else if (expanded.has(g)) expanded.delete(g); else expanded.add(g);
    paint({ keepFocus: `toggle:${g}` });
  }

  function pickButton(id, className, label) {
    const b = el('button', className, label);
    b.type = 'button';
    b.dataset.id = id;
    b.addEventListener('click', () => deps.onPick(id));
    return b;
  }

  function group(g, { id, title, sample, count, rows, terms }) {
    const open = isOpen(g);
    const wrap = el('section', `bt-group${open ? ' is-open' : ''}`);
    const head = el('div', 'bt-head');
    const t = el('button', 'bt-toggle');
    t.type = 'button';
    t.dataset.key = `toggle:${g}`;
    t.setAttribute('aria-expanded', String(open));
    t.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} ${terms ? 'glossary terms' : `POVs on ${title}`}`);
    t.addEventListener('click', () => toggle(g));
    head.append(t);
    if (terms) {
      head.append(el('span', 'bt-topic bt-plain', title));
    } else {
      head.append(pickButton(id, 'bt-topic', title));
    }
    head.append(el('span', 'bt-count', count));
    if (sample) head.append(el('span', 'tag', 'Sample'));
    wrap.append(head);
    if (open) {
      const list = el('ul', 'bt-rows');
      for (const r of rows) {
        const li = el('li');
        const b = pickButton(r.id, 'bt-row', r.title);
        if (r.sample) b.append(el('span', 'tag', 'Sample'));
        if (r.draft) b.append(el('span', 'status draft', 'Draft'));
        if (r.also && r.also.length) {
          b.title = `${r.title}. Also in: ${r.also.join(', ')}`;
        }
        li.append(b);
        list.append(li);
      }
      wrap.append(list);
    }
    return wrap;
  }

  function paint({ keepFocus = null, reveal = false } = {}) {
    if (!tree) return;
    const top = body.scrollTop;
    body.textContent = '';
    if (!tree.groups.length && !tree.terms.length) {
      body.append(el('p', 'bt-empty', tree.searching ? 'Nothing matches. Try fewer or different words.' : 'Nothing to show with the current switches.'));
    }
    for (const g of tree.groups) {
      body.append(group(g.id, { id: g.id, title: g.title, sample: g.sample, count: plural(g.count, 'POV', 'POVs'), rows: g.rows }));
    }
    if (tree.terms.length) {
      body.append(group(TERMS_GROUP, {
        id: TERMS_GROUP, title: 'Glossary terms', sample: false, count: plural(tree.terms.length, 'term', 'terms'), terms: true,
        rows: tree.terms.map((x) => ({ id: x.id, title: x.title, sample: x.sample, draft: false })),
      }));
    }
    body.scrollTop = top;
    mark({ reveal });
    if (keepFocus) body.querySelector(`[data-key="${CSS.escape(keepFocus)}"]`)?.focus();
  }

  /** Highlight the current row, and scroll it into view when asked. */
  function mark({ reveal = false } = {}) {
    let found = null;
    for (const b of body.querySelectorAll('[data-id]')) {
      const on = b.dataset.id === current;
      b.classList.toggle('is-current', on);
      if (on) { b.setAttribute('aria-current', 'true'); found = b; } else b.removeAttribute('aria-current');
    }
    if (found && reveal && !panel.hidden) found.scrollIntoView({ block: 'nearest' });
  }

  body.addEventListener('mouseover', (ev) => {
    const b = ev.target instanceof Element ? ev.target.closest('[data-id]') : null;
    deps.onHover(b && b.dataset.id !== TERMS_GROUP ? b.dataset.id : null);
  });
  body.addEventListener('mouseleave', () => deps.onHover(null));
  body.addEventListener('focusin', (ev) => {
    const b = ev.target instanceof Element ? ev.target.closest('[data-id]') : null;
    deps.onHover(b ? b.dataset.id : null);
  });
  body.addEventListener('focusout', () => deps.onHover(null));

  return {
    /** Show a new filter result. */
    render(next, text) {
      tree = next;
      if (wasSearching && !tree.searching) closedInSearch.clear();
      wasSearching = tree.searching;
      note.textContent = text;
      paint();
    },
    /** The selected node changed in the graph (or from this list): open its group and highlight its row. */
    setCurrent(id, { reveal = true } = {}) {
      current = id ? rowKeyFor(model, id) : null;
      if (!tree) return;
      const g = current ? groupFor(model, povBySlug, current) : null;
      let rebuilt = false;
      if (g && !isOpen(g) && g !== current) {
        if (tree.searching) closedInSearch.delete(g); else expanded.add(g);
        rebuilt = true;
      }
      if (rebuilt) paint({ reveal }); else mark({ reveal });
    },
    get element() { return panel; },
  };
}
