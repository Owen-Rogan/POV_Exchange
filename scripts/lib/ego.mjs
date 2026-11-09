// "Where this sits": a diagram of one POV and what it connects to, drawn at
// build time as SVG.
//
// The old version flattened a piece of the 3D graph and scaled it up to fill
// the page, so labels came out huge and piled on top of each other. This one is
// a laid-out diagram instead of a projection: every item is a pill with a fixed
// width, its label is wrapped to fit inside it, and items are stacked with a
// fixed gap. Nothing can overlap because nothing is placed by position in 3D.
//
//   wide    three columns   topics | THIS POV | related POVs, glossary terms below
//   narrow  a tree          THIS POV on top, its groups hanging off a spine
//
// Both are drawn; CSS shows the one that fits the screen. Text is 14px in the
// drawing and the drawings are shown at about their own size, so labels stay
// readable. Colours come from CSS classes (light and dark), and no style
// attributes are written (the site's CSP forbids inline styles).
//
// The diagram is a visual twin. Its links are not tabbable and it is hidden from
// screen readers: the text lists beside it carry the same links.

import { esc } from './html.mjs';

export const FONT = 14;
const LINE = 17; // line height inside a pill
const PAD_X = 12;
const PAD_Y = 8;
const GAP = 10; // space between stacked pills
const CHAR = FONT * 0.6; // a generous width per character, so wrapped text always fits its pill
const BOLD = 1.07; // bold text is a little wider
const ELLIPSIS = '\u2026';

const r1 = (v) => Math.round(v * 10) / 10;
const len = (s) => Array.from(s).length;
const cut = (s, n) => Array.from(s).slice(0, n).join('');

/**
 * Wrap text into at most `maxLines` lines of at most `maxChars` characters.
 * When the text does not fit, the last line ends in an ellipsis.
 */
export function wrapLines(text, maxChars, maxLines) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let cur = '';
  let truncated = false;
  for (const word of words) {
    let w = word;
    if (len(w) > maxChars) w = cut(w, maxChars - 1) + ELLIPSIS; // one word too long for a line
    const joined = cur ? `${cur} ${w}` : w;
    if (len(joined) <= maxChars) { cur = joined; continue; }
    lines.push(cur);
    cur = w;
    if (lines.length === maxLines) { truncated = true; cur = ''; break; }
  }
  if (!truncated && cur) lines.push(cur);
  if (truncated) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = (len(last) >= maxChars ? cut(last, maxChars - 1) : last) + ELLIPSIS;
  }
  return lines;
}

const charsFor = (width, bold = false) => Math.max(4, Math.floor((width - PAD_X * 2) / (CHAR * (bold ? BOLD : 1))));

/** One rounded box with wrapped text, optionally a link. Returns { svg, h }. */
function pill({ x, y, w, label, kind, href = null, draft = false, self = false, maxLines = 2 }) {
  const lines = wrapLines(label, charsFor(w, self), maxLines);
  const h = PAD_Y * 2 + LINE * lines.length;
  const cls = `eg-pill eg-${kind}${draft ? ' drf' : ''}${self ? ' eg-self' : ''}`;
  const tspans = lines.map((t, i) => `<tspan x="${r1(x + PAD_X)}" y="${r1(y + PAD_Y + 13 + i * LINE)}">${esc(t)}</tspan>`).join('');
  const body = `<rect class="${cls}" x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" rx="7"/><rect class="eg-stripe eg-${kind}" x="${r1(x)}" y="${r1(y)}" width="4" height="${h}" rx="2"/><text class="eg-text${self ? ' eg-bold' : ''}" aria-hidden="true">${tspans}</text>`;
  const title = `<title>${esc(label)}</title>`;
  const svg = href ? `<a class="eg-link" href="${esc(href)}" tabindex="-1">${title}${body}</a>` : `<g>${title}${body}</g>`;
  return { svg, h };
}

/** A small label above a group, in plain muted text. */
const heading = (x, y, text) => `<text class="eg-head" x="${r1(x)}" y="${r1(y)}">${esc(text)}</text>`;

/** Chips that flow left to right and wrap. Returns { svg, bottom }. */
function chips(items, x0, y0, maxW) {
  let x = x0, y = y0, svg = '';
  const h = PAD_Y * 2 + LINE;
  for (const it of items) {
    const label = len(it.label) > 22 ? cut(it.label, 21) + ELLIPSIS : it.label;
    const w = Math.min(maxW, Math.ceil(len(label) * CHAR + PAD_X * 2 + 4));
    if (x > x0 && x + w > x0 + maxW) { x = x0; y += h + GAP; }
    svg += pill({ x, y, w, label: it.label, kind: it.kind ?? 'term', href: it.href, maxLines: 1 }).svg;
    x += w + 8;
  }
  return { svg, bottom: items.length ? y + h : y0 };
}

/**
 * @param {object} d
 * @param {{label:string, draft?:boolean}} d.self
 * @param {Array<{label:string, href:string, draft?:boolean}>} d.topics
 * @param {Array<{label:string, href:string, draft?:boolean}>} d.related   already limited to what is shown
 * @param {number} d.moreRelated  how many more there are than are shown
 * @param {Array<{label:string, href:string}>} d.terms
 * @param {number} d.moreTerms
 * @param {string} d.moreHref  where "+N more" goes (the text lists beside the diagram)
 * @param {string} d.ariaLabel not used for the drawing itself (it is a visual twin) but kept for the group name
 */
export function egoWide(d) {
  const W = 700, M = 6, PW = 210, CW = 190;
  const xL = M, xC = (W - CW) / 2, xR = W - M - PW;
  const y0 = 30;
  const right = d.related.map((r) => ({ ...r, kind: 'pov' }));
  if (d.moreRelated > 0) right.push({ label: `+${d.moreRelated} more`, href: d.moreHref, kind: 'more' });

  const stack = (items, x) => {
    let y = y0;
    const out = [];
    for (const it of items) {
      const p = pill({ x, y, w: PW, label: it.label, kind: it.kind ?? 'topic', href: it.href, draft: it.draft });
      out.push({ ...p, y, mid: y + p.h / 2 });
      y += p.h + GAP;
    }
    return { out, height: out.length ? y - GAP - y0 : 0 };
  };
  const left = stack(d.topics.map((t) => ({ ...t, kind: 'topic' })), xL);
  const rgt = stack(right, xR);
  const selfLines = wrapLines(d.self.label, charsFor(CW, true), 4);
  const selfH = PAD_Y * 2 + LINE * selfLines.length;
  const colH = Math.max(left.height, rgt.height, selfH);
  const cy = y0 + (colH - selfH) / 2;
  const self = pill({ x: xC, y: cy, w: CW, label: d.self.label, kind: 'pov', draft: d.self.draft, self: true, maxLines: 4 });
  const cMid = cy + self.h / 2;

  const conn = [
    ...left.out.map((p) => `<path class="eg-conn" d="M${r1(xL + PW)} ${r1(p.mid)}C${r1((xL + PW + xC) / 2)} ${r1(p.mid)} ${r1((xL + PW + xC) / 2)} ${r1(cMid)} ${r1(xC)} ${r1(cMid)}"/>`),
    ...rgt.out.map((p) => `<path class="eg-conn" d="M${r1(xC + CW)} ${r1(cMid)}C${r1((xC + CW + xR) / 2)} ${r1(cMid)} ${r1((xC + CW + xR) / 2)} ${r1(p.mid)} ${r1(xR)} ${r1(p.mid)}"/>`),
  ].join('');

  let heads = heading(xL, 18, 'Topics') + heading(xR, 18, 'Related POVs');
  if (!d.related.length) heads += `<text class="eg-empty" x="${r1(xR)}" y="${y0 + 18}">No related POVs yet</text>`;

  let bottom = y0 + colH;
  let termSvg = '';
  if (d.terms.length) {
    const ty = bottom + 26;
    termSvg = heading(M, ty - 8, 'Glossary terms used');
    const items = d.terms.map((t) => ({ ...t, kind: 'term' }));
    if (d.moreTerms > 0) items.push({ label: `+${d.moreTerms} more`, href: d.moreHref, kind: 'more' });
    const c = chips(items, M, ty, W - M * 2);
    termSvg += c.svg;
    bottom = c.bottom;
  }
  const H = Math.ceil(bottom + M);
  const svg = [
    `<svg class="eg-svg eg-wide" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMin meet" focusable="false" aria-hidden="true">`,
    `<g class="eg-conns">${conn}</g>`,
    heads,
    left.out.map((p) => p.svg).join(''),
    rgt.out.map((p) => p.svg).join(''),
    self.svg,
    termSvg,
    '</svg>',
  ].join('\n');
  return { svg, width: W, height: H };
}

export function egoNarrow(d) {
  const W = 300, M = 6, SPINE = 20, X = 36;
  const PW = W - M - X;
  let y = M;
  const self = pill({ x: M, y, w: W - M * 2, label: d.self.label, kind: 'pov', draft: d.self.draft, self: true, maxLines: 4 });
  y += self.h;
  const spineTop = y;
  let svg = '';
  let lastMid = y;
  const ticks = [];

  const group = (title, items, mapKind) => {
    if (!items.length) return;
    y += 16;
    svg += heading(X, y + 4, title);
    y += 12;
    for (const it of items) {
      const p = pill({ x: X, y, w: PW, label: it.label, kind: it.kind ?? mapKind, href: it.href, draft: it.draft });
      svg += p.svg;
      ticks.push(y + p.h / 2);
      lastMid = y + p.h / 2;
      y += p.h + GAP;
    }
    y -= GAP;
  };
  group('Topics', d.topics, 'topic');
  const rel = d.related.map((r) => ({ ...r }));
  if (d.moreRelated > 0) rel.push({ label: `+${d.moreRelated} more`, href: d.moreHref, kind: 'more' });
  if (rel.length) group('Related POVs', rel, 'pov');
  else { y += 16; svg += heading(X, y + 4, 'Related POVs') + `<text class="eg-empty" x="${X}" y="${y + 22}">No related POVs yet</text>`; y += 24; }

  if (d.terms.length) {
    y += 16;
    svg += heading(X, y + 4, 'Glossary terms used');
    y += 12;
    const items = d.terms.map((t) => ({ ...t, kind: 'term' }));
    if (d.moreTerms > 0) items.push({ label: `+${d.moreTerms} more`, href: d.moreHref, kind: 'more' });
    const c = chips(items, X, y, PW);
    svg += c.svg;
    ticks.push(y + (PAD_Y * 2 + LINE) / 2);
    lastMid = Math.max(lastMid, y + (PAD_Y * 2 + LINE) / 2);
    y = c.bottom;
  }
  const spine = ticks.length
    ? `<path class="eg-conn" d="M${SPINE} ${r1(spineTop)}V${r1(lastMid)}${ticks.map((t) => `M${SPINE} ${r1(t)}H${X}`).join('')}"/>`
    : '';
  const H = Math.ceil(y + M);
  const out = [
    `<svg class="eg-svg eg-narrow" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMin meet" focusable="false" aria-hidden="true">`,
    `<g class="eg-conns">${spine}</g>`,
    svg,
    self.svg,
    '</svg>',
  ].join('\n');
  return { svg: out, width: W, height: H };
}

/** Both drawings, side by side in the page; CSS shows the one that fits. */
export function egoHtml(data) {
  return `<div class="eg" aria-hidden="true">\n${egoWide(data).svg}\n${egoNarrow(data).svg}\n</div>`;
}
