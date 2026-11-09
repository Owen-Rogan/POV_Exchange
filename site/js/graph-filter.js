// Which graph nodes are visible or lit for the current search, topic, date
// cut-off and the sample, draft and terms switches. Pure functions over the
// graph model, so they can be tested without a browser.
//
//   visible(node)  true when the node is shown at all (switches, time)
//   matched(node)  true when it also matches the search and topic filters
//
// A node that is visible but not matched is dimmed. A node that is not visible
// is eased out of view.
//
// Rules that keep the picture honest:
//   - a draft POV is hidden unless drafts are on, and its documents go with it
//   - a topic is hidden when it is sample-only and samples are off, or when
//     none of its POVs is visible any more (so hiding drafts leaves no empty topic)
//   - glossary terms are hidden unless the terms layer is on, and a term with
//     no visible POV is hidden too

const norm = (s) => String(s ?? '').toLowerCase();

/**
 * @param {object} model       from withIndex()
 * @param {Map} povBySlug      slug -> { title, summary, author, topics, status, ... }
 * @param {Map} topicById      id -> { title, ... }
 * @param {{q:string, topic:string, samples:boolean, drafts:boolean, terms:boolean, until:string|null}} f
 *        until is an inclusive YYYY-MM-DD cut-off, or null for no cut-off
 * @returns {{visible:Uint8Array, matched:Uint8Array, active:boolean, counts:{pov:number, doc:number, topic:number, term:number}}}
 */
export function applyFilters(model, povBySlug, topicById, f) {
  const n = model.nodes.length;
  const visible = new Uint8Array(n);
  const matched = new Uint8Array(n);
  const terms = norm(f.q).split(/\s+/).filter(Boolean);
  const searching = terms.length > 0;
  const topicOn = Boolean(f.topic);
  const active = searching || topicOn;
  const drafts = f.drafts === true;
  const showTerms = f.terms === true;

  const index = model.index ?? new Map(model.nodes.map((node, i) => [node.id, i]));
  const isDraft = (node) => node.status === 'draft';

  // 1. POVs and documents: samples, drafts and the date cut-off.
  model.nodes.forEach((node, i) => {
    if (node.kind === 'topic' || node.kind === 'term') return;
    let show = (f.samples || !node.sample) && (drafts || !isDraft(node));
    if (show && f.until && node.date && node.date > f.until) show = false;
    visible[i] = show ? 1 : 0;
  });

  // 2. Topics and terms stay only while they have a visible POV.
  const hasVisiblePov = new Set();
  model.nodes.forEach((node, i) => {
    if (node.kind !== 'pov' || !visible[i]) return;
    for (const t of povBySlug.get(node.ref)?.topics ?? []) hasVisiblePov.add(t);
  });
  model.nodes.forEach((node, i) => {
    if (node.kind === 'topic') {
      visible[i] = (f.samples || !node.sample) && hasVisiblePov.has(node.ref) ? 1 : 0;
    } else if (node.kind === 'term') {
      let used = false;
      for (const other of model.adj.get(node.id) ?? []) if (visible[index.get(other)]) { used = true; break; }
      visible[i] = showTerms && (f.samples || !node.sample) && used ? 1 : 0;
    }
  });

  // 3. Search and topic filter, over the POVs that are visible.
  const hit = new Set();
  model.nodes.forEach((node, i) => {
    if (node.kind !== 'pov' || !visible[i]) return;
    const p = povBySlug.get(node.ref);
    let ok = !topicOn || (p?.topics ?? []).includes(f.topic);
    if (ok && searching) {
      const text = norm([p?.title ?? node.label, p?.summary, p?.author, ...(p?.topics ?? []).map((id) => topicById.get(id)?.title)].join(' '));
      ok = terms.every((w) => text.includes(w));
    }
    if (ok) hit.add(node.ref);
  });

  const counts = { pov: 0, doc: 0, topic: 0, term: 0 };
  model.nodes.forEach((node, i) => {
    if (!visible[i]) return;
    let ok;
    if (!active) ok = true;
    else if (node.kind === 'pov' || node.kind === 'doc') ok = hit.has(node.ref);
    else if (node.kind === 'topic') ok = (topicOn && node.ref === f.topic) || [...(model.adj.get(node.id) ?? [])].some((o) => model.byId.get(o).kind === 'pov' && hit.has(model.byId.get(o).ref));
    else ok = [...(model.adj.get(node.id) ?? [])].some((o) => model.byId.get(o).kind === 'pov' && hit.has(model.byId.get(o).ref));
    matched[i] = ok ? 1 : 0;
    counts[node.kind] += 1;
  });

  return { visible, matched, active, counts };
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
  const index = model.index ?? new Map(model.nodes.map((node, i) => [node.id, i]));
  return Uint8Array.from(model.edges, (e) => (result.visible[index.get(e.s)] && result.visible[index.get(e.t)] ? 1 : 0));
}
