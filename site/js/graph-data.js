// Shared graph model for the 3D and 2D renderers: loads graph.json, builds the
// adjacency maps, and answers "who is connected to this node". Positions come
// from the build (precomputed), so nothing is simulated here.

export async function loadGraph() {
  const res = await fetch('data/graph.json');
  if (!res.ok) throw new Error('graph.json ' + res.status);
  const graph = await res.json();
  return withIndex(graph);
}

export function withIndex(graph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const adj = new Map(graph.nodes.map((n) => [n.id, new Set()]));
  for (const e of graph.edges) {
    adj.get(e.s)?.add(e.t);
    adj.get(e.t)?.add(e.s);
  }
  return { ...graph, byId, adj };
}

/** The node plus everything one edge away. */
export function neighbourSet(model, id) {
  const set = new Set([id]);
  for (const n of model.adj.get(id) ?? []) set.add(n);
  return set;
}

/** What to show in the detail panel for a node, from povs.json and topics.json. */
export function describe(model, node, povBySlug, topicById) {
  if (node.kind === 'topic') {
    const t = topicById.get(node.ref);
    return { kind: 'Topic', title: node.label, text: t?.view ?? '', meta: `${node.n} POV${node.n === 1 ? '' : 's'}`, href: `#topic-${node.ref}`, cta: 'Jump to this topic' };
  }
  const p = povBySlug.get(node.ref);
  if (node.kind === 'doc') {
    return { kind: 'Document', title: node.label, text: p ? `Attached to: ${p.title}` : '', meta: '', href: `docs/${node.ref}/${encodeURIComponent(node.label)}`, cta: 'Download', download: true };
  }
  return { kind: p?.type === 'document' ? 'Document' : 'POV', title: node.label, text: p?.summary ?? '', meta: p ? `${p.author} \u00B7 ${p.date}` : '', href: `pov/${node.ref}/`, cta: 'Read' };
}
