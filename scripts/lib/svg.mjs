// Build-time SVG snapshots of the knowledge graph.
//
// Used twice: the hero poster (shown instantly, and as the whole hero for the
// static tier) and the small "where this sits" map on each POV page. Both read
// the same precomputed x/y/z from graph.json, so they always agree with the
// animated version. Colours come from CSS classes, so light and dark both work.
// No style attributes are written (the site's CSP forbids inline styles).

import { esc } from './html.mjs';

const YAW = 0.62;
const PITCH = 0.3;
const CAM = 320;

const r2 = (v) => Math.round(v * 100) / 100;

function project(n) {
  const cy = Math.cos(YAW), sy = Math.sin(YAW), cp = Math.cos(PITCH), sp = Math.sin(PITCH);
  const x1 = n.x * cy + n.z * sy;
  const z1 = -n.x * sy + n.z * cy;
  const y2 = n.y * cp - z1 * sp;
  const z2 = n.y * sp + z1 * cp;
  const s = CAM / (CAM - z2);
  return { x: x1 * s, y: -y2 * s, z: z2, s };
}

const radius = (n, s) => {
  const base = n.kind === 'topic' ? 3.4 + Math.min(n.n ?? 0, 6) * 0.55 : n.kind === 'pov' ? 2.3 : 1.1;
  return r2(base * s);
};

const clip = (text, max) => {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max - 1).join('') + '\u2026' : text;
};

/**
 * @param {{nodes:Array, edges:Array}} graph  graph.json contents
 * @param {object} opts
 * @param {Set<string>|null} opts.keep      node ids to draw (null = all)
 * @param {string|null} opts.current        node id drawn as the highlighted one
 * @param {string} opts.className           class on the <svg>
 * @param {string} opts.ariaLabel           accessible name (role=group), or '' for decorative
 * @param {Set<string>} opts.labelKinds     node kinds that get a text label
 * @param {(node)=>string|null} [opts.href] link target for a node (POV nodes in the mini map)
 * @param {number} [opts.pad]               padding around the drawing, in svg units
 */
export function graphSvg(graph, { keep = null, current = null, className, ariaLabel = '', labelKinds, href = null, pad = 14 }) {
  const nodes = graph.nodes.filter((n) => !keep || keep.has(n.id));
  if (nodes.length === 0) return '';
  const pos = new Map(nodes.map((n) => [n.id, project(n)]));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const n of nodes) {
    const p = pos.get(n.id);
    const r = radius(n, p.s);
    minx = Math.min(minx, p.x - r); maxx = Math.max(maxx, p.x + r);
    miny = Math.min(miny, p.y - r); maxy = Math.max(maxy, p.y + r + (labelKinds.has(n.kind) ? 12 : 0));
  }
  const w = Math.max(maxx - minx, 40) + pad * 2;
  const h = Math.max(maxy - miny, 40) + pad * 2;
  const vb = `${r2(minx - pad)} ${r2(miny - pad)} ${r2(w)} ${r2(h)}`;

  const lines = [];
  for (const e of graph.edges) {
    const a = pos.get(e.s), b = pos.get(e.t);
    if (!a || !b) continue;
    const smp = byId.get(e.s)?.sample || byId.get(e.t)?.sample ? ' smp' : '';
    lines.push(`<line class="e e-${esc(e.k)}${smp}" x1="${r2(a.x)}" y1="${r2(a.y)}" x2="${r2(b.x)}" y2="${r2(b.y)}" vector-effect="non-scaling-stroke"/>`);
  }

  const drawn = [...nodes].sort((a, b) => pos.get(a.id).z - pos.get(b.id).z);
  const shapes = drawn.map((n) => {
    const p = pos.get(n.id);
    const r = radius(n, p.s);
    const cls = `n n-${n.kind}${n.id === current ? ' cur' : ''}${n.sample ? ' smp' : ''}`;
    const circle = `<circle class="${cls}" cx="${r2(p.x)}" cy="${r2(p.y)}" r="${r}"/>`;
    const label = labelKinds.has(n.kind)
      ? `<text class="lbl lbl-${n.kind}${n.sample ? ' smp' : ''}" x="${r2(p.x)}" y="${r2(p.y + r + 7)}" text-anchor="middle">${esc(clip(n.label, 26))}</text>`
      : '';
    const target = href ? href(n) : null;
    if (target) {
      return `<a href="${esc(target)}"><title>${esc(n.label)}</title>${circle}${label}</a>`;
    }
    return circle + label;
  });

  const a11y = ariaLabel
    ? `role="group" aria-label="${esc(ariaLabel)}"`
    : 'aria-hidden="true"';
  return `<svg class="${esc(className)}" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" focusable="false" ${a11y}>
<g class="edges">${lines.join('')}</g>
<g class="nodes">${shapes.join('')}</g>
</svg>`;
}

/**
 * The nodes shown on a POV's "where this sits" map: the POV, its topics, its
 * documents, POVs it lists as related, and up to three other POVs per topic.
 */
export function neighbourhood(graph, slug) {
  const start = `p:${slug}`;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const adj = new Map(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) {
    adj.get(e.s)?.push(e.t);
    adj.get(e.t)?.push(e.s);
  }
  const order = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const keep = new Set([start]);
  const topics = [];
  for (const id of adj.get(start) ?? []) {
    const n = byId.get(id);
    if (n.kind === 'topic') topics.push(id);
    keep.add(id);
  }
  for (const t of topics) {
    const others = (adj.get(t) ?? [])
      .filter((id) => byId.get(id).kind === 'pov' && !keep.has(id))
      .sort((a, b) => order.get(a) - order.get(b))
      .slice(0, 3);
    for (const id of others) keep.add(id);
  }
  return keep;
}
