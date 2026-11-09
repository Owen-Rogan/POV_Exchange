// Document links: a POV points at a document that lives in Box, SharePoint or
// OneDrive. Nothing is uploaded into this public repo.
//
// In front matter each document is one list entry written as  Title | link :
//   documents: ["Agents deck | https://contoso.sharepoint.com/:b:/s/Team/Eabc"]
//
// This module is pure (no imports), so the build and the Add page run exactly
// the same checks. Rules never repeat the link they reject, because a link can
// carry an access token.

/** The only hosts a document link may point at. Subdomains match on a dot boundary. */
export const ALLOWED_HOSTS = ['box.com', 'sharepoint.com', '1drv.ms', 'onedrive.live.com'];

export const MAX_LINK = 1000;
export const MAX_TITLE = 100;

const LABELS = [
  ['box.com', 'Box'],
  ['sharepoint.com', 'SharePoint'],
  ['1drv.ms', 'OneDrive'],
  ['onedrive.live.com', 'OneDrive'],
];

/** "contoso.sharepoint.com" -> "SharePoint". Unknown hosts come back unchanged. */
export function hostLabel(host) {
  const h = String(host ?? '').toLowerCase();
  for (const [suffix, label] of LABELS) if (h === suffix || h.endsWith(`.${suffix}`)) return label;
  return h;
}

const fail = (rule) => ({ ok: false, rule });

/** @returns {string|null} a rule message, or null when the title is fine */
export function checkDocumentTitle(title) {
  const t = String(title ?? '').trim();
  if (!t) return 'a document needs a title before the | sign';
  if (t.length > MAX_TITLE) return `a document title is longer than ${MAX_TITLE} characters`;
  if (/[|"<>`\u0000-\u001f\u007f]/.test(t)) return 'a document title contains a character that is not allowed (| " < > or a back-tick)';
  return null;
}

/**
 * @param {string} raw
 * @param {{allowPersonalOneDrive?: boolean}} [opts]
 * @returns {{ok:true, url:string, host:string} | {ok:false, rule:string}}
 */
export function checkDocumentLink(raw, { allowPersonalOneDrive = false } = {}) {
  const s = String(raw ?? '').trim();
  if (!s) return fail('a document link is empty');
  if (s.length > MAX_LINK) return fail(`a document link is longer than ${MAX_LINK} characters`);
  if (/[\s\u0000-\u001f\u007f\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/.test(s)) {
    return fail('a document link contains spaces, control characters or invisible characters');
  }
  let u;
  try { u = new URL(s); } catch { return fail('a document link is not a valid web address'); }
  if (u.protocol !== 'https:') return fail('a document link must start with https://');
  if (u.username || u.password) return fail('a document link must not contain a user name or password');
  if (u.port) return fail('a document link must not use a custom port');
  const host = u.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return fail('a document link must point to Box, SharePoint or OneDrive');
  }
  if (!allowPersonalOneDrive) {
    // Personal OneDrive addresses carry the owner's name; a team site or Box link does not.
    const personalHost = /(^|\.)[a-z0-9-]+-my\.sharepoint\.com$/.test(host);
    const personalPath = /^\/(?::[a-z]:\/)?p\//i.test(u.pathname) || /\/personal\//i.test(u.pathname);
    if (personalHost || personalPath) {
      return fail('a document link points to a personal OneDrive; use a SharePoint team site or Box link instead');
    }
  }
  return { ok: true, url: u.href, host };
}

/**
 * Parse one front matter entry: "Title | link".
 * @returns {{ok:true, title:string, url:string, host:string} | {ok:false, rule:string}}
 */
export function parseDocumentEntry(entry, opts) {
  const text = String(entry ?? '');
  const bars = text.split('|').length - 1;
  if (bars !== 1) return fail('a document must be written as Title | link');
  const cut = text.indexOf('|');
  const title = text.slice(0, cut).trim();
  const bad = checkDocumentTitle(title);
  if (bad) return fail(bad);
  const link = checkDocumentLink(text.slice(cut + 1), opts);
  if (!link.ok) return link;
  return { ok: true, title, url: link.url, host: link.host };
}
