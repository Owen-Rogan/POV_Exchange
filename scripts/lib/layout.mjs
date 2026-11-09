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
