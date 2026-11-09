// Pieces shared by the 3D and 2D renderers and the engine: node sizes, colours,
// which nodes are lit or dimmed, the intro timing, hit testing, and the tooltip.

import { neighbourSet } from './graph-data.js';

const SIZE = { topic: 12, pov: 6.5, doc: 3.4, term: 4.6 };

/** World-space size of a node. Bigger topics for busier topics. */
export function diameter(node) {
  const base = SIZE[node.kind] ?? 5;
  return node.kind === 'topic' ? base + Math.min(node.n ?? 0, 6) * 1.1 : base;
}

/** Core diameter in CSS pixels for a node of `size` at `ppu` pixels per world unit. Shared by both renderers. */
export function nodePixels(size, ppu) {
  return clamp(size * 0.31 * ppu, 2.4, 60);
}

/** Colours come from CSS custom properties, so light and dark stay in one place. */
export function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  return {
    topic: get('--g-topic', '#4589ff'),
    pov: get('--g-pov', '#a56eff'),
    doc: get('--g-doc', '#42be65'),
    term: get('--g-term', '#ff832b'),
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
  const count = { topic: 0, pov: 0, doc: 0, term: 0 };
  const start = { topic: 0, pov: 0.5, doc: 0.95, term: 1.15 };
  const step = { topic: 0.09, pov: 0.06, doc: 0.04, term: 0.03 };
  return Float32Array.from(model.nodes, (n) => Math.min(start[n.kind] + step[n.kind] * count[n.kind]++, 2.4));
}

/** Edge kinds that stay out of sight until one end is the selected or hovered node. */
export const QUIET_EDGES = new Set(['link2', 'term']);

/**
 * Which edges are drawn at all: 1 shows, 0 hides. The picture is calm by default, with the lines that carry
 * the structure (topic to topic, each POV to its main topic, documents, related POVs). A POV's other topics
 * and its glossary terms are drawn only for the node you have selected or are pointing at, so the lines
 * explain the one thing you are looking at instead of crossing everything.
 * @param {object} model   from withIndex()
 * @param {string|null} active  the selected or hovered node id
 */
export function edgeReveal(model, active) {
  return Uint8Array.from(model.edges, (e) => (!QUIET_EDGES.has(e.k) || (active !== null && (e.s === active || e.t === active)) ? 1 : 0));
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

/**
 * The node under (x, y), if any. Points are { id, x, y, r, ok, depth }.
 * The closest centre wins; when two are about equally close the one nearer the camera wins.
 */
export function nearest(points, x, y, slack = 10) {
  let best = null;
  let bestScore = Infinity;
  for (const p of points) {
    if (!p.ok) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d > p.r + slack) continue;
    const score = d + (p.depth ?? 0) * 0.002;
    if (score < bestScore) { best = p.id; bestScore = score; }
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

/**
 * Labels drawn as HTML over the canvas, so text stays crisp. A small pool of
 * elements is reused: `place(chosen)` takes a Map of node index -> {x, y} (from
 * chooseLabels) and shows exactly those.
 */
export function createLabelLayer(stage, model) {
  const layer = document.createElement('div');
  layer.className = 'hero-labels';
  layer.setAttribute('aria-hidden', 'true');
  stage.append(layer);
  const free = [];
  const used = new Map(); // node index -> { el, key }

  const clip = (text, max) => {
    const chars = Array.from(text);
    return chars.length > max ? chars.slice(0, max - 1).join('') + '\u2026' : text;
  };
  const take = () => {
    const el = free.pop() ?? document.createElement('div');
    if (!el.parentNode) layer.append(el);
    return el;
  };

  return {
    place(chosen) {
      for (const [i, entry] of used) {
        if (!chosen.has(i)) {
          entry.el.style.opacity = '0';
          entry.el.hidden = true;
          free.push(entry.el);
          used.delete(i);
        }
      }
      for (const [i, pos] of chosen) {
        let entry = used.get(i);
        if (!entry) {
          const node = model.nodes[i];
          const el = take();
          el.hidden = false;
          el.className = `hero-label l-${node.kind}`;
          el.textContent = clip(node.label, node.kind === 'topic' ? 40 : 34);
          entry = { el, key: '' };
          used.set(i, entry);
        }
        const key = `${pos.x},${pos.y}`;
        if (key !== entry.key) {
          entry.key = key;
          entry.el.style.transform = `translate(${pos.x}px, ${pos.y}px) translateX(-50%)`;
        }
        entry.el.style.opacity = '1';
      }
    },
    remove() { layer.remove(); },
  };
}

/** Estimated label box for collision checks, without measuring the DOM each frame. */
export function labelBox(kind, label) {
  const chars = Math.min(Array.from(label).length, kind === 'topic' ? 40 : 34);
  return kind === 'topic' ? { w: chars * 8.6 + 6, h: 16 } : { w: chars * 6.6 + 6, h: 15 };
}
