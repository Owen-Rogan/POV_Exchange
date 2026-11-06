// Restricted markdown -> block tree.
//
// Supported: ## and ### headings (rendered as h2 and h3, the page title is the h1),
// paragraphs, - or * bullet lists, 1. numbered lists, > quotes, **bold**,
// *italic* / _italic_, `inline code`, [text](https://...) links, \ escapes.
//
// Everything else is either plain text or a clear error (images, fenced code,
// rules, nested lists, non-https links). Output is data, never HTML: the
// renderers turn nodes into escaped text.

const HREF_SCHEME_OK = 'https:';
const PRIVATE_HOST = /^\d{1,3}(?:\.\d{1,3}){3}$|^\[|\.(?:local|localhost|internal|corp|lan|intranet|home)$/;

function checkHref(raw, report) {
  if (!raw || raw.length > 2000) { report('link URL is empty or too long'); return null; }
  let u;
  try { u = new URL(raw); } catch { report('link URL is not valid'); return null; }
  if (u.protocol !== HREF_SCHEME_OK) { report('links must start with https://'); return null; }
  if (u.username || u.password) { report('links must not contain a user name or password'); return null; }
  const h = u.hostname;
  if (!h.includes('.') || h === 'localhost' || PRIVATE_HOST.test(h)) {
    report('links must point to a public host name');
    return null;
  }
  return u.href;
}

// The URL may contain one level of balanced parentheses, e.g. .../Topic_(subtopic).
const LINK_RE = /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))*)\)/y;
const ALNUM = /[A-Za-z0-9]/;

function parseRun(s, report, allowLinks) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  let i = 0;
  while (i < s.length) {
    const c = s[i];

    if (c === '\\' && i + 1 < s.length && /[\\`*_[\]()#>-]/.test(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i + 1) { flush(); out.push({ t: 'code', v: s.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (c === '!' && s[i + 1] === '[') {
      report('images are not supported');
      buf += c; i++;
      continue;
    }
    if (c === '[' && allowLinks) {
      LINK_RE.lastIndex = i;
      const m = LINK_RE.exec(s);
      if (m) {
        flush();
        const href = checkHref(m[2], report);
        const kids = parseRun(m[1], report, false);
        if (href) out.push({ t: 'link', href, c: kids }); else out.push(...kids);
        i += m[0].length;
        continue;
      }
    }
    if (c === '*' && s[i + 1] === '*') {
      const end = s.indexOf('**', i + 2);
      if (end > i + 2) { flush(); out.push({ t: 'strong', c: parseRun(s.slice(i + 2, end), report, allowLinks) }); i = end + 2; continue; }
    }
    if (c === '*' || c === '_') {
      // snake_case_names must not turn into italics.
      if (c === '_' && ALNUM.test(s[i - 1] ?? ' ')) { buf += c; i++; continue; }
      let end = s.indexOf(c, i + 1);
      while (c === '_' && end !== -1 && ALNUM.test(s[end + 1] ?? ' ')) end = s.indexOf(c, end + 1);
      if (end > i + 1 && s[i + 1] !== ' ') {
        flush();
        out.push({ t: 'em', c: parseRun(s.slice(i + 1, end), report, allowLinks) });
        i = end + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

/**
 * @param {string} body markdown, LF newlines
 * @param {(rule:string, line:number)=>void} report line is 1-based, relative to body
 */
export function parseBlocks(body, report) {
  const blocks = [];
  let cur = null;

  const inline = (text, line) => parseRun(text, (rule) => report(rule, line), true);
  const close = () => {
    if (!cur) return;
    if (cur.t === 'p') blocks.push({ t: 'p', c: inline(cur.lines.join(' '), cur.line) });
    else if (cur.t === 'quote') blocks.push({ t: 'quote', c: inline(cur.lines.filter(Boolean).join(' '), cur.line) });
    else blocks.push({ t: cur.t, items: cur.items.map((it) => inline(it.text, it.line)) });
    cur = null;
  };

  body.split('\n').forEach((raw, idx) => {
    const line = raw.replace(/\s+$/, '');
    const n = idx + 1;
    if (!line.trim()) { close(); return; }

    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) { report('fenced code blocks are not supported', n); return; }
    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) { report('horizontal rules are not supported', n); return; }

    let m = /^(#{1,6})\s+(.+)$/.exec(line);
    if (m) {
      close();
      // The page title is the h1 (from front matter), so ## is h2 and ### is h3.
      if (m[1].length === 1) report('use ## for headings (the title comes from the front matter, not a # heading)', n);
      else if (m[1].length > 3) report('headings deeper than ### are not supported', n);
      blocks.push({ t: 'h', level: Math.min(Math.max(m[1].length, 2), 3), c: inline(m[2].trim(), n) });
      return;
    }
    if (/^\s+(?:[-*]|\d{1,3}[.)])\s+/.test(line)) { report('nested lists are not supported', n); return; }

    m = /^[-*]\s+(.*)$/.exec(line);
    if (m) {
      if (cur?.t !== 'ul') { close(); cur = { t: 'ul', items: [] }; }
      cur.items.push({ text: m[1], line: n });
      return;
    }
    m = /^\d{1,3}[.)]\s+(.*)$/.exec(line);
    if (m) {
      if (cur?.t !== 'ol') { close(); cur = { t: 'ol', items: [] }; }
      cur.items.push({ text: m[1], line: n });
      return;
    }
    m = /^>\s?(.*)$/.exec(line);
    if (m) {
      if (cur?.t !== 'quote') { close(); cur = { t: 'quote', lines: [], line: n }; }
      cur.lines.push(m[1].trim());
      return;
    }
    if ((cur?.t === 'ul' || cur?.t === 'ol') && /^\s+\S/.test(line)) {
      cur.items[cur.items.length - 1].text += ' ' + trimmed; // wrapped list item
      return;
    }
    if (cur?.t === 'p') { cur.lines.push(trimmed); return; }
    close();
    cur = { t: 'p', lines: [trimmed], line: n };
  });
  close();
  return blocks;
}
