// Page fragments the build writes into HTML. Every value that comes from
// content goes through esc(). Markdown is turned into blocks first and the
// blocks are rendered here as escaped text, so content can never add markup.

import { constellationSvg } from './constellation.mjs';
import { hostLabel } from './doc-links.mjs';
import { esc } from './html.mjs';
import { graphSvg, neighbourhood } from './svg.mjs';

export const CSP = [
  "default-src 'none'",
  "style-src 'self'",
  "script-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// `up` is the path from the page to the site root: '', '../', '../../', or the
// absolute '/POV_Exchange/' used by 404.html.
export function headTags(up, config = {}) {
  // While indexing is off, ask search engines to skip every page. This is a request, not a lock:
  // the repo and the pages stay readable by anyone with the address.
  const robots = config.indexing ? [] : ['<meta name="robots" content="noindex, nofollow">'];
  return [
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    ...robots,
    '<meta name="color-scheme" content="light dark">',
    `<link rel="icon" href="${up}favicon.svg" type="image/svg+xml">`,
    `<script src="${up}js/theme-init.js"></script>`,
    `<link rel="stylesheet" href="${up}styles.css">`,
    `<script type="module" src="${up}js/main.js"></script>`,
  ].join('\n');
}

const LOGO = '<svg class="logo" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 17.5 12 6.5l6 11M6 17.5h12"/><circle cx="12" cy="6.5" r="2.6"/><circle cx="6" cy="17.5" r="2.6"/><circle cx="18" cy="17.5" r="2.6"/></svg>';

const ICONS = '<svg class="i-moon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>'
  + '<svg class="i-sun" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>';

export function headerHtml(up, current = '') {
  const items = [['library', 'Library', ''], ['graph', 'Graph', 'graph/'], ['glossary', 'Glossary', 'glossary/'], ['add', 'Add a POV', 'add/']];
  const links = items
    .map(([id, label, path]) => `<a href="${up}${path}"${current === id ? ' aria-current="page"' : ''}>${label}</a>`)
    .join('\n');
  return `<a class="skip" href="#main">Skip to content</a>
<header class="bar">
<a class="brand" href="${up}">${LOGO}<span>POV Exchange</span></a>
<nav class="nav" aria-label="Main">
${links}
<button type="button" class="theme-btn" data-theme-toggle hidden aria-label="Switch colour theme">${ICONS}</button>
</nav>
</header>`;
}

export function footerHtml(config = {}) {
  const who = config.publisher ? `${esc(config.publisher)}. ` : '';
  return `<footer class="foot"><p>${who}Practice opinions only. No client information.</p></footer>`;
}

// ------------------------------------------------------------------ content

function inline(nodes) {
  return nodes.map((n) => {
    switch (n.t) {
      case 'text': return esc(n.v);
      case 'code': return `<code>${esc(n.v)}</code>`;
      case 'strong': return `<strong>${inline(n.c)}</strong>`;
      case 'em': return `<em>${inline(n.c)}</em>`;
      case 'link': return `<a href="${esc(n.href)}" rel="noopener noreferrer">${inline(n.c)}</a>`;
      // A glossary term: a real link to its entry (so it works without JavaScript), carrying its definition for the pop-up.
      case 'term': return `<a class="term" href="${esc(n.base ?? TERM_BASE)}#${esc(n.slug)}" data-def="${esc(n.def)}">${inline(n.c)}</a>`;
      default: throw new Error('unknown inline node');
    }
  }).join('');
}

export function blocksToHtml(blocks) {
  return blocks.map((b) => {
    switch (b.t) {
      case 'h': return `<h${b.level}>${inline(b.c)}</h${b.level}>`;
      case 'p': return `<p>${inline(b.c)}</p>`;
      case 'quote': return `<blockquote><p>${inline(b.c)}</p></blockquote>`;
      case 'ul': return `<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`;
      case 'ol': return `<ol>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ol>`;
      default: throw new Error('unknown block');
    }
  }).join('\n');
}

const TERM_BASE = '../../glossary/'; // from pov/<slug>/ to the glossary page

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const words = (blocks) => {
  let n = 0;
  const walk = (nodes) => { for (const x of nodes) { if (x.v) n += x.v.split(/\s+/).filter(Boolean).length; if (x.c) walk(x.c); } };
  for (const b of blocks) { if (b.c) walk(b.c); if (b.items) b.items.forEach(walk); }
  return n;
};

/** Draft / Agreed chip. */
export function statusChip(status) {
  return status === 'draft'
    ? '<span class="status draft">Draft</span>'
    : '<span class="status agreed">Agreed</span>';
}

function statusBanner(p) {
  return p.status === 'draft'
    ? '<p class="draft-note" role="note"><strong>Draft.</strong> This view is still forming and is not the practice\'s agreed position.</p>\n'
    : '';
}

/** A plain-text citation. It works without JavaScript; share.js only adds a Copy button. */
export function citation(p, config = {}) {
  const who = config.publisher ? `${config.publisher}. ` : '';
  const year = String(p.date).slice(0, 4);
  const url = config.siteUrl ? `${config.siteUrl}pov/${p.slug}/` : '';
  return `${p.author}. (${year}). ${p.title}. POV Exchange. ${who}${p.date}.${url ? ` ${url}` : ''}`;
}

function citeHtml(p, config) {
  return `<details class="cite"><summary>Cite this POV</summary>
<p class="cite-text" data-cite>${esc(citation(p, config))}</p>
<button type="button" class="btn ghost" data-share="copy-cite" hidden>Copy citation</button>
</details>`;
}

export function povPage(p, ctx) {
  const up = '../../';
  const topicTitles = p.topics.map((id) => ctx.topicById.get(id).title);
  const relatedPovs = p.related.map((s) => ctx.povBySlug.get(s));
  const minutes = Math.max(1, Math.round(words(p.blocks) / 220));
  const og = [
    '<meta property="og:type" content="article">',
    `<meta property="og:title" content="${esc(p.title)}">`,
    `<meta property="og:description" content="${esc(p.summary)}">`,
    '<meta property="og:site_name" content="POV Exchange">',
  ].join('\n');

  const docs = p.documents.length
    ? `<section class="docs" aria-labelledby="docs-h">
<h2 id="docs-h">Documents</h2>
<ul>
${p.documents.map((d) => `<li><a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${esc(d.title)}</a> <span class="size">${esc(hostLabel(d.host))}${p.sample ? '. Sample link: does not open a real document' : '. May ask you to sign in'}</span></li>`).join('\n')}
</ul>
</section>`
    : '';
  const related = relatedPovs.length
    ? `<section class="related" aria-labelledby="rel-h">
<h2 id="rel-h">Related</h2>
<ul>
${relatedPovs.map((r) => `<li><a href="../${r.slug}/">${esc(r.title)}</a></li>`).join('\n')}
</ul>
</section>`
    : '';

  const keep = neighbourhood(ctx.graph, p.slug);
  const map = graphSvg(ctx.graph, {
    keep,
    current: `p:${p.slug}`,
    className: 'minimap-svg',
    ariaLabel: `Where this POV sits in the knowledge graph: ${p.title}`,
    labelKinds: new Set(['topic', 'pov']),
    href: (n) => (n.id === `p:${p.slug}` ? null : n.kind === 'pov' ? `../${n.ref}/` : n.kind === 'topic' ? `${up}#topic-${n.ref}` : null),
  });
  const minimap = map
    ? `<aside class="minimap" aria-labelledby="map-h">
<h2 id="map-h">Where this sits</h2>
${map}
<p class="map-note">Topics and POVs connected to this one. Select a label to go there.</p>
</aside>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)} | POV Exchange</title>
<meta name="description" content="${esc(p.summary)}">
${og}
${headTags(up, ctx.config)}
</head>
<body>
${headerHtml(up)}
<main id="main" class="page article">
<p class="eyebrow">${p.type === 'document' ? 'Document' : 'POV'}${p.sample ? ' &middot; Sample' : ''} &middot; ${esc(topicTitles.join(', '))}</p>
<h1>${esc(p.title)}</h1>
<p class="lede">${esc(p.summary)}</p>
${statusBanner(p)}${p.sample ? '<p class="sample-note" role="note"><strong>Sample.</strong> This POV is fictional and says nothing about what the practice thinks.</p>\n' : ''}<p class="byline">${statusChip(p.status)} By ${esc(p.author)} &middot; <time datetime="${esc(p.date)}">${esc(p.date)}</time> &middot; ${minutes} min read</p>
<p class="page-actions"><a class="btn ghost" href="${up}graph/#n=p:${esc(p.slug)}">Open in graph</a> <button type="button" class="btn ghost" data-share="copy-link" hidden>Copy link</button> <button type="button" class="btn ghost" data-share="print" hidden>Print or save as PDF</button></p>
<div class="prose">
${blocksToHtml(p.blocks)}
</div>
${docs}
${citeHtml(p, ctx.config)}
<p class="contact">${esc(ctx.config.contactLine)}</p>
${minimap}
${related}
<p class="back"><a href="${up}">&larr; All POVs</a></p>
</main>
${footerHtml(ctx.config)}
</body>
</html>
`;
}

// ---------------------------------------------------------- library page

const SHOW_FIRST = 6; // cards shown per topic before "Show all"

/** Per-topic counts. A topic is sample-only when it is flagged and no real POV uses it. */
export function topicStats(topics, povs) {
  const stats = new Map(topics.map((t) => [t.id, { all: 0, real: 0, sampleOnly: false }]));
  for (const p of povs) {
    for (const id of p.topics) {
      const s = stats.get(id);
      s.all += 1;
      if (!p.sample) s.real += 1;
    }
  }
  for (const t of topics) {
    const s = stats.get(t.id);
    s.sampleOnly = Boolean(t.sample) && s.real === 0;
  }
  return stats;
}

const sampleAttr = (on) => (on ? ' data-sample="1"' : '');

function cardHtml(p, topicById, extraClass = '') {
  const text = `${p.title} ${p.summary} ${p.author} ${p.topics.map((id) => topicById.get(id).title).join(' ')}`.toLowerCase();
  const kind = p.type === 'document' ? 'Document' : 'POV';
  const tag = p.sample ? '<span class="tag">Sample</span>' : '';
  return `<li class="card reveal${extraClass}" data-slug="${p.slug}" data-topics="${esc(p.topics.join(' '))}" data-date="${esc(p.date)}" data-status="${p.status}" data-docs="${p.documents.length}" data-text="${esc(text)}"${sampleAttr(p.sample)}><a href="pov/${p.slug}/"><span class="card-kind">${kind} ${statusChip(p.status)}${tag}</span><span class="card-title">${esc(p.title)}</span><span class="card-summary">${esc(p.summary)}</span><span class="card-meta">${esc(p.author)} &middot; ${esc(p.date)}</span></a></li>`;
}

/**
 * The numbers under the headline. The text shows the totals; library.js recounts
 * them from the cards that are visible, so they follow the sample and draft switches.
 */
export function statsHtml(topics, povs) {
  const docs = povs.reduce((n, p) => n + p.documents.length, 0);
  const span = (name, n, one, many) => `<span data-stat="${name}" data-one="${one}" data-many="${many}">${plural(n, one, many)}</span>`;
  return [span('povs', povs.length, 'POV', 'POVs'), span('topics', topics.length, 'topic', 'topics'), span('docs', docs, 'document', 'documents')].join(' &middot; ');
}

/**
 * A still picture of the topics for the Library header. The live graph is on its own page.
 * Each topic is its own link into the graph, and the button beneath it opens the graph.
 */
export function previewHtml(graph) {
  // Two drawings of the same topics: a wide one, and a narrower one so the text stays readable on a phone.
  // CSS shows whichever fits; the other is hidden (display: none), so it is also out of the reading order.
  const label = 'The topics in the knowledge graph. Select a topic to see it in the graph.';
  const wide = constellationSvg(graph, { className: 'preview-svg pv-wide', href: (ref) => `graph/#t=${ref}`, ariaLabel: label });
  const narrow = constellationSvg(graph, { className: 'preview-svg pv-narrow', href: (ref) => `graph/#t=${ref}`, ariaLabel: label, width: 360, height: 340 });
  return `<div class="preview">${wide}${narrow}<a class="preview-cta" href="graph/">Open the graph &rarr;</a></div>`;
}

export function tilesHtml(topics, povs) {
  const stats = topicStats(topics, povs);
  const items = topics.map((t) => {
    const s = stats.get(t.id);
    return `<li class="tile reveal" data-topic="${t.id}"${sampleAttr(s.sampleOnly)}>
<a class="tile-main" href="#topic-${t.id}"><span class="tile-title">${esc(t.title)}</span><span class="tile-view">${esc(t.view)}</span></a>
<p class="tile-meta"><span class="tile-count">${plural(s.all, 'POV', 'POVs')}</span> <a class="tile-graph" href="graph/#t=${t.id}">View in graph</a></p>
</li>`;
  }).join('\n');
  return `<section class="tiles" aria-labelledby="tiles-h">
<h2 id="tiles-h">Topics</h2>
<ul class="tile-grid">
${items}
</ul>
</section>`;
}

export function sectionsHtml(topics, povs) {
  const stats = topicStats(topics, povs);
  const byTopic = new Map(topics.map((t) => [t.id, []]));
  for (const p of povs) for (const id of p.topics) byTopic.get(id).push(p);
  const topicById = new Map(topics.map((t) => [t.id, t]));

  const sections = topics.map((t) => {
    const items = byTopic.get(t.id);
    const parent = t.parent ? `<p class="eyebrow">Part of ${esc(topicById.get(t.parent).title)}</p>\n` : '';
    const cards = items.length
      ? `<ul class="cards">\n${items.map((p, i) => cardHtml(p, topicById, i >= SHOW_FIRST ? ' more' : '')).join('\n')}\n</ul>`
      : '<p class="empty">No POVs on this topic yet.</p>';
    return `<section class="topic reveal" id="topic-${t.id}" data-topic="${t.id}" aria-labelledby="t-${t.id}"${sampleAttr(stats.get(t.id).sampleOnly)}>
${parent}<h2 id="t-${t.id}">${esc(t.title)}</h2>
<p class="view">${esc(t.view)}</p>
<p class="graph-link"><a href="graph/#t=${t.id}">View this topic in the graph &rarr;</a></p>
${cards}
</section>`;
  });
  return `<div class="by-topic">\n${sections.join('\n')}\n</div>`;
}

/** Every POV once, newest first. Hidden until the "Newest first" view is chosen. */
export function latestHtml(topics, povs) {
  const topicById = new Map(topics.map((t) => [t.id, t]));
  return `<section class="newest" id="newest" aria-labelledby="newest-h" hidden>
<h2 id="newest-h">Newest first</h2>
<ul class="cards">
${povs.map((p) => cardHtml(p, topicById)).join('\n')}
</ul>
</section>`;
}

/** The Show samples / Show drafts switches, shared by the Library, the Graph page and the Glossary. */
export function switchesHtml({ idPrefix = '' } = {}) {
  return `<label class="switch switch-drafts" hidden><input type="checkbox" class="draft-switch" id="${idPrefix}drafts"><span>Show drafts</span></label>
<label class="switch switch-samples" hidden><input type="checkbox" class="sample-switch" id="${idPrefix}samples" checked><span>Show samples</span></label>`;
}

export function filtersHtml(topics) {
  const chips = topics.map((t) => `<li><a class="chip" href="#topic-${t.id}" data-topic="${t.id}">${esc(t.title)}</a></li>`).join('\n');
  return `<div class="filters" id="explore">
<div class="filters-in">
<div class="search" hidden>
<label for="q">Search POVs</label>
<input id="q" type="search" autocomplete="off" spellcheck="false" maxlength="100" placeholder="Search titles, summaries, authors">
</div>
<div class="seg" role="group" aria-label="Order" hidden>
<button type="button" class="seg-btn" data-view="topic" aria-pressed="true">By topic</button>
<button type="button" class="seg-btn" data-view="newest" aria-pressed="false">Newest first</button>
</div>
${switchesHtml()}
<ul class="chips nojs" aria-label="Jump to a topic">
${chips}
</ul>
<p class="count" role="status" aria-live="polite"></p>
<button type="button" class="clear" hidden>Clear filters</button>
</div>
</div>`;
}

// ------------------------------------------------------------ graph page

const provenance = (p) => `${p.sample ? ' <span class="tag">Sample</span>' : ''}${p.status === 'draft' ? ' <span class="status draft">Draft</span>' : ''}`;
const listAttrs = (p) => `${sampleAttr(p.sample)} data-status="${p.status}"`;

/** Every node as a plain list: the accessible twin of the graph, and the page's content without JavaScript. */
export function nodelistHtml(topics, povs, glossary = []) {
  const stats = topicStats(topics, povs);
  const byTopic = new Map(topics.map((t) => [t.id, []]));
  for (const p of povs) for (const id of p.topics) byTopic.get(id).push(p);
  const docItems = (p) => p.documents.map((d, i) => `<li${listAttrs(p)}><a href="${esc(d.url)}" data-node="d:${esc(p.slug)}/${i + 1}" target="_blank" rel="noopener noreferrer">${esc(d.title)}</a> <span>(document on ${esc(hostLabel(d.host))})</span></li>`).join('');
  const items = topics.map((t) => {
    const ps = byTopic.get(t.id);
    const kids = ps.length
      ? `\n<ul>\n${ps.map((p) => `<li${listAttrs(p)}><a href="../pov/${p.slug}/" data-node="p:${p.slug}">${esc(p.title)}</a>${provenance(p)}${p.documents.length ? `<ul>${docItems(p)}</ul>` : ''}</li>`).join('\n')}\n</ul>\n`
      : '';
    const n = stats.get(t.id);
    return `<li${sampleAttr(n.sampleOnly)}><a href="../#topic-${t.id}" data-node="t:${t.id}">${esc(t.title)}</a> <span>(${plural(n.all, 'POV', 'POVs')})</span>${kids}</li>`;
  }).join('\n');
  const terms = glossary.length
    ? `\n<h3 class="list-h">Glossary terms</h3>\n<ul class="terms-list">\n${glossary.map((g) => `<li${sampleAttr(g.sample)}><a href="../glossary/#${g.slug}" data-node="g:${g.slug}">${esc(g.term)}</a> <span>(used in ${plural(g.uses.length, 'POV', 'POVs')})</span>${g.sample ? ' <span class="tag">Sample</span>' : ''}</li>`).join('\n')}\n</ul>`
    : '';
  return `<nav class="nodelist" id="nodelist" aria-label="Knowledge graph as a list">
<ul>
${items}
</ul>${terms}
</nav>`;
}

/** The picture shown while the live graph loads, and as the whole graph when nothing can be drawn. */
export function posterHtml(graph) {
  return constellationSvg(graph, { className: 'poster-svg' });
}

// ---------------------------------------------------------- glossary page

const letterOf = (term) => {
  const first = Array.from(term.trim())[0] ?? '#';
  const up = first.toUpperCase();
  return /^\p{L}$/u.test(up) ? up : '#';
};

/** Glossary bodies are short; a heading would break the page's outline, so it is shown in bold instead. */
const flatten = (blocks) => blocks.map((b) => (b.t === 'h' ? { t: 'p', c: [{ t: 'strong', c: b.c }] } : b));

export function glossaryPageHtml(glossary, povs) {
  if (!glossary.length) {
    return '<p class="empty">No terms yet. Add a file to <code>povs/glossary</code> to start the glossary.</p>';
  }
  const bySlug = new Map(povs.map((p) => [p.slug, p]));
  const termBySlug = new Map(glossary.map((g) => [g.slug, g]));
  const letters = [...new Set(glossary.map((g) => letterOf(g.term)))].sort((a, b) => (a === '#' ? 1 : b === '#' ? -1 : a < b ? -1 : 1));

  const entry = (g) => {
    const aliases = g.aliases.length ? `<p class="gl-aliases">Also: ${g.aliases.map(esc).join(', ')}</p>` : '';
    const body = g.blocks.length ? `<div class="gl-body prose">${blocksToHtml(flatten(g.blocks))}</div>` : '';
    const related = g.related.length
      ? `<p class="gl-related">Related: ${g.related.map((r) => `<a href="#${esc(r)}">${esc(termBySlug.get(r).term)}</a>`).join(', ')}</p>`
      : '';
    const used = g.uses.length
      ? `<div class="gl-uses"><h3 class="gl-uses-h">Used in ${plural(g.uses.length, 'POV', 'POVs')}</h3><ul>${g.uses.map((slug) => {
        const p = bySlug.get(slug);
        return `<li${listAttrs(p)}><a href="../pov/${slug}/">${esc(p.title)}</a>${provenance(p)}</li>`;
      }).join('')}</ul></div>`
      : '<p class="gl-unused">Not used in any POV yet.</p>';
    const text = `${g.term} ${g.aliases.join(' ')} ${g.summary}`.toLowerCase();
    return `<div class="gl-entry" id="${esc(g.slug)}" data-text="${esc(text)}"${sampleAttr(g.sample)}>
<dt>${esc(g.term)}${g.sample ? ' <span class="tag">Sample</span>' : ''}</dt>
<dd><p class="gl-def">${esc(g.summary)}</p>${aliases}${body}${related}${used}<p class="gl-graph"><a href="../graph/#n=g:${esc(g.slug)}">View in graph</a></p></dd>
</div>`;
  };

  const groups = letters.map((L) => `<section class="gl-group" id="letter-${L === '#' ? 'other' : L}" aria-label="Terms starting with ${L === '#' ? 'other characters' : L}">
<h2 class="gl-letter">${L}</h2>
<dl>
${glossary.filter((g) => letterOf(g.term) === L).map(entry).join('\n')}
</dl>
</section>`).join('\n');

  const nav = letters.map((L) => `<a href="#letter-${L === '#' ? 'other' : L}">${L}</a>`).join('');
  return `<div class="gl-tools">
<div class="search" hidden><label for="gl-q">Search terms</label><input id="gl-q" type="search" autocomplete="off" spellcheck="false" maxlength="100" placeholder="Search terms"></div>
${switchesHtml({ idPrefix: 'gl-' })}
<p class="count gl-count" role="status" aria-live="polite"></p>
</div>
<nav class="gl-letters" aria-label="Jump to a letter">${nav}</nav>
<p class="no-results gl-none" hidden>No terms match.</p>
${groups}`;
}

// ---------------------------------------------------------------- templates

export const MARKERS = ['head', 'header', 'footer', 'poster', 'preview', 'tiles', 'stats', 'filters', 'sections', 'latest', 'nodelist', 'glossary', 'repo'];

/**
 * Replace <!-- build:name key=value ... --> markers in a site/ template.
 * A value may be empty (up= means "no prefix").
 * @returns {{html:string, unknown:string[]}}
 */
export function expandMarkers(html, fns) {
  const unknown = [];
  const out = html.replace(/<!-- build:([a-z]+)((?: [a-z]+=\S*)*) -->/g, (whole, name, argText) => {
    const args = {};
    for (const m of argText.matchAll(/ ([a-z]+)=(\S*)/g)) args[m[1]] = m[2];
    if (args.up !== undefined && !/^(?:(?:\.\.\/)*|\/POV_Exchange\/)$/.test(args.up)) {
      unknown.push(`${name} (bad up=)`);
      return whole;
    }
    const fn = fns[name];
    if (!fn) { unknown.push(name); return whole; }
    return fn(args);
  });
  return { html: out, unknown };
}
