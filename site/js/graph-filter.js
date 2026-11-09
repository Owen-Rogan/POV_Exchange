// Which graph nodes are visible or lit for the current search, topic, date
// cut-off and sample switch. Pure functions over the graph model, so they can
// be tested without a browser.
//
//   visible(node)  true when the node is shown at all (samples, time)
//   matched(node)  true when it also matches the search and topic filters
//
// A node that is visible but not matched is dimmed. A node that is not visible
// is eased out of view.

const norm = (s) => String(s ?? '').toLowerCase();

/**
 * @param {object} model       from withIndex()
 * @param {Map} povBySlug      slug -> { title, summary, author, topics, ... }
 * @param {Map} topicById      id -> { title, ... }
 * @param {{q:string, topic:string, samples:boolean, until:string|null}} f
 *        until is an inclusive YYYY-MM-DD cut-off, or null for no cut-off
 * @returns {{visible:Uint8Array, matched:Uint8Array, active:boolean, counts:{pov:number, doc:number, topic:number}}}
 */
export function applyFilters(model, povBySlug, topicById, f) {
  const n = model.nodes.length;
  const visible = new Uint8Array(n);
  const matched = new Uint8Array(n);
  const terms = norm(f.q).split(/\s+/).filter(Boolean);
  const searching = terms.length > 0;
  const topicOn = Boolean(f.topic);
  const active = searching || topicOn;

  const index = new Map(model.nodes.map((node, i) => [node.id, i]));
  const hit = new Set(); // slugs that match the search and the topic filter

  for (const node of model.nodes) {
    if (node.kind !== 'pov') continue;
    const p = povBySlug.get(node.ref);
    const inTopic = !topicOn || (p?.topics ?? []).includes(f.topic);
    let ok = inTopic;
    if (ok && searching) {
      const text = norm([p?.title ?? node.label, p?.summary, p?.author, ...(p?.topics ?? []).map((id) => topicById.get(id)?.title)].join(' '));
      ok = terms.every((w) => text.includes(w));
    }
    if (ok) hit.add(node.ref);
  }

  const counts = { pov: 0, doc: 0, topic: 0 };
  model.nodes.forEach((node, i) => {
    let show = f.samples || !node.sample;
    if (show && f.until && node.kind !== 'topic' && node.date && node.date > f.until) show = false;
    visible[i] = show ? 1 : 0;
  });

  // A topic is visible if it is not a hidden sample topic, and (when a cut-off is set) it still has a visible POV.
  if (f.until) {
    const hasVisiblePov = new Set();
    model.nodes.forEach((node, i) => {
      if (node.kind !== 'pov' || !visible[i]) return;
      for (const t of povBySlug.get(node.ref)?.topics ?? []) hasVisiblePov.add(t);
    });
    model.nodes.forEach((node, i) => {
      if (node.kind === 'topic' && visible[i] && !hasVisiblePov.has(node.ref)) visible[i] = 0;
    });
  }

  model.nodes.forEach((node, i) => {
    if (!visible[i]) return;
    let ok;
    if (!active) ok = true;
    else if (node.kind === 'pov') ok = hit.has(node.ref);
    else if (node.kind === 'doc') ok = hit.has(node.ref);
    else ok = topicMatches(model, node, hit, f, index);
    matched[i] = ok ? 1 : 0;
    if (visible[i]) counts[node.kind] += 1;
  });

  return { visible, matched, active, counts };
}

function topicMatches(model, node, hit, f, index) {
  if (f.topic && node.ref === f.topic) return true;
  // A topic stays lit when one of its (matching) POVs is lit.
  for (const other of model.adj.get(node.id) ?? []) {
    const o = model.byId.get(other);
    if (o.kind === 'pov' && hit.has(o.ref) && index.has(other)) return true;
  }
  return false;
}

/** A node id is lit for the graph if it matched; used to build the `focus` set the renderers take. */
export function focusSet(model, result) {
  if (!result.active) return null;
  const set = new Set();
  model.nodes.forEach((node, i) => { if (result.matched[i] && result.visible[i]) set.add(node.id); });
  return set;
}

/** Per-edge visibility: an edge shows only if both ends do. */
export function edgeVisibility(model, result) {
  const index = new Map(model.nodes.map((node, i) => [node.id, i]));
  return Uint8Array.from(model.edges, (e) => (result.visible[index.get(e.s)] && result.visible[index.get(e.t)] ? 1 : 0));
}
