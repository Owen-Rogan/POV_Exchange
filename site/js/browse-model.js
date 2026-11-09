// What the side browser lists, as plain data. Pure functions over the graph
// model and the filter result, so they are tested without a browser.
//
// Every POV appears exactly once, under its main topic (the first topic it
// lists). The browser shows what the graph shows: the same sample, draft and
// date switches, and the same search, because it reads the filter result
// (`visible` and `matched`) rather than working things out a second time.

export const TERMS_GROUP = 'terms';

const byNewest = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.title < b.title ? -1 : a.title > b.title ? 1 : 0);

/**
 * @param {object} model          from withIndex()
 * @param {Map} povBySlug         slug -> { topics, date, ... }
 * @param {Array} topics          topics in curated order ({ id, title })
 * @param {Map} topicById         id -> topic
 * @param {{visible:Uint8Array, matched:Uint8Array, active:boolean}} result   from applyFilters()
 * @returns {{groups:Array, terms:Array, shown:number, total:number, searching:boolean}}
 *   groups: [{ id (the topic node id), title, sample, count, rows:[{ id, slug, title, sample, draft, also:[string] }] }]
 *   terms:  [{ id, title, sample }]
 *   total:  POVs the switches allow; shown: of those, how many match the search
 */
export function browseTree(model, povBySlug, topics, topicById, result) {
  const byMain = new Map(topics.map((t) => [t.id, []]));
  let total = 0;
  let shown = 0;
  model.nodes.forEach((node, i) => {
    if (node.kind !== 'pov' || !result.visible[i]) return;
    total += 1;
    const matched = !result.active || Boolean(result.matched[i]);
    if (matched) shown += 1;
    const p = povBySlug.get(node.ref);
    const main = p?.topics?.[0];
    if (!matched || !byMain.has(main)) return;
    byMain.get(main).push({
      id: node.id,
      slug: node.ref,
      title: node.label,
      date: node.date ?? p?.date ?? '',
      sample: Boolean(node.sample),
      draft: node.status === 'draft',
      also: (p?.topics ?? []).slice(1).map((id) => topicById.get(id)?.title).filter(Boolean),
    });
  });

  const groups = [];
  for (const t of topics) {
    const rows = byMain.get(t.id).sort(byNewest);
    const node = model.byId.get(`t:${t.id}`);
    const i = model.index.get(`t:${t.id}`);
    const live = i !== undefined && Boolean(result.visible[i]);
    // While searching, a topic with nothing to show is left out. Otherwise a topic stays while it is visible.
    if (!rows.length && (result.active || !live)) continue;
    groups.push({ id: `t:${t.id}`, title: t.title, sample: Boolean(node?.sample), count: rows.length, rows });
  }

  const terms = [];
  model.nodes.forEach((node, i) => {
    if (node.kind === 'term' && result.visible[i]) terms.push({ id: node.id, title: node.label, sample: Boolean(node.sample) });
  });
  terms.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));

  return { groups, terms, shown, total, searching: result.active };
}

/**
 * The id of the browser group a node belongs to (its main topic's node id, or 'terms'), so the browser
 * can open it when that node is selected in the graph. Null when it has no row.
 */
export function groupFor(model, povBySlug, id) {
  const node = model.byId.get(id);
  if (!node) return null;
  if (node.kind === 'topic') return node.id;
  if (node.kind === 'term') return TERMS_GROUP;
  const p = povBySlug.get(node.ref); // a POV, or a document (whose ref is its POV's slug)
  return p?.topics?.[0] ? `t:${p.topics[0]}` : null;
}

/** The node whose row is highlighted for a selection: a document highlights its POV. */
export function rowKeyFor(model, id) {
  const node = model.byId.get(id);
  if (!node) return null;
  return node.kind === 'doc' ? `p:${node.ref}` : id;
}
