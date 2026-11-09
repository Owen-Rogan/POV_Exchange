// The "Show samples" and "Show drafts" choices, shared by the Library, the
// Graph page and the Glossary, and remembered in this browser.
//
// Samples default to shown (the site is still being shaped). Drafts default to
// hidden, so a visitor sees the practice's agreed positions first.

const KEY = { samples: 'pov-samples', drafts: 'pov-drafts' };
export const DEFAULTS = Object.freeze({ samples: true, drafts: false });

export function loadPref(name) {
  try {
    const v = localStorage.getItem(KEY[name]);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* storage blocked: use the default */ }
  return DEFAULTS[name];
}

export function savePref(name, value) {
  try { localStorage.setItem(KEY[name], value ? '1' : '0'); } catch { /* storage blocked: the choice lasts for this visit */ }
}

/** Stored choices, overridden by #samples=0|1 and #drafts=0|1 in the address. */
export function prefsFromParams(params) {
  const out = { samples: loadPref('samples'), drafts: loadPref('drafts') };
  if (params.get('samples') === '0') out.samples = false;
  else if (params.get('samples') === '1') out.samples = true;
  if (params.get('drafts') === '1') out.drafts = true;
  else if (params.get('drafts') === '0') out.drafts = false;
  return out;
}

/** Write only the values that differ from the defaults, so ordinary addresses stay clean. */
export function paramsFromPrefs(params, prefs) {
  if (prefs.samples !== DEFAULTS.samples) params.set('samples', prefs.samples ? '1' : '0'); else params.delete('samples');
  if (prefs.drafts !== DEFAULTS.drafts) params.set('drafts', prefs.drafts ? '1' : '0'); else params.delete('drafts');
}

/** Hash parameters, or an empty set when the hash is a plain anchor such as #topic-agents or #guardrail. */
export function readHashParams() {
  const raw = location.hash.slice(1);
  return raw.includes('=') ? new URLSearchParams(raw) : new URLSearchParams();
}
