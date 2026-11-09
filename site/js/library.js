// The Library page: search, topic chips, By topic / Newest first, the Show
// samples and Show drafts switches, and "Show all". It filters the cards that
// are already in the HTML, so the page is complete without JavaScript and this
// only adds controls.
//
// Nothing is hard-coded about counts: every number on the page (headline stats,
// topic tiles, the picture of the topics) is worked out from the cards that are
// actually shown, so it can never disagree with them.
//
// URL hash:  #q=agents  #t=governance  #v=newest  #samples=0  #drafts=1
// (anchors like #topic-agents are left alone)

import { paramsFromPrefs, prefsFromParams, readHashParams, savePref } from './prefs.js';

const MAX_QUERY = 100;
const SHOW_FIRST = 6;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function writeHash(params) {
  const s = params.toString();
  history.replaceState(null, '', location.pathname + location.search + (s ? '#' + s : ''));
}

export function initLibrary() {
  const input = document.getElementById('q');
  if (!input) return;
  const $ = (sel) => document.querySelector(sel);
  const searchBox = $('.search');
  const seg = $('.seg');
  const sampleLabel = $('.switch-samples');
  const draftLabel = $('.switch-drafts');
  const sampleSwitch = sampleLabel.querySelector('input');
  const draftSwitch = draftLabel.querySelector('input');
  const chipList = $('.chips');
  const count = $('.count');
  const clearBtn = $('.clear');
  const none = $('.no-results');
  const byTopic = $('.by-topic');
  const newest = $('#newest');
  const tilesBox = $('.tiles');
  const tiles = [...document.querySelectorAll('.tile')];
  const sections = [...byTopic.querySelectorAll('section.topic')];
  const cards = [...byTopic.querySelectorAll('.card[data-slug]')];
  const newestCards = [...newest.querySelectorAll('.card[data-slug]')];
  const previews = [...document.querySelectorAll('.preview-svg')];
  const previewTopics = previews.flatMap((svg) => [...svg.querySelectorAll('[data-topic]')]);
  const hasSamples = document.querySelector('[data-sample="1"]') !== null;
  const hasDrafts = cards.some((c) => c.dataset.status === 'draft');

  searchBox.hidden = false;
  seg.hidden = false;
  sampleLabel.hidden = !hasSamples;
  draftLabel.hidden = !hasDrafts;
  chipList.classList.remove('nojs');

  const topicIds = new Set(sections.map((s) => s.dataset.topic));
  const state = { q: '', t: '', v: 'topic', ...prefsFromParams(readHashParams()), expanded: new Set() };

  // chips become toggle buttons
  const chips = [...chipList.querySelectorAll('.chip')].map((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.topic = a.dataset.topic;
    b.textContent = a.textContent;
    b.setAttribute('aria-pressed', 'false');
    a.replaceWith(b);
    b.addEventListener('click', () => set({ t: state.t === b.dataset.topic ? '' : b.dataset.topic }));
    return b;
  });

  // one "Show all N" button per topic that has more than SHOW_FIRST cards
  const moreButtons = new Map();
  for (const sec of sections) {
    if (!sec.querySelector('.card.more')) continue;
    const p = document.createElement('p');
    p.className = 'more-row';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'more-btn';
    b.addEventListener('click', () => {
      const id = sec.dataset.topic;
      if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
      apply(false);
    });
    p.append(b);
    sec.append(p);
    moreButtons.set(sec, b);
  }

  seg.addEventListener('click', (ev) => {
    const b = ev.target instanceof Element ? ev.target.closest('[data-view]') : null;
    if (b) set({ v: b.dataset.view });
  });

  let queued = 0;
  input.addEventListener('input', () => { clearTimeout(queued); queued = setTimeout(() => set({ q: input.value }), 120); });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && input.value) { input.value = ''; set({ q: '' }); } });
  clearBtn.addEventListener('click', () => { input.value = ''; set({ q: '', t: '' }); });
  sampleSwitch.addEventListener('change', () => { savePref('samples', sampleSwitch.checked); set({ samples: sampleSwitch.checked }); });
  draftSwitch.addEventListener('change', () => { savePref('drafts', draftSwitch.checked); set({ drafts: draftSwitch.checked }); });
  addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (h.startsWith('topic-')) revealTopic(h.slice(6)); else fromHash();
  });

  function revealTopic(id) {
    // Jumping to a topic from a tile: make sure its section is visible and expanded.
    state.v = 'topic';
    state.expanded.add(id);
    apply(false);
    // A tile or chip click on the same page keeps the smooth scroll; the first jump on load is instant.
    document.getElementById(`topic-${id}`)?.scrollIntoView({ block: 'start', behavior: loaded ? 'smooth' : 'instant' });
  }

  function fromHash() {
    const p = readHashParams();
    const t = p.get('t') ?? '';
    state.t = topicIds.has(t) ? t : '';
    state.q = (p.get('q') ?? '').slice(0, MAX_QUERY);
    state.v = p.get('v') === 'newest' ? 'newest' : 'topic';
    Object.assign(state, prefsFromParams(p));
    input.value = state.q;
    sampleSwitch.checked = state.samples;
    draftSwitch.checked = state.drafts;
    apply(false);
  }

  function set(patch) {
    for (const k of ['q', 't', 'v', 'samples', 'drafts']) if (patch[k] !== undefined) state[k] = k === 'q' ? patch[k].slice(0, MAX_QUERY) : patch[k];
    apply(true);
  }

  /** A card or section is eligible when it passes the two switches. */
  const eligible = (el) => (state.samples || el.dataset.sample !== '1') && (state.drafts || el.dataset.status !== 'draft');

  function apply(updateHash) {
    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const searching = terms.length > 0;
    const active = searching || Boolean(state.t);
    const matchesCard = (card) => {
      if (!eligible(card)) return false;
      if (state.t && !card.dataset.topics.split(' ').includes(state.t)) return false;
      return terms.every((w) => card.dataset.text.includes(w));
    };

    // Which POVs and topics are eligible at all (ignoring search), for counts and the picture.
    const eligibleSlugs = new Set(cards.filter(eligible).map((c) => c.dataset.slug));
    const perTopic = new Map(sections.map((s) => [s.dataset.topic, 0]));
    for (const card of cards.filter(eligible)) for (const t of card.dataset.topics.split(' ')) perTopic.set(t, (perTopic.get(t) ?? 0) + 1);
    const topicShown = (id) => {
      const sec = sections.find((s) => s.dataset.topic === id);
      // A sample-only topic goes with the samples; an empty topic stays visible only if it has no POVs at all.
      return !(sec && sec.dataset.sample === '1' && !state.samples);
    };

    const shown = new Set();
    for (const card of cards) if (matchesCard(card)) shown.add(card.dataset.slug);

    // By topic
    for (const sec of sections) {
      const own = [...sec.querySelectorAll('.card[data-slug]')];
      const matching = own.filter(matchesCard);
      // Searching or filtering shows every match. Otherwise only the first few per topic,
      // unless this topic was expanded. Cards past the cutoff carry the "more" class from the build.
      const expanded = active || state.expanded.has(sec.dataset.topic);
      for (const card of own) card.hidden = !(matchesCard(card) && (expanded || !card.classList.contains('more')));
      const empty = own.length > 0 && own.filter(eligible).length === 0;
      sec.hidden = !topicShown(sec.dataset.topic) || empty || (state.t ? sec.dataset.topic !== state.t : false) || (searching && matching.length === 0);
      const btn = moreButtons.get(sec);
      if (btn) {
        // Only useful when more cards match than the cutoff and no filter is already showing them all.
        btn.parentElement.hidden = active || matching.length <= SHOW_FIRST;
        btn.textContent = state.expanded.has(sec.dataset.topic) ? 'Show fewer' : `Show all ${matching.length}`;
      }
    }

    // Newest first
    let visibleNewest = 0;
    for (const card of newestCards) {
      const ok = matchesCard(card);
      card.hidden = !ok;
      if (ok) visibleNewest += 1;
    }

    byTopic.hidden = state.v !== 'topic';
    newest.hidden = state.v !== 'newest';
    for (const b of seg.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === state.v));

    // Tiles, chips and the picture all follow the switches, with counts taken from the eligible cards.
    for (const tile of tiles) {
      const id = tile.dataset.topic;
      const n = perTopic.get(id) ?? 0;
      tile.hidden = !topicShown(id) || (n === 0 && !state.drafts && cards.some((c) => c.dataset.topics.split(' ').includes(id))) || (state.t ? id !== state.t : false);
      tile.querySelector('.tile-count').textContent = plural(n, 'POV', 'POVs');
    }
    tilesBox.hidden = tiles.every((t) => t.hidden);
    for (const b of chips) {
      const id = b.dataset.topic;
      const n = perTopic.get(id) ?? 0;
      b.hidden = !topicShown(id) || (n === 0 && cards.some((c) => c.dataset.topics.split(' ').includes(id)));
      b.setAttribute('aria-pressed', String(id === state.t));
    }
    // The picture of the topics: hide dots and topics that are switched off, and recount the circles.
    {
      for (const svg of previews) {
        svg.classList.toggle('hide-samples', !state.samples);
        svg.classList.toggle('hide-drafts', !state.drafts);
      }
      for (const g of previewTopics) {
        const id = g.dataset.topic;
        const n = perTopic.get(id) ?? 0;
        const text = g.querySelector('.cnt');
        if (text) text.textContent = String(n);
        g.classList.toggle('off', !topicShown(id) || (n === 0 && cards.some((c) => c.dataset.topics.split(' ').includes(id))));
      }
    }
    // The headline numbers
    // Count each POV once: the by-topic list repeats a POV under every topic it belongs to, the newest-first list does not.
    const docs = newestCards.filter(eligible).reduce((sum, c) => sum + Number(c.dataset.docs || 0), 0);
    const liveTopics = [...perTopic].filter(([id, n]) => topicShown(id) && n > 0).length;
    const set3 = { povs: eligibleSlugs.size, topics: liveTopics, docs };
    for (const span of document.querySelectorAll('[data-stat]')) {
      const n = set3[span.dataset.stat] ?? 0;
      span.textContent = plural(n, span.dataset.one, span.dataset.many);
    }

    const visibleCount = state.v === 'topic' ? shown.size : visibleNewest;
    clearBtn.hidden = !active;
    none.hidden = !(active && visibleCount === 0);
    count.textContent = active ? `Showing ${visibleCount} of ${eligibleSlugs.size} POV${eligibleSlugs.size === 1 ? '' : 's'}` : plural(eligibleSlugs.size, 'POV', 'POVs');

    if (updateHash) {
      const p = readHashParams();
      for (const [k, v, def] of [['q', state.q, ''], ['t', state.t, ''], ['v', state.v, 'topic']]) { if (v && v !== def) p.set(k, v); else p.delete(k); }
      paramsFromPrefs(p, state);
      writeHash(p);
    }
  }

  let loaded = false;
  sampleSwitch.checked = state.samples;
  draftSwitch.checked = state.drafts;
  fromHash();
  if (location.hash.startsWith('#topic-')) revealTopic(location.hash.slice(7));
  loaded = true;
}
