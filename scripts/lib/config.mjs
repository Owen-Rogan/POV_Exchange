// Site settings from site.config.json. Everything has a safe default, so a
// missing file is fine. The values are plain text only: no addresses and no
// links to anything internal, because this site is public.

import { scanText } from './rules.mjs';

export const DEFAULTS = Object.freeze({
  contactLine: 'Contact the AI & Analytics Practice',
  siteUrl: 'https://owen-rogan.github.io/POV_Exchange/',
  indexing: false,
  publisher: '',
  allowPersonalOneDrive: false,
});

const KEYS = new Set(Object.keys(DEFAULTS));

/**
 * @param {unknown} data parsed JSON
 * @returns {{config: object, problems: string[]}} problems never repeat the offending value
 */
export function validateConfig(data) {
  const problems = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { config: { ...DEFAULTS }, problems: ['must be a JSON object'] };
  }
  for (const k of Object.keys(data)) if (!KEYS.has(k)) problems.push(`has an unknown setting '${k.slice(0, 40)}'`);

  const config = { ...DEFAULTS };

  const text = (key, { min = 0, max }) => {
    if (data[key] === undefined) return;
    const v = data[key];
    if (typeof v !== 'string') { problems.push(`'${key}' must be text`); return; }
    const t = v.trim();
    if (t.length < min) { problems.push(`'${key}' cannot be empty`); return; }
    if (t.length > max) { problems.push(`'${key}' is longer than ${max} characters`); return; }
    if (/[@<>]|:\/\/|https?:/i.test(t)) { problems.push(`'${key}' must be plain text: no addresses, links or markup`); return; }
    for (const f of scanText(t)) problems.push(`'${key}' ${f.rule}`);
    config[key] = t;
  };
  text('contactLine', { min: 1, max: 120 });
  text('publisher', { max: 80 });

  if (data.siteUrl !== undefined) {
    let ok = typeof data.siteUrl === 'string' && data.siteUrl.length <= 200;
    let u;
    if (ok) { try { u = new URL(data.siteUrl); } catch { ok = false; } }
    if (ok && (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || !u.pathname.endsWith('/'))) ok = false;
    if (ok) config.siteUrl = u.href; else problems.push("'siteUrl' must be an https address ending in / with no query, # or sign-in details");
  }

  for (const key of ['indexing', 'allowPersonalOneDrive']) {
    if (data[key] === undefined) continue;
    if (typeof data[key] !== 'boolean') problems.push(`'${key}' must be true or false`); else config[key] = data[key];
  }
  return { config, problems };
}
