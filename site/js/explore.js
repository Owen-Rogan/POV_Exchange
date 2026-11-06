// Search box and topic chips for the home page. Filters the cards and sections
// that are already in the HTML, and keeps the state in the URL hash:
//   #q=agents&t=governance        (anchors like #topic-agents are left alone)

const MAX_QUERY = 100;

function readHash() {
  const h = location.hash.slice(1);
  if (!h || h.startsWith('topic-')) return new URLSearchParams();
  return new URLSearchParams(h);
}

function writeHash(params) {
  const s = params.toString();
  history.replaceState(null, '', location.pathname + location.search + (s ? '#' + s : ''));
}

/**
 * @param {{onChange:(view:{slugs:Set<string>, topic:string, active:boolean})=>void}} opts
 */
export function initExplore({ onChange }) {
  const input = document.getElementById('q');
  const searchBox = document.querySelector('.search');
  const chipList = document.querySelector('.chips');
  const count = document.querySelector('.count');
  const clearBtn = document.querySelector('.clear');
  const cards = [...document.querySelectorAll('.card[data-slug]')];
  const sections = [...document.querySelectorAll('section.topic')];
  if (!input || !chipList || !count) return { apply() {} };

  searchBox.hidden = false;
  chipList.classList.remove('nojs');

  const topicIds = new Set(sections.map((s) => s.dataset.topic));
  const totalSlugs = new Set(cards.map((c) => c.dataset.slug));
  const state = { q: '', t: '' };

  // Anchors become toggle buttons, so keyboard and screen readers get proper semantics.
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

  const none = document.createElement('p');
  none.className = 'no-results';
  none.hidden = true;
  none.textContent = 'No POVs match. Try a different word or clear the filters.';
  sections.at(-1)?.after(none);

  let queued = 0;
  input.addEventListener('input', () => {
    clearTimeout(queued);
    queued = setTimeout(() => set({ q: input.value }), 120);
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && input.value) { input.value = ''; set({ q: '' }); }
  });
  clearBtn?.addEventListener('click', () => { input.value = ''; set({ q: '', t: '' }); });
  addEventListener('hashchange', () => { if (!location.hash.slice(1).startsWith('topic-')) fromHash(); });

  function fromHash() {
    const p = readHash();
    const t = p.get('t') ?? '';
    state.t = topicIds.has(t) ? t : '';
    state.q = (p.get('q') ?? '').slice(0, MAX_QUERY);
    input.value = state.q;
    apply(false);
  }

  function set(patch) {
    if (patch.q !== undefined) state.q = patch.q.slice(0, MAX_QUERY);
    if (patch.t !== undefined) state.t = patch.t;
    apply(true);
  }

  function apply(updateHash) {
    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = new Set();

    for (const card of cards) {
      const inTopic = !state.t || card.dataset.topics.split(' ').includes(state.t);
      const text = card.dataset.text;
      const match = inTopic && terms.every((w) => text.includes(w));
      card.hidden = !match;
      if (match) shown.add(card.dataset.slug);
    }
    const searching = terms.length > 0;
    for (const sec of sections) {
      const visibleCards = sec.querySelectorAll('.card[data-slug]:not([hidden])').length;
      const wantedTopic = !state.t || sec.dataset.topic === state.t;
      sec.hidden = !wantedTopic || (searching && visibleCards === 0);
    }
    for (const b of chips) b.setAttribute('aria-pressed', String(b.dataset.topic === state.t));

    const active = searching || Boolean(state.t);
    clearBtn.hidden = !active;
    none.hidden = !active || shown.size > 0;
    count.textContent = active
      ? `Showing ${shown.size} of ${totalSlugs.size} POV${totalSlugs.size === 1 ? '' : 's'}`
      : `${totalSlugs.size} POV${totalSlugs.size === 1 ? '' : 's'}`;

    if (updateHash) {
      const p = readHash();
      if (state.q) p.set('q', state.q); else p.delete('q');
      if (state.t) p.set('t', state.t); else p.delete('t');
      writeHash(p);
    }
    onChange({ slugs: shown, topic: state.t, active });
  }

  fromHash();
  return { apply: () => apply(false) };
}
