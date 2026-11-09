// The Glossary page: search, and the Show samples / Show drafts switches. The
// terms are already in the HTML, so this only filters what is shown.
//
// URL hash:  #q=text  #samples=0  #drafts=1   (a plain #guardrail jumps to that entry)

import { paramsFromPrefs, prefsFromParams, readHashParams, savePref } from './prefs.js';

const MAX_QUERY = 100;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function initGlossary() {
  const root = document.querySelector('.gloss');
  const entries = root ? [...root.querySelectorAll('.gl-entry')] : [];
  if (!root || !entries.length) return;

  const searchBox = root.querySelector('.search');
  const input = root.querySelector('#gl-q');
  const sampleLabel = root.querySelector('.switch-samples');
  const draftLabel = root.querySelector('.switch-drafts');
  const sampleSwitch = sampleLabel.querySelector('input');
  const draftSwitch = draftLabel.querySelector('input');
  const count = root.querySelector('.gl-count');
  const none = root.querySelector('.gl-none');
  const groups = [...root.querySelectorAll('.gl-group')];
  const letters = [...root.querySelectorAll('.gl-letters a')];

  const hasSamples = root.querySelector('[data-sample="1"]') !== null;
  const hasDrafts = root.querySelector('[data-status="draft"]') !== null;
  searchBox.hidden = false;
  sampleLabel.hidden = !hasSamples;
  draftLabel.hidden = !hasDrafts;

  const state = { q: '', ...prefsFromParams(readHashParams()) };
  state.q = (readHashParams().get('q') ?? '').slice(0, MAX_QUERY);
  input.value = state.q;
  sampleSwitch.checked = state.samples;
  draftSwitch.checked = state.drafts;

  const shows = (el) => (state.samples || el.dataset.sample !== '1') && (state.drafts || el.dataset.status !== 'draft');

  function apply(updateHash) {
    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const entry of entries) {
      const ok = (state.samples || entry.dataset.sample !== '1') && terms.every((w) => entry.dataset.text.includes(w));
      entry.hidden = !ok;
      if (!ok) continue;
      shown += 1;
      // the "used in" list follows the switches
      const items = [...entry.querySelectorAll('.gl-uses li')];
      let n = 0;
      for (const li of items) { const v = shows(li); li.hidden = !v; if (v) n += 1; }
      const head = entry.querySelector('.gl-uses-h');
      if (head) head.textContent = n ? `Used in ${plural(n, 'POV', 'POVs')}` : 'Not used in any POV shown';
    }
    for (const g of groups) {
      const any = [...g.querySelectorAll('.gl-entry')].some((e) => !e.hidden);
      g.hidden = !any;
      const a = letters.find((l) => l.getAttribute('href') === `#${g.id}`);
      if (a) a.hidden = !any;
    }
    none.hidden = shown > 0;
    count.textContent = terms.length ? `Showing ${shown} of ${entries.filter((e) => state.samples || e.dataset.sample !== '1').length} terms` : plural(shown, 'term', 'terms');
    if (updateHash) {
      const p = readHashParams();
      if (state.q) p.set('q', state.q); else p.delete('q');
      paramsFromPrefs(p, state);
      const s = p.toString();
      history.replaceState(null, '', location.pathname + location.search + (s ? `#${s}` : ''));
    }
  }

  let queued = 0;
  input.addEventListener('input', () => { clearTimeout(queued); queued = setTimeout(() => { state.q = input.value.slice(0, MAX_QUERY); apply(true); }, 120); });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && input.value) { input.value = ''; state.q = ''; apply(true); } });
  sampleSwitch.addEventListener('change', () => { state.samples = sampleSwitch.checked; savePref('samples', state.samples); apply(true); });
  draftSwitch.addEventListener('change', () => { state.drafts = draftSwitch.checked; savePref('drafts', state.drafts); apply(true); });

  apply(false);
  // A link such as glossary/#guardrail should land on its entry once the page has been filtered.
  const anchor = location.hash.slice(1);
  // Jump straight there on load: a smooth scroll across a long page would animate for a second or more.
  if (anchor && !anchor.includes('=')) document.getElementById(anchor)?.scrollIntoView({ block: 'start', behavior: 'instant' });
}
