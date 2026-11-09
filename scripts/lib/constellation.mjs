// The "constellation": a still picture of the knowledge graph for the Library
// preview and the Graph page's no-JavaScript poster.
//
// The live graph is 3D and dense. Flattening all of it turns into a hairball,
// so this picture shows only what reads at a glance:
//   - topics as sized circles holding their POV count, with a name beside them
//   - POVs as small faint dots near their topic (no lines to them)
//   - lines between topics only
//
// Everything is deterministic (no Math.random, a fixed relaxation), so the same
// content always gives the same picture. Colours come from CSS classes, and no
// style attributes are written (the site's CSP forbids inline styles).

import { esc } from './html.mjs';

const DEFAULT_W = 520;
const DEFAULT_H = 340;
export const W = DEFAULT_W; // default drawing size in svg units, close to the size it is shown at
export const H = DEFAULT_H;
const MARGIN = { x: 30, top: 24, bottom: 30 };
const FONT = 13.5;
const GAP = 4;
const MAX_LABEL = 24;

const r2 = (v) => Math.round(v * 100) / 100;

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const unit = (seed) => {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a) => Math.hypot(a[0], a[1], a[2]);

function powerAxis(cov, start) {
  let v = start;
  for (let i = 0; i < 80; i++) {
    const next = [dot3(cov[0], v), dot3(cov[1], v), dot3(cov[2], v)];
    const len = norm3(next);
    if (len < 1e-9) return { v: null, value: 0 };
    v = next.map((c) => c / len);
  }
  const value = dot3([dot3(cov[0], v), dot3(cov[1], v), dot3(cov[2], v)], v);
  // Fix the sign so the result never flips between builds.
  let big = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(v[i]) > Math.abs(v[big])) big = i;
  return { v: v[big] < 0 ? v.map((c) => -c) : v, value };
}

/** The two directions along which the points spread out the most. Falls back to x and y. */
export function principalAxes(points) {
  const n = points.length;
  const mean = [0, 0, 0];
  for (const p of points) for (let i = 0; i < 3; i++) mean[i] += p[i] / n;
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) {
    const d = [p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += (d[i] * d[j]) / n;
  }
  const first = powerAxis(cov, [1, 0.37, 0.21]);
  if (!first.v) return { mean, e1: [1, 0, 0], e2: [0, 1, 0] };
  const deflated = cov.map((row, i) => row.map((c, j) => c - first.value * first.v[i] * first.v[j]));
  let start = [0.19, 1, 0.43];
  const k = dot3(start, first.v);
  start = start.map((c, i) => c - k * first.v[i]);
  const second = powerAxis(deflated, start);
  let e2 = second.v;
  if (!e2) {
    // Points on a line: take any direction at right angles to the first.
    e2 = Math.abs(first.v[0]) < 0.9 ? [0, -first.v[2], first.v[1]] : [-first.v[2], 0, first.v[0]];
    const len = norm3(e2);
    e2 = e2.map((c) => c / len);
  }
  return { mean, e1: first.v, e2 };
}

/** Circle radius from POV count. */
export const radiusFor = (count) => 11 + Math.min(count, 30) * 0.4;

/** Push circles apart until labels have room. Deterministic and bounded. */
function relax(items, W, H) {
  for (let pass = 0; pass < 90; pass++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        const need = a.r + b.r + 50;
        if (d >= need) continue;
        if (d < 0.01) { const ang = (hash(a.id + b.id) % 628) / 100; dx = Math.cos(ang); dy = Math.sin(ang); d = 1; }
        const push = (need - d) / 2;
        a.x -= (dx / d) * push; a.y -= (dy / d) * push;
        b.x += (dx / d) * push; b.y += (dy / d) * push;
        moved = true;
      }
    }
    for (const it of items) {
      it.x = Math.min(W - MARGIN.x, Math.max(MARGIN.x, it.x));
      it.y = Math.min(H - MARGIN.bottom, Math.max(MARGIN.top, it.y));
    }
    if (!moved) break;
  }
}

const clip = (text, max) => {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max - 1).join('') + '\u2026' : text;
};
const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Pick a spot for each label: below, above, right or left of its circle, the
 * first that fits without touching another label or circle. A label that fits
 * nowhere is dropped (the circle and its count stay). Busier topics choose first.
 */
export function placeLabels(items, W = DEFAULT_W, H = DEFAULT_H) {
  const order = [...items].sort((a, b) => b.n - a.n || (a.label < b.label ? -1 : 1));
  const placed = [];
  for (const it of order) {
    const text = clip(it.label, MAX_LABEL);
    const tw = Array.from(text).length * FONT * 0.58 + 4;
    const h = FONT + 3;
    const spots = [
      { dir: 'below', anchor: 'middle', x: it.x, box: { x0: it.x - tw / 2, y0: it.y + it.r + 4, x1: it.x + tw / 2, y1: it.y + it.r + 4 + h } },
      { dir: 'above', anchor: 'middle', x: it.x, box: { x0: it.x - tw / 2, y0: it.y - it.r - 4 - h, x1: it.x + tw / 2, y1: it.y - it.r - 4 } },
      { dir: 'right', anchor: 'start', x: it.x + it.r + 6, box: { x0: it.x + it.r + 6, y0: it.y - h / 2, x1: it.x + it.r + 6 + tw, y1: it.y + h / 2 } },
      { dir: 'left', anchor: 'end', x: it.x - it.r - 6, box: { x0: it.x - it.r - 6 - tw, y0: it.y - h / 2, x1: it.x - it.r - 6, y1: it.y + h / 2 } },
    ];
    it.label_ = null;
    for (const s of spots) {
      const b = s.box;
      if (b.x0 < 3 || b.x1 > W - 3 || b.y0 < 3 || b.y1 > H - 3) continue;
      const padded = { x0: b.x0 - GAP, y0: b.y0 - GAP, x1: b.x1 + GAP, y1: b.y1 + GAP };
      if (placed.some((p) => overlap(padded, p.box))) continue;
      const hitsCircle = items.some((o) => o !== it && overlap(padded, { x0: o.x - o.r - 2, y0: o.y - o.r - 2, x1: o.x + o.r + 2, y1: o.y + o.r + 2 }));
      if (hitsCircle) continue;
      it.label_ = { text, dir: s.dir, anchor: s.anchor, x: r2(s.x), y: r2(b.y0 + FONT * 0.86), box: b };
      placed.push({ box: padded });
      break;
    }
  }
  return items;
}

const DIR_ANGLE = { below: Math.PI / 2, above: -Math.PI / 2, right: 0, left: Math.PI };

/**
 * @param {{nodes:Array, edges:Array}} graph graph.json contents
 * @param {object} opts
 * @param {string} opts.className  class on the <svg>
 * @param {(topicRef:string)=>string|null} [opts.href] link target per topic, or omit for a plain picture
 * @param {string} [opts.ariaLabel] accessible name; omit for a decorative picture
 */
export function constellationSvg(graph, { className, href = null, ariaLabel = '', width = DEFAULT_W, height = DEFAULT_H }) {
  const W = width, H = height;
  const topics = graph.nodes.filter((n) => n.kind === 'topic');
  if (!topics.length) return '';

  // 1. Spread the topics along their two main directions and scale to fit.
  const axes = principalAxes(topics.map((t) => [t.x, t.y, t.z]));
  const flat = topics.map((t) => {
    const d = [t.x - axes.mean[0], t.y - axes.mean[1], t.z - axes.mean[2]];
    return { id: t.id, ref: t.ref, label: t.label, n: t.n ?? 0, sample: Boolean(t.sample), u: dot3(d, axes.e1), v: dot3(d, axes.e2) };
  });
  const us = flat.map((f) => f.u), vs = flat.map((f) => f.v);
  const spanU = Math.max(Math.max(...us) - Math.min(...us), 1e-6);
  const spanV = Math.max(Math.max(...vs) - Math.min(...vs), 1e-6);
  const availW = W - MARGIN.x * 2, availH = H - MARGIN.top - MARGIN.bottom;
  const scale = flat.length === 1 ? 1 : Math.min(availW / spanU, availH / spanV);
  const cu = (Math.max(...us) + Math.min(...us)) / 2, cv = (Math.max(...vs) + Math.min(...vs)) / 2;
  for (const f of flat) {
    f.x = W / 2 + (f.u - cu) * scale;
    f.y = MARGIN.top + availH / 2 + (f.v - cv) * scale;
    f.r = radiusFor(f.n);
  }
  relax(flat, W, H);
  placeLabels(flat, W, H);
  const byId = new Map(flat.map((f) => [f.id, f]));

  // 2. Lines between topics only.
  const lines = [];
  const seen = new Set();
  for (const e of graph.edges) {
    if (e.k !== 'parent' && e.k !== 'topic') continue;
    const a = byId.get(e.s), b = byId.get(e.t);
    if (!a || !b) continue;
    const key = [e.s, e.t].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const bend = (hash(key) % 2 ? 1 : -1) * len * 0.12;
    const cx = (a.x + b.x) / 2 + (-dy / len) * bend, cy = (a.y + b.y) / 2 + (dx / len) * bend;
    const smp = a.sample || b.sample ? ' smp' : '';
    lines.push(`<path class="cn-edge${smp}" d="M${r2(a.x)} ${r2(a.y)}Q${r2(cx)} ${r2(cy)} ${r2(b.x)} ${r2(b.y)}"/>`);
  }

  // 3. POVs as faint dots on the side of their topic away from its label.
  const topicOf = new Map();
  for (const e of graph.edges) {
    if (e.k !== 'link') continue;
    const [pov, topic] = e.s.startsWith('p:') ? [e.s, e.t] : [e.t, e.s];
    if (pov.startsWith('p:') && byId.has(topic) && !topicOf.has(pov)) topicOf.set(pov, topic);
  }
  const labelBoxes = flat.filter((f) => f.label_).map((f) => ({ x0: f.label_.box.x0 - 2, y0: f.label_.box.y0 - 2, x1: f.label_.box.x1 + 2, y1: f.label_.box.y1 + 2 }));
  const dots = [];
  for (const n of graph.nodes) {
    if (n.kind !== 'pov') continue;
    const home = byId.get(topicOf.get(n.id));
    if (!home) continue;
    const away = home.label_ ? DIR_ANGLE[home.label_.dir] + Math.PI : null;
    let pos = null;
    for (let attempt = 0; attempt < 6 && !pos; attempt++) {
      const s = hash(`${n.id}#${attempt}`);
      const ang = away === null ? unit(s) * Math.PI * 2 : away + (unit(s) - 0.5) * Math.PI * 1.5;
      const dist = home.r + 8 + unit(s ^ 0x9e3779b1) * 26;
      const x = home.x + Math.cos(ang) * dist, y = home.y + Math.sin(ang) * dist;
      if (x < 4 || x > W - 4 || y < 4 || y > H - 4) continue;
      const p = { x0: x - 2, y0: y - 2, x1: x + 2, y1: y + 2 };
      if (labelBoxes.some((b) => overlap(p, b))) continue;
      pos = { x, y };
    }
    if (!pos) continue; // no free spot: leave this dot out rather than clutter a label
    const cls = `cn-dot${n.sample ? ' smp' : ''}${n.status === 'draft' ? ' drf' : ''}`;
    dots.push(`<circle class="${cls}" cx="${r2(pos.x)}" cy="${r2(pos.y)}" r="2.3"/>`);
  }

  // 4. Topics on top: circle, count, name.
  const shapes = flat.map((f) => {
    const target = href ? href(f.ref) : null;
    const label = f.label_
      ? `<text class="cn-label" x="${f.label_.x}" y="${f.label_.y}" text-anchor="${f.label_.anchor}">${esc(f.label_.text)}</text>`
      : '';
    const body = `<circle class="cn-circle" cx="${r2(f.x)}" cy="${r2(f.y)}" r="${r2(f.r)}"/><text class="cnt" x="${r2(f.x)}" y="${r2(f.y)}">${f.n}</text>${label}`;
    const cls = `cn-topic${f.sample ? ' smp' : ''}`;
    const title = `<title>${esc(f.label)}, ${f.n} ${f.n === 1 ? 'POV' : 'POVs'}</title>`;
    return target
      ? `<a class="${cls}" data-topic="${esc(f.ref)}" href="${esc(target)}">${title}${body}</a>`
      : `<g class="${cls}" data-topic="${esc(f.ref)}">${body}</g>`;
  });

  const a11y = ariaLabel ? `role="group" aria-label="${esc(ariaLabel)}"` : 'aria-hidden="true"';
  return `<svg class="${esc(className)}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" focusable="false" ${a11y}>
<g class="cn-edges">${lines.join('')}</g>
<g class="cn-dots">${dots.join('')}</g>
<g class="cn-topics">${shapes.join('')}</g>
</svg>`;
}
