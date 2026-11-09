// Deterministic 3D force layout, run once at build time.
//
// The browser never simulates: every device reads the same x/y/z from
// data/graph.json, so the picture is stable and the 2D/static views reuse it.
// Only Math.* and plain arithmetic are used, with a fixed seed and sorted
// node order, and results are rounded, so the output is reproducible.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tuned on a 36-POV, 10-topic sample (scripts/make-samples.mjs): strong topic
// repulsion and long topic-to-topic springs keep topic labels apart.
const CHARGE = { topic: 90, pov: 2, doc: 0.5 };
const REST = { parent: 100, link: 95, topic: 80, related: 70, doc: 11 };

/**
 * @param {Array<{id:string, kind:'topic'|'pov'|'doc'}>} nodes
 * @param {Array<{s:string, t:string, k:string}>} edges
 * @returns {Map<string,{x:number,y:number,z:number}>}
 */
export function computeLayout(nodes, edges, { seed = 20261106, iterations = 600, radius = 100, rest: restOverride, charge: chargeOverride } = {}) {
  const CH = { ...CHARGE, ...chargeOverride };
  const RS = { ...REST, ...restOverride };
  const ids = nodes.map((n) => n.id).sort();
  const n = ids.length;
  const result = new Map();
  if (n === 0) return result;
  if (n === 1) { result.set(ids[0], { x: 0, y: 0, z: 0 }); return result; }

  const index = new Map(ids.map((id, i) => [id, i]));
  const kindOf = ids.map((id) => nodes.find((x) => x.id === id).kind);
  const q = kindOf.map((k) => CH[k] ?? 1);
  const rand = mulberry32(seed);

  const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = 30 + rand() * 50;
    px[i] = r * s * Math.cos(th);
    py[i] = r * s * Math.sin(th);
    pz[i] = r * u;
  }

  const links = edges
    .filter((e) => index.has(e.s) && index.has(e.t))
    .map((e) => ({ a: index.get(e.s), b: index.get(e.t), rest: RS[e.k] ?? 40 }));

  const fx = new Float64Array(n), fy = new Float64Array(n), fz = new Float64Array(n);
  for (let it = 0; it < iterations; it++) {
    const temp = 1 - it / iterations;
    const maxStep = 5 * temp + 0.05;
    fx.fill(0); fy.fill(0); fz.fill(0);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = px[i] - px[j], dy = py[i] - py[j], dz = pz[i] - pz[j];
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 0.01) { dx = (rand() - 0.5) * 0.1; dy = (rand() - 0.5) * 0.1; dz = (rand() - 0.5) * 0.1; d2 = 0.01; }
        const d = Math.sqrt(d2);
        const f = (120 * q[i] * q[j]) / d2;
        const ux = dx / d, uy = dy / d, uz = dz / d;
        fx[i] += ux * f; fy[i] += uy * f; fz[i] += uz * f;
        fx[j] -= ux * f; fy[j] -= uy * f; fz[j] -= uz * f;
      }
    }
    for (const { a, b, rest } of links) {
      const dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
      const f = 0.1 * (d - rest);
      const ux = dx / d, uy = dy / d, uz = dz / d;
      fx[a] += ux * f; fy[a] += uy * f; fz[a] += uz * f;
      fx[b] -= ux * f; fy[b] -= uy * f; fz[b] -= uz * f;
    }
    for (let i = 0; i < n; i++) {
      fx[i] -= 0.004 * px[i]; fy[i] -= 0.004 * py[i]; fz[i] -= 0.004 * pz[i];
      let sx = fx[i] * 0.3, sy = fy[i] * 0.3, sz = fz[i] * 0.3;
      const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (len > maxStep) { const k = maxStep / len; sx *= k; sy *= k; sz *= k; }
      px[i] += sx; py[i] += sy; pz[i] += sz;
    }
  }

  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += px[i]; cy += py[i]; cz += pz[i]; }
  cx /= n; cy /= n; cz /= n;
  let max = 0;
  for (let i = 0; i < n; i++) {
    px[i] -= cx; py[i] -= cy; pz[i] -= cz;
    max = Math.max(max, Math.sqrt(px[i] ** 2 + py[i] ** 2 + pz[i] ** 2));
  }
  const scale = max > 0 ? radius / max : 1;
  const round = (v) => Math.round(v * scale * 100) / 100 + 0; // + 0 turns -0 into 0
  for (let i = 0; i < n; i++) result.set(ids[i], { x: round(px[i]), y: round(py[i]), z: round(pz[i]) });
  return result;
}

// ---------------------------------------------------------------------------
// Clustered layout
//
// The force layout above is right for a handful of topics, but run over every
// node it pulls each POV to the middle of all its topics, so lines run a long
// way and the picture turns into a hairball. This places things in layers:
//
//   1. topics         the force layout above, on the topics alone
//   2. POVs           on a sphere around their MAIN topic (the first one listed),
//                     on the side that faces their other topics
//   3. documents      in a small orbit round their POV
//   4. glossary terms on an outer shell, in the direction of the POVs that use them
//
// Everything is deterministic: sorted order, fixed formulas, no randomness.

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit3 = (a) => {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len > 1e-9 ? [a[0] / len, a[1] / len, a[2] / len] : null;
};

function hashOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** A repeatable direction for a name, for when geometry gives none. */
function hashDirection(text) {
  const rand = mulberry32(hashOf(text));
  const u = rand() * 2 - 1;
  const th = rand() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return [s * Math.cos(th), u, s * Math.sin(th)];
}

/** How far POVs sit from their topic: grows with the number of POVs so crowded topics stay readable. */
export const clusterRadius = (count) => 12 + 2.6 * Math.sqrt(count);

/** n points spread evenly over a unit sphere. */
export function fibonacciSphere(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * i + 1) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * GOLDEN_ANGLE;
    out.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return out;
}

/** Push topic centres apart until their clusters (plus a gap) no longer touch. */
function separate(ids, centre, rad, gap = 16) {
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = centre.get(ids[i]), b = centre.get(ids[j]);
        const need = rad.get(ids[i]) + rad.get(ids[j]) + gap;
        let d = sub3(b, a);
        let len = Math.hypot(d[0], d[1], d[2]);
        if (len >= need) continue;
        if (len < 0.01) { d = hashDirection(ids[i] + ids[j]); len = 1; }
        const push = (need - len) / 2;
        const u = mul3(d, 1 / len);
        centre.set(ids[i], sub3(a, mul3(u, push)));
        centre.set(ids[j], add3(b, mul3(u, push)));
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/** Spread directions over the unit sphere so no two are closer than `minAngle`. */
function spreadDirections(dirs, minAngle) {
  const cosMin = Math.cos(minAngle);
  for (let pass = 0; pass < 100; pass++) {
    let moved = false;
    for (let i = 0; i < dirs.length; i++) {
      for (let j = i + 1; j < dirs.length; j++) {
        if (dot3(dirs[i], dirs[j]) <= cosMin) continue;
        let away = sub3(dirs[i], dirs[j]);
        if (Math.hypot(away[0], away[1], away[2]) < 1e-6) away = hashDirection(`${i}:${j}`);
        const k = 0.08;
        dirs[i] = unit3(add3(dirs[i], mul3(away, k))) ?? dirs[i];
        dirs[j] = unit3(sub3(dirs[j], mul3(away, k))) ?? dirs[j];
        moved = true;
      }
    }
    if (!moved) break;
  }
  return dirs;
}

/**
 * @param {{topics: Array<{id:string, parent?:string|null, related?:string[]}>,
 *          povs: Array<{id:string, topics:string[], docs?:string[]}>,
 *          terms?: Array<{id:string, uses:string[]}>}} input   ids are the final node ids
 * @returns {Map<string,{x:number,y:number,z:number}>}
 */
export function computeClusterLayout({ topics, povs, terms = [] }, { radius = 100, termShell = 1.18 } = {}) {
  const result = new Map();
  if (!topics.length && !povs.length) return result;

  // 1. Topics, by the force layout, from the topic-to-topic edges alone.
  const edges = [];
  for (const t of topics) {
    if (t.parent) edges.push({ s: t.id, t: t.parent, k: 'parent' });
    for (const r of t.related ?? []) edges.push({ s: t.id, t: r, k: 'topic' });
  }
  const base = computeLayout(topics.map((t) => ({ id: t.id, kind: 'topic' })), edges, { radius: 100 });

  const mainOf = new Map(topics.map((t) => [t.id, []]));
  for (const p of povs) if (mainOf.has(p.topics[0])) mainOf.get(p.topics[0]).push(p);
  for (const list of mainOf.values()) list.sort((a, b) => (a.id < b.id ? -1 : 1));

  const ids = topics.map((t) => t.id);
  const centre = new Map();
  const rad = new Map();
  for (const id of ids) {
    const b = base.get(id) ?? { x: 0, y: 0, z: 0 };
    centre.set(id, [b.x, b.y, b.z]);
    rad.set(id, clusterRadius(mainOf.get(id).length) + 6); // + 6 leaves room for documents
  }
  separate(ids, centre, rad);

  // 2 and 3. POVs on a sphere round their main topic, documents orbiting each POV.
  const pos = new Map();
  for (const id of ids) pos.set(id, centre.get(id));
  for (const id of ids) {
    const list = mainOf.get(id);
    if (!list.length) continue;
    const c = centre.get(id);
    const r = clusterRadius(list.length);
    const pts = fibonacciSphere(list.length);
    const taken = new Array(pts.length).fill(false);
    const slot = new Array(list.length).fill(-1);

    // A POV that also belongs to other topics claims the free point that faces them.
    list.forEach((p, i) => {
      const facing = p.topics.slice(1).map((o) => centre.get(o)).filter(Boolean).map((oc) => unit3(sub3(oc, c))).filter(Boolean);
      const want = facing.length ? unit3(facing.reduce(add3, [0, 0, 0])) : null;
      if (!want) return;
      let best = -1, bestDot = -Infinity;
      pts.forEach((u, k) => { if (!taken[k]) { const d = dot3(u, want); if (d > bestDot) { bestDot = d; best = k; } } });
      taken[best] = true;
      slot[i] = best;
    });
    let next = 0;
    list.forEach((p, i) => { if (slot[i] < 0) { while (taken[next]) next++; taken[next] = true; slot[i] = next; } });

    list.forEach((p, i) => {
      const u = pts[slot[i]];
      const P = add3(c, mul3(u, r));
      pos.set(p.id, P);
      const docs = p.docs ?? [];
      if (!docs.length) return;
      const a = unit3(cross3(u, Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
      const b = cross3(u, a);
      docs.forEach((docId, k) => {
        const th = (k / docs.length) * Math.PI * 2 + 0.7;
        const d = unit3(add3(mul3(u, 0.55), mul3(add3(mul3(a, Math.cos(th)), mul3(b, Math.sin(th))), 0.83)));
        pos.set(docId, add3(P, mul3(d, 6)));
      });
    });
  }
  for (const p of povs) if (!pos.has(p.id)) pos.set(p.id, mul3(hashDirection(p.id), 20)); // a POV whose topic is unknown

  // Centre the graph and scale it so the farthest non-term node is `radius` away.
  const all = [...pos.values()];
  const mean = mul3(all.reduce(add3, [0, 0, 0]), 1 / all.length);
  let max = 0;
  for (const [k, v] of pos) { const c = sub3(v, mean); pos.set(k, c); max = Math.max(max, Math.hypot(c[0], c[1], c[2])); }
  const scale = max > 0 ? radius / max : 1;
  for (const [k, v] of pos) pos.set(k, mul3(v, scale));

  // 4. Glossary terms on an outer shell, towards the POVs that use them.
  const dirs = terms.map((t) => {
    const sum = t.uses.map((u) => pos.get(u)).filter(Boolean).map((p) => unit3(p)).filter(Boolean).reduce(add3, [0, 0, 0]);
    return unit3(sum) ?? hashDirection(t.id);
  });
  const minAngle = Math.min(0.45, Math.sqrt((4 * Math.PI) / Math.max(terms.length, 1)) * 0.8);
  spreadDirections(dirs, minAngle);
  terms.forEach((t, i) => pos.set(t.id, mul3(dirs[i], radius * termShell)));

  const round = (v) => Math.round(v * 100) / 100 + 0; // + 0 turns -0 into 0
  for (const [k, v] of pos) result.set(k, { x: round(v[0]), y: round(v[1]), z: round(v[2]) });
  return result;
}
