// Page fragments the build writes into HTML. Every value that comes from
// content goes through esc(). Markdown is turned into blocks first and the
// blocks are rendered here as escaped text, so content can never add markup.

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
export function headTags(up) {
  return [
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
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
  const items = [['explore', 'Explore', ''], ['add', 'Add a POV', 'add/']];
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

export function footerHtml() {
  return '<footer class="foot"><p>Practice opinions only. No client information.</p></footer>';
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

const fmtSize = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const words = (blocks) => {
  let n = 0;
  const walk = (nodes) => { for (const x of nodes) { if (x.v) n += x.v.split(/\s+/).filter(Boolean).length; if (x.c) walk(x.c); } };
  for (const b of blocks) { if (b.c) walk(b.c); if (b.items) b.items.forEach(walk); }
  return n;
};

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
${p.documents.map((d) => `<li><a href="${up}docs/${p.slug}/${esc(encodeURIComponent(d.name))}" download>${esc(d.name)}</a> <span class="size">${esc(d.ext.toUpperCase())}, ${fmtSize(d.bytes)}</span></li>`).join('\n')}
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
${headTags(up)}
</head>
<body>
${headerHtml(up)}
<main id="main" class="page article">
<p class="eyebrow">${p.type === 'document' ? 'Document' : 'POV'} &middot; ${esc(topicTitles.join(', '))}</p>
<h1>${esc(p.title)}</h1>
<p class="lede">${esc(p.summary)}</p>
<p class="byline">By ${esc(p.author)} &middot; <time datetime="${esc(p.date)}">${esc(p.date)}</time> &middot; ${minutes} min read</p>
<div class="prose">
${blocksToHtml(p.blocks)}
</div>
${docs}
${minimap}
${related}
<p class="back"><a href="${up}">&larr; All POVs</a></p>
</main>
${footerHtml()}
</body>
</html>
`;
}

// --------------------------------------------------------------- home page

export function statsHtml(topics, povs) {
  const docs = povs.reduce((n, p) => n + p.documents.length, 0);
  return `${plural(povs.length, 'POV', 'POVs')} &middot; ${plural(topics.length, 'topic', 'topics')} &middot; ${plural(docs, 'document', 'documents')}`;
}

export function sectionsHtml(topics, povs) {
  const byTopic = new Map(topics.map((t) => [t.id, []]));
  for (const p of povs) for (const id of p.topics) byTopic.get(id).push(p);
  const topicById = new Map(topics.map((t) => [t.id, t]));

  return topics.map((t) => {
    const items = byTopic.get(t.id);
    const parent = t.parent ? `<p class="eyebrow">Part of ${esc(topicById.get(t.parent).title)}</p>\n` : '';
    const cards = items.length
      ? `<ul class="cards">\n${items.map((p) => {
        const text = `${p.title} ${p.summary} ${p.author} ${p.topics.map((id) => topicById.get(id).title).join(' ')}`.toLowerCase();
        return `<li class="card reveal" data-slug="${p.slug}" data-topics="${esc(p.topics.join(' '))}" data-text="${esc(text)}"><a href="pov/${p.slug}/"><span class="card-kind">${p.type === 'document' ? 'Document' : 'POV'}</span><span class="card-title">${esc(p.title)}</span><span class="card-summary">${esc(p.summary)}</span><span class="card-meta">${esc(p.author)} &middot; ${esc(p.date)}</span></a></li>`;
      }).join('\n')}\n</ul>`
      : '<p class="empty">No POVs on this topic yet.</p>';
    return `<section class="topic reveal" id="topic-${t.id}" data-topic="${t.id}" aria-labelledby="t-${t.id}">
${parent}<h2 id="t-${t.id}">${esc(t.title)}</h2>
<p class="view">${esc(t.view)}</p>
${cards}
</section>`;
  }).join('\n');
}

export function filtersHtml(topics) {
  const chips = topics.map((t) => `<li><a class="chip" href="#topic-${t.id}" data-topic="${t.id}">${esc(t.title)}</a></li>`).join('\n');
  return `<div class="filters" id="explore">
<div class="filters-in">
<div class="search" hidden>
<label for="q">Search POVs</label>
<input id="q" type="search" autocomplete="off" spellcheck="false" maxlength="100" placeholder="Search titles, summaries, authors">
</div>
<ul class="chips nojs" aria-label="Jump to a topic">
${chips}
</ul>
<p class="count" role="status" aria-live="polite"></p>
<button type="button" class="clear" hidden>Clear filters</button>
</div>
</div>`;
}

export function nodelistHtml(topics, povs) {
  const byTopic = new Map(topics.map((t) => [t.id, []]));
  for (const p of povs) for (const id of p.topics) byTopic.get(id).push(p);
  const items = topics.map((t) => {
    const ps = byTopic.get(t.id);
    const kids = ps.length
      ? `\n<ul>\n${ps.map((p) => `<li><a href="pov/${p.slug}/" data-node="p:${p.slug}">${esc(p.title)}</a></li>`).join('\n')}\n</ul>\n`
      : '';
    return `<li><a href="#topic-${t.id}" data-node="t:${t.id}">${esc(t.title)}</a> <span>(${plural(ps.length, 'POV', 'POVs')})</span>${kids}</li>`;
  }).join('\n');
  return `<nav class="nodelist" id="nodelist" aria-label="Knowledge graph as a list">
<ul>
${items}
</ul>
</nav>`;
}

export function posterHtml(graph) {
  return graphSvg(graph, {
    className: 'poster-svg',
    labelKinds: new Set(['topic']),
  });
}

// ---------------------------------------------------------------- templates

export const MARKERS = ['head', 'header', 'footer', 'poster', 'stats', 'filters', 'sections', 'nodelist', 'repo'];

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
