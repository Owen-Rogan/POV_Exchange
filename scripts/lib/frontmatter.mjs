// Minimal front-matter reader for the small YAML subset POV files use:
//   key: value        key: [a, b, c]        key: "quoted value"
// Anything else is rejected with a line number. Error messages never echo the
// offending text, because it might be something that should not be repeated.

export function normalise(text) {
  let t = text;
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); // BOM from Windows editors
  return t.replace(/\r\n?/g, '\n'); // CRLF -> LF
}

function readScalar(s) {
  const q = s[0];
  if (q === '"' || q === "'") {
    const end = s.indexOf(q, 1);
    if (end === -1) return { error: 'unterminated quote' };
    const rest = s.slice(end + 1).trim();
    if (rest && !rest.startsWith('#')) return { error: 'unexpected text after closing quote' };
    return { value: s.slice(1, end) };
  }
  return { value: s.replace(/\s+#.*$/, '').trim() };
}

/**
 * Split the inside of [ ... ] on commas that are not inside quotes, and find
 * the closing bracket the same way. A title like "Plan, v2" or "Q&A [draft]"
 * therefore stays in one piece.
 */
function readList(s) {
  const items = [];
  let quote = null;
  let start = 1;
  for (let i = 1; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === ',' || c === ']') {
      items.push(s.slice(start, i));
      start = i + 1;
      if (c === ']') {
        const rest = s.slice(i + 1).trim();
        if (rest && !rest.startsWith('#')) return { error: 'unexpected text after list' };
        const parts = items.map((p) => p.trim());
        if (parts.length === 1 && parts[0] === '') return { value: [] };
        const out = [];
        for (const part of parts) {
          if (!part) return { error: 'empty list item' };
          const r = readScalar(part);
          if (r.error) return r;
          out.push(r.value);
        }
        return { value: out };
      }
    }
  }
  return { error: quote ? 'unterminated quote' : 'unterminated list' };
}

function readValue(raw) {
  const s = raw.trim();
  if (s.startsWith('[')) return readList(s);
  return readScalar(s);
}

/**
 * @param {string} text normalised file text
 * @returns {{ fields: Record<string,{value:string|string[],line:number}>,
 *             body: string, bodyStartLine: number,
 *             errors: Array<{line:number, rule:string}> }}
 */
export function splitFrontMatter(text) {
  const lines = text.split('\n');
  const errors = [];
  const fields = Object.create(null); // no prototype, so a key like __proto__ is just a key

  if (lines[0].trim() !== '---') {
    return { fields, body: '', bodyStartLine: 1, errors: [{ line: 1, rule: 'file must start with a --- line (front matter)' }] };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) {
    return { fields, body: '', bodyStartLine: 1, errors: [{ line: 1, rule: 'front matter is missing its closing --- line' }] };
  }

  for (let i = 1; i < end; i++) {
    const raw = lines[i];
    const line = i + 1;
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]+(.*)|[ \t]*)$/.exec(raw);
    if (!m) { errors.push({ line, rule: "front matter line is not in 'key: value' form" }); continue; }
    const key = m[1];
    if (Object.hasOwn(fields, key)) { errors.push({ line, rule: 'front matter key is repeated' }); continue; }
    const r = readValue(m[2] ?? '');
    if (r.error) { errors.push({ line, rule: `front matter value: ${r.error}` }); continue; }
    fields[key] = { value: r.value, line };
  }

  return { fields, body: lines.slice(end + 1).join('\n'), bodyStartLine: end + 2, errors };
}
