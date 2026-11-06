// Home page: starts the hero graph at the right tier, wires selection to the
// detail panel, and connects the search/topic filters to the graph.

import { describe, withIndex } from './graph-data.js';
import { initExplore } from './explore.js';
import { createPanel } from './panel.js';
import { pickTier } from './tier.js';

async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

/** Which graph nodes stay lit for the current filter (null = no filter). */
function focusFor(model, view) {
  if (!model || !view.active) return null;
  const set = new Set();
  for (const slug of view.slugs) {
    const id = `p:${slug}`;
    set.add(id);
    for (const n of model.adj.get(id) ?? []) if (model.byId.get(n).kind !== 'pov') set.add(n);
  }
  if (view.topic) set.add(`t:${view.topic}`);
  return set;
}

export async function initHome() {
  const hero = document.getElementById('hero');
  const stage = hero?.querySelector('[data-hero-stage]');
  if (!hero || !stage) return;

  const picked = pickTier();
  hero.dataset.tier = picked.tier;
  hero.dataset.reason = picked.reason;

  let model = null;
  let renderer = null;
  let selected = null;
  let view = { slugs: new Set(), topic: '', active: false };
  const topicById = new Map();
  const povBySlug = new Map();

  const panel = createPanel(hero, { onClose: () => select(null) });

  function select(id, opts) {
    if (id && !model?.byId.has(id)) id = null;
    selected = id;
    renderer?.setSelected(id);
    if (!id) { panel.hide(); return; }
    panel.show(describe(model, model.byId.get(id), povBySlug, topicById), opts);
  }

  initExplore({
    onChange(next) {
      view = next;
      renderer?.setFocus(focusFor(model, view));
    },
  });

  addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && selected) select(null);
  });

  // Browse-as-list: open the list when it is the target of a link or the URL.
  const list = document.getElementById('list');
  const openList = () => { if (list && location.hash === '#list') list.open = true; };
  addEventListener('hashchange', openList);
  openList();

  // The list mirrors the graph: focusing a list item lights its node.
  for (const a of document.querySelectorAll('#nodelist a[data-node]')) {
    const id = a.dataset.node;
    const on = () => renderer?.setHover(id);
    const off = () => renderer?.setHover(null);
    a.addEventListener('focus', on);
    a.addEventListener('blur', off);
    a.addEventListener('mouseenter', on);
    a.addEventListener('mouseleave', off);
  }

  if (picked.tier === 'static') return;

  async function start(tier) {
    const [graph, povs, topics] = await Promise.all([
      getJson('data/graph.json'), getJson('data/povs.json'), getJson('data/topics.json'),
    ]);
    model = withIndex(graph);
    for (const p of povs) povBySlug.set(p.slug, p);
    for (const t of topics) topicById.set(t.id, t);

    const handlers = {
      onHover() {},
      onSelect: (id) => select(id),
      onLost: () => { renderer?.destroy(); renderer = null; start2D(); },
    };
    async function start2D() {
      try {
        const { create2D } = await import('./graph2d.js');
        renderer = create2D(stage, model, handlers);
        ready();
      } catch (err) {
        console.warn('POV Exchange: graph unavailable, showing the static picture.', err);
        hero.dataset.tier = 'static';
        stage.classList.remove('live');
      }
    }
    function ready() {
      hero.dataset.tier = renderer.kind;
      renderer.setFocus(focusFor(model, view));
      if (selected) renderer.setSelected(selected);
      requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.add('live')));
    }

    if (tier === 'full') {
      try {
        const { create3D } = await import('./graph3d.js');
        renderer = create3D(stage, model, handlers);
        ready();
        return;
      } catch (err) {
        console.warn('POV Exchange: 3D not available, using the 2D graph.', err);
      }
    }
    await start2D();
  }

  try {
    await start(picked.tier);
  } catch (err) {
    console.warn('POV Exchange: could not load the graph data.', err);
    hero.dataset.tier = 'static';
  }
}
