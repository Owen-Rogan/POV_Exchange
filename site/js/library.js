// The Library page: search, topic chips, By topic / Newest first, the sample
// switch and "Show all". It filters the cards that are already in the HTML, so
// the page is complete without JavaScript and this only adds controls.
//
// URL hash:  #q=agents  #t=governance  #v=newest  #samples=0
// (anchors like #topic-agents are left alone)

const MAX_QUERY = 100;
const SHOW_FIRST = 6;
const STORE_SAMPLES = 'pov-samples';

function readHash() {
  const h = location.hash.slice(1);
  if (!h || h.startsWith('topic-') || h === 'explore') return new URLSearchParams();
  return new URLSearchParams(h);
}

function writeHash(params) {
  const s = params.toString();
  history.replaceState(null, '', location.pathname + location.search + (s ? '#' + s : ''));
}

export function initLibrary() {
  const input = document.getElementById('q');
  if (!input) return;
  const searchBox = document.querySelector('.search');
  const seg = document.querySelector('.seg');
  const sampleLabel = document.querySelector('.switch');
  const sampleSwitch = sampleLabel.querySelector('input');
  const chipList = document.querySelector('.chips');
  const count = document.querySelector('.count');
  const clearBtn = document.querySelector('.clear');
  const none = document.querySelector('.no-results');
  const byTopic = document.querySelector('.by-topic');
  const newest = document.getElementById('newest');
  const tiles = [...document.querySelectorAll('.tile')];
  const sections = [...byTopic.querySelectorAll('section.topic')];
  const cards = [...byTopic.querySelectorAll('.card[data-slug]')];
  const newestCards = [...newest.querySelectorAll('.card[data-slug]')];
  const hasSamples = document.querySelector('[data-sample="1"]') !== null;

  searchBox.hidden = false;
  seg.hidden = false;
  if (hasSamples) sampleLabel.hidden = false;
  chipList.classList.remove('nojs');

  const topicIds = new Set(sections.map((s) => s.dataset.topic));
  const state = { q: '', t: '', v: 'topic', samples: true, expanded: new Set() };
  try { if (hasSamples && localStorage.getItem(STORE_SAMPLES) === '0') state.samples = false; } catch { /* storage blocked */ }

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
    const extra = sec.querySelectorAll('.card.more').length;
    if (!extra) continue;
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
  sampleSwitch.addEventListener('change', () => {
    set({ samples: sampleSwitch.checked });
    try { localStorage.setItem(STORE_SAMPLES, state.samples ? '1' : '0'); } catch { /* storage blocked */ }
  });
  addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (!h.startsWith('topic-')) fromHash();
    else revealTopic(h.slice(6));
  });

  function revealTopic(id) {
    // Jumping to a topic from a tile: make sure its section is visible and expanded.
    if (state.v !== 'topic') { state.v = 'topic'; }
    state.expanded.add(id);
    apply(false);
    document.getElementById(`topic-${id}`)?.scrollIntoView({ block: 'start' });
  }

  function fromHash() {
    const p = readHash();
    const t = p.get('t') ?? '';
    state.t = topicIds.has(t) ? t : '';
    state.q = (p.get('q') ?? '').slice(0, MAX_QUERY);
    state.v = p.get('v') === 'newest' ? 'newest' : 'topic';
    if (p.get('samples') === '0' && hasSamples) state.samples = false;
    input.value = state.q;
    sampleSwitch.checked = state.samples;
    apply(false);
  }

  function set(patch) {
    for (const k of ['q', 't', 'v', 'samples']) if (patch[k] !== undefined) state[k] = k === 'q' ? patch[k].slice(0, MAX_QUERY) : patch[k];
    apply(true);
  }

  const showSample = (el) => state.samples || el.dataset.sample !== '1';

  function apply(updateHash) {
    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const searching = terms.length > 0;
    const active = searching || Boolean(state.t);
    const matchesCard = (card) => {
      if (!showSample(card)) return false;
      if (state.t && !card.dataset.topics.split(' ').includes(state.t)) return false;
      return terms.every((w) => card.dataset.text.includes(w));
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
      for (const card of own) {
        const beyondCutoff = card.classList.contains('more');
        card.hidden = !(matchesCard(card) && (expanded || !beyondCutoff));
      }
      const topicHidden = sec.dataset.sample === '1' && !state.samples;
      sec.hidden = topicHidden || (state.t ? sec.dataset.topic !== state.t : false) || (searching && matching.length === 0);
      const btn = moreButtons.get(sec);
      if (btn) {
        const total = matching.length;
        // The button is only useful when there are more matching cards than the cutoff, and no filter is already showing all.
        btn.parentElement.hidden = active || total <= SHOW_FIRST;
        btn.textContent = state.expanded.has(sec.dataset.topic) ? 'Show fewer' : `Show all ${total}`;
      }
    }

    // Newest first
    let visibleNewest = 0;
    for (const card of newestCards) {
      const ok = matchesCard(card);
      card.hidden = !ok;
      if (ok) visibleNewest += 1;
    }
    newestCards.sort((a, b) => (a.dataset.date < b.dataset.date ? 1 : a.dataset.date > b.dataset.date ? -1 : 0));

    byTopic.hidden = state.v !== 'topic';
    newest.hidden = state.v !== 'newest';
    for (const b of seg.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === state.v));

    // Tiles follow the sample switch and show the right count
    for (const tile of tiles) {
      const gone = tile.dataset.sample === '1' && !state.samples;
      tile.hidden = gone || (state.t ? tile.dataset.topic !== state.t : false);
      const c = tile.querySelector('.tile-count');
      const n = Number(state.samples ? c.dataset.all : c.dataset.real);
      c.textContent = `${n} ${n === 1 ? 'POV' : 'POVs'}`;
    }
    document.querySelector('.tiles').hidden = tiles.every((t) => t.hidden);

    // Chips and the headline numbers follow the sample switch
    for (const b of chips) {
      const sec = sections.find((s) => s.dataset.topic === b.dataset.topic);
      b.hidden = Boolean(sec && sec.dataset.sample === '1' && !state.samples);
      b.setAttribute('aria-pressed', String(b.dataset.topic === state.t));
    }
    for (const span of document.querySelectorAll('[data-stat]')) {
      const n = Number(state.samples ? span.dataset.all : span.dataset.real);
      span.textContent = `${n} ${n === 1 ? span.dataset.one : span.dataset.many}`;
    }

    const total = cards.filter(showSample).map((c) => c.dataset.slug);
    const totalCount = new Set(total).size;
    const visibleCount = state.v === 'topic' ? shown.size : visibleNewest;
    clearBtn.hidden = !active;
    none.hidden = !(active && visibleCount === 0);
    count.textContent = active ? `Showing ${visibleCount} of ${totalCount} POV${totalCount === 1 ? '' : 's'}` : `${totalCount} POV${totalCount === 1 ? '' : 's'}`;

    if (updateHash) {
      const p = readHash();
      for (const [k, v, def] of [['q', state.q, ''], ['t', state.t, ''], ['v', state.v, 'topic']]) { if (v && v !== def) p.set(k, v); else p.delete(k); }
      if (hasSamples && !state.samples) p.set('samples', '0'); else p.delete('samples');
      writeHash(p);
    }
  }

  sampleSwitch.checked = state.samples;
  fromHash();
  if (location.hash.startsWith('#topic-')) revealTopic(location.hash.slice(7));
}
