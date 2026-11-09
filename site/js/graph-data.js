// Shared graph model: adjacency maps over graph.json, and "what is connected to
// this node" for the reader panel. Positions come from the build (precomputed),
// so nothing is simulated in the browser. Pure functions, no DOM.

export function withIndex(graph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const index = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const adj = new Map(graph.nodes.map((n) => [n.id, new Set()]));
  for (const e of graph.edges) {
    adj.get(e.s)?.add(e.t);
    adj.get(e.t)?.add(e.s);
  }
  return { ...graph, byId, index, adj };
}

/** The node plus everything one edge away. */
export function neighbourSet(model, id) {
  const set = new Set([id]);
  for (const n of model.adj.get(id) ?? []) set.add(n);
  return set;
}

const byDateDesc = (model) => (a, b) => {
  const da = model.byId.get(a)?.date ?? '';
  const db = model.byId.get(b)?.date ?? '';
  return da < db ? 1 : da > db ? -1 : a < b ? -1 : 1;
};

/**
 * Grouped connections for a node, as node ids.
 *   topic: povs (newest first), topics (parent, children and related topics)
 *   pov:   topics, related (POV to POV), siblings (other POVs on the same topics), docs
 *   doc:   pov (its parent POV)
 * `siblings` is limited to `limit` entries and `moreSiblings` says how many were left out.
 */
export function connections(model, id, { limit = 8 } = {}) {
  const node = model.byId.get(id);
  const out = { topics: [], related: [], siblings: [], moreSiblings: 0, docs: [], povs: [], terms: [], pov: null };
  if (!node) return out;
  const near = [...(model.adj.get(id) ?? [])];
  const kind = (nid) => model.byId.get(nid)?.kind;

  if (node.kind === 'topic') {
    out.povs = near.filter((n) => kind(n) === 'pov').sort(byDateDesc(model));
    out.topics = near.filter((n) => kind(n) === 'topic').sort();
  } else if (node.kind === 'term') {
    out.povs = near.filter((n) => kind(n) === 'pov').sort(byDateDesc(model));
  } else if (node.kind === 'pov') {
    out.terms = near.filter((n) => kind(n) === 'term').sort();
    out.topics = near.filter((n) => kind(n) === 'topic').sort();
    out.related = near.filter((n) => kind(n) === 'pov').sort(byDateDesc(model));
    out.docs = near.filter((n) => kind(n) === 'doc').sort();
    const seen = new Set([id, ...out.related]);
    const siblings = [];
    for (const t of out.topics) {
      for (const n of model.adj.get(t) ?? []) {
        if (kind(n) === 'pov' && !seen.has(n)) { seen.add(n); siblings.push(n); }
      }
    }
    siblings.sort(byDateDesc(model));
    out.siblings = siblings.slice(0, limit);
    out.moreSiblings = Math.max(0, siblings.length - limit);
  } else if (node.kind === 'doc') {
    out.pov = near.find((n) => kind(n) === 'pov') ?? null;
  }
  return out;
}
