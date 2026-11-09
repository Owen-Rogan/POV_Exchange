// Pieces shared by the 3D and 2D graph renderers: how big a node is, which
// nodes are lit or dimmed, the intro timing, hit testing, tooltip and labels.

import { neighbourSet } from './graph-data.js';

const DIAMETER = { topic: 12, pov: 6.5, doc: 3.4 };

export function diameter(node) {
  const base = DIAMETER[node.kind] ?? 5;
  return node.kind === 'topic' ? base + Math.min(node.n ?? 0, 6) * 1.1 : base;
}

/** Colours come from CSS custom properties, so light and dark stay in one place. */
export function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  return {
    topic: get('--g-topic', '#4589ff'),
    pov: get('--g-pov', '#a56eff'),
    doc: get('--g-doc', '#42be65'),
    edge: get('--g-edge', '#8d8d8d'),
    lit: get('--g-lit', '#ffffff'),
  };
}

/** '#rgb', '#rrggbb' or 'rgb(r, g, b)' -> [r, g, b] in 0..1. Anything else -> mid grey. */
export function parseColor(text) {
  const s = String(text).trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    const n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  if (m) return [m[1] / 255, m[2] / 255, m[3] / 255];
  return [0.5, 0.5, 0.5];
}

/** Seconds before each node blooms out of the centre: topics, then POVs, then documents. */
export function introDelays(model) {
  const count = { topic: 0, pov: 0, doc: 0 };
  const start = { topic: 0, pov: 0.5, doc: 0.95 };
  const step = { topic: 0.09, pov: 0.06, doc: 0.04 };
  return Float32Array.from(model.nodes, (n) => Math.min(start[n.kind] + step[n.kind] * count[n.kind]++, 2.4));
}

/**
 * Target brightness per node and edge: 1 lit, 0 normal, -1 dimmed.
 * `hover` beats `selected`; `focus` (a Set of node ids, or null) is the search/topic filter.
 */
export function computeTargets(model, { hover, selected, focus }) {
  const active = hover ?? selected ?? null;
  const near = active ? neighbourSet(model, active) : null;
  const inFocus = (id) => !focus || focus.has(id);

  const nodes = new Float32Array(model.nodes.length);
  model.nodes.forEach((n, i) => {
    if (!inFocus(n.id)) nodes[i] = -1;
    else if (near) nodes[i] = n.id === active ? 1 : near.has(n.id) ? 0.7 : -1;
    else nodes[i] = 0;
  });

  const edges = new Float32Array(model.edges.length);
  model.edges.forEach((e, i) => {
    if (!inFocus(e.s) || !inFocus(e.t)) edges[i] = -1;
    else if (active) edges[i] = e.s === active || e.t === active ? 1 : -1;
    else edges[i] = 0;
  });
  return { nodes, edges, active };
}

/** Where the graph sits so it clears the headline: right of it on wide screens; on narrow screens it has its own area. */
export function layoutShift(width, height) {
  return width >= 900 ? { dx: width * 0.17, dy: 0 } : { dx: 0, dy: 0 };
}

/** The node under (x, y), if any. Points are { id, x, y, r, ok }. */
export function nearest(points, x, y, slack = 10) {
  let best = null;
  let bestD = Infinity;
  for (const p of points) {
    if (!p.ok) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= p.r + slack && d < bestD) { best = p.id; bestD = d; }
  }
  return best;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

/** A small label that follows the pointer. Text is set with textContent only. */
export function createTip(stage) {
  const el = document.createElement('div');
  el.className = 'hero-tip';
  el.setAttribute('aria-hidden', 'true');
  el.hidden = true;
  stage.append(el);
  return {
    show(text, x, y) {
      if (el.textContent !== text) el.textContent = text;
      el.hidden = false;
      el.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 14)}px)`;
    },
    hide() { el.hidden = true; },
    remove() { el.remove(); },
  };
}

/** Topic names drawn as HTML over the canvas, so the text stays crisp. */
export function createLabels(stage, model) {
  const layer = document.createElement('div');
  layer.className = 'hero-labels';
  layer.setAttribute('aria-hidden', 'true');
  const items = [];
  model.nodes.forEach((n, i) => {
    if (n.kind !== 'topic') return;
    const el = document.createElement('div');
    el.className = 'hero-label';
    el.textContent = n.label;
    layer.append(el);
    items.push({ i, el, key: '', w: 0, h: 0, topicSize: n.n ?? 0 });
  });
  stage.append(layer);
  // Busiest topics win when two labels would overlap; ties keep a stable order.
  const byPriority = [...items].sort((a, b) => b.topicSize - a.topicSize || a.i - b.i);
  const GAP = 4; // pixels of breathing room between labels
  return {
    /** screen[i] = { x, y, r, a } in CSS pixels; a is 0..1 opacity. */
    update(screen) {
      const placed = [];
      for (const it of byPriority) {
        const s = screen[it.i];
        let key = 'off';
        if (s && s.a > 0.02) {
          if (!it.w) { it.w = it.el.offsetWidth; it.h = it.el.offsetHeight; } // measured once, after first layout
          const x = Math.round(s.x), y = Math.round(s.y + s.r + 4);
          const box = { x0: x - it.w / 2 - GAP, x1: x + it.w / 2 + GAP, y0: y - GAP, y1: y + it.h + GAP };
          const clash = placed.some((p) => box.x0 < p.x1 && p.x0 < box.x1 && box.y0 < p.y1 && p.y0 < box.y1);
          if (!clash) { placed.push(box); key = `${x},${y},${s.a.toFixed(2)}`; }
        }
        if (key === it.key) continue;
        it.key = key;
        if (key === 'off') { it.el.style.opacity = '0'; continue; }
        const [x, y] = key.split(',');
        it.el.style.transform = `translate(${x}px, ${y}px) translateX(-50%)`;
        it.el.style.opacity = s.a.toFixed(2);
      }
    },
    remove() { layer.remove(); },
  };
}
