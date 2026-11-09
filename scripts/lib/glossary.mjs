// Glossary matching: which POVs mention which terms, and the first mention of
// each term inside a POV (which becomes a pop-up link).
//
// Works on the parsed block tree from markdown.mjs, never on raw text or HTML.
// A marked mention becomes an inline node  { t: 'term', slug, def, c: [text] }
// that both renderers (the build's HTML and the browser's reader) understand.
//
// Rules: whole words only, case-insensitive, longest name first, never inside
// links or code, never in headings, each term once per POV, at most `max`
// per POV. Aliases count as the same term.

const BOUNDARY_BEFORE = '(?<![\\p{L}\\p{N}_])';
const BOUNDARY_AFTER = '(?![\\p{L}\\p{N}_])';

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {Array<{slug:string, term:string, aliases?:string[]}>} terms
 * @returns {{regex: RegExp, slugFor: (matched:string)=>string} | null} null when there are no terms
 */
export function compileMatcher(terms) {
  const byName = new Map();
  for (const t of terms) {
    for (const name of [t.term, ...(t.aliases ?? [])]) {
      const key = name.trim().toLowerCase();
      if (key && !byName.has(key)) byName.set(key, t.slug);
    }
  }
  if (!byName.size) return null;
  const names = [...byName.keys()].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  const regex = new RegExp(`${BOUNDARY_BEFORE}(?:${names.map(escapeRegExp).join('|')})${BOUNDARY_AFTER}`, 'giu');
  return { regex, slugFor: (matched) => byName.get(matched.toLowerCase()) };
}

/** Every inline list in the blocks. Headings are included only when asked for. */
function inlineLists(blocks, { headings }) {
  const out = [];
  for (const b of blocks) {
    if (b.t === 'h') { if (headings) out.push(b.c); }
    else if (b.t === 'p' || b.t === 'quote') out.push(b.c);
    else if (b.t === 'ul' || b.t === 'ol') out.push(...b.items);
  }
  return out;
}

function collect(nodes, matcher, found) {
  for (const n of nodes) {
    if (n.t === 'text') for (const m of n.v.matchAll(matcher.regex)) found.add(matcher.slugFor(m[0]));
    else if (n.t === 'strong' || n.t === 'em') collect(n.c, matcher, found);
    // code and links are left alone
  }
}

/** Slugs of every term mentioned anywhere in the blocks (headings included). */
export function usedTerms(blocks, matcher) {
  const found = new Set();
  if (!matcher) return found;
  for (const list of inlineLists(blocks, { headings: true })) collect(list, matcher, found);
  return found;
}

function splitText(text, state) {
  if (state.count >= state.max) return [{ t: 'text', v: text }];
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(state.matcher.regex)) {
    const slug = state.matcher.slugFor(m[0]);
    if (state.seen.has(slug) || state.count >= state.max) continue;
    if (m.index > last) parts.push({ t: 'text', v: text.slice(last, m.index) });
    parts.push({ t: 'term', slug, def: state.defs.get(slug) ?? '', c: [{ t: 'text', v: m[0] }] });
    last = m.index + m[0].length;
    state.seen.add(slug);
    state.count += 1;
  }
  if (last < text.length) parts.push({ t: 'text', v: text.slice(last) });
  return parts.length ? parts : [{ t: 'text', v: text }];
}

function markInline(nodes, state) {
  const out = [];
  for (const n of nodes) {
    if (n.t === 'text') out.push(...splitText(n.v, state));
    else if (n.t === 'strong' || n.t === 'em') out.push({ ...n, c: markInline(n.c, state) });
    else out.push(n);
  }
  return out;
}

/**
 * @param {Array} blocks
 * @param {object|null} matcher from compileMatcher()
 * @param {{defs: Map<string,string>, max?: number}} opts defs: term slug -> one-line definition
 * @returns {{blocks: Array, marked: Set<string>}} a new block tree; the input is not changed
 */
export function markTerms(blocks, matcher, { defs, max = 12 }) {
  if (!matcher) return { blocks, marked: new Set() };
  const state = { matcher, defs, max, seen: new Set(), count: 0 };
  const out = blocks.map((b) => {
    if (b.t === 'p' || b.t === 'quote') return { ...b, c: markInline(b.c, state) };
    if (b.t === 'ul' || b.t === 'ol') return { ...b, items: b.items.map((item) => markInline(item, state)) };
    return b;
  });
  return { blocks: out, marked: state.seen };
}
