// The Graph page: starts the engine at the right tier and connects it to the
// toolbar, the search and topic filters, the sample switch, the timeline, the
// guided tour, the reader panel and the URL.
//
// URL hash (kept in step as you explore, so every view can be shared):
//   #n=p:some-slug     the selected node         #t=agents   topic filter
//   #q=text            search                     #samples=0  samples hidden
//   #drafts=1          drafts shown               #terms=1    glossary terms shown
// Selecting a node adds a history entry, so Back steps through your hops.

import { applyFilters, focusSet } from './graph-filter.js';
import { withIndex } from './graph-data.js';
import { paramsFromPrefs, prefsFromParams, readHashParams, savePref } from './prefs.js';
import { createReader } from './reader.js';
import { distinctDates, makeTimeline, prettyDate } from './timeline.js';
import { pickTier } from './tier.js';
import { stepIndex, tourSteps } from './tour.js';

const MAX_QUERY = 100;

async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export async function initGraphPage() {
  const root = document.querySelector('.gp');
  const stage = root?.querySelector('[data-hero-stage]');
  if (!root || !stage) return;

  const picked = pickTier();
  root.dataset.tier = picked.tier;
  root.dataset.reason = picked.reason;
  root.dataset.reduced = picked.reduced ? '1' : '0';

  const $ = (sel) => root.querySelector(sel);
  const bar = $('.gp-bar');
  const searchBox = $('.gp-search');
  const input = $('#g-q');
  const chipList = $('.gp-chips');
  const sampleLabel = $('.switch-samples');
  const draftLabel = $('.switch-drafts');
  const termLabel = $('.switch-terms');
  const sampleSwitch = sampleLabel.querySelector('input');
  const draftSwitch = draftLabel.querySelector('input');
  const termSwitch = termLabel.querySelector('input');
  const tools = $('.gp-tools');
  const count = $('.gp-count');
  const legend = $('.gp-legend');
  const help = $('.gp-help');
  const timeBox = $('.gp-time');
  const slider = $('#g-time');
  const timeLabel = $('.gp-time-label');
  const playBtn = timeBox.querySelector('[data-act="play"]');
  const tourBtn = tools.querySelector('[data-act="tour"]');

  if (picked.tier === 'static') {
    root.classList.add('is-static');
    return; // the poster and the list are already on the page
  }

  let data;
  try {
    const [graph, povs, topics, glossary, site] = await Promise.all([
      getJson('../data/graph.json'), getJson('../data/povs.json'), getJson('../data/topics.json'),
      getJson('../data/glossary.json'), getJson('../data/site.json'),
    ]);
    data = { model: withIndex(graph), povs, topics, glossary, site };
  } catch (err) {
    console.warn('POV Exchange: could not load the graph data.', err);
    root.dataset.tier = 'static';
    root.classList.add('is-static');
    return;
  }
  const { model } = data;
  const povBySlug = new Map(data.povs.map((p) => [p.slug, p]));
  const topicById = new Map(data.topics.map((t) => [t.id, t]));
  const glossaryBySlug = new Map(data.glossary.map((g) => [g.slug, g]));
  const hasSamples = model.nodes.some((n) => n.sample);
  const hasDrafts = model.nodes.some((n) => n.status === 'draft');
  const hasTerms = model.nodes.some((n) => n.kind === 'term');
  // The timeline follows the sample switch: it only spans dates that are actually shown.
  let dates = [];
  let timeline = makeTimeline([]);

  // ------------------------------------------------------------- state
  const state = { q: '', topic: '', ...prefsFromParams(new URLSearchParams()), terms: false, until: null, selected: null };
  const history = []; // ids visited by hopping, for the reader's Back button
  const bodies = new Map();
  let engine = null;
  let result = null;
  let playing = 0;
  let tour = null; // { steps, index }


  const isHidden = (id) => {
    const i = model.index.get(id);
    return i === undefined || !result || !result.visible[i];
  };

  const reader = createReader(root, {
    model, povBySlug, topicById, glossaryBySlug,
    contactLine: data.site.contactLine,
    isHidden,
    loadBody(slug) {
      if (!bodies.has(slug)) {
        bodies.set(slug, getJson(`../data/pov/${encodeURIComponent(slug)}.json`).catch((e) => { bodies.delete(slug); throw e; }));
      }
      return bodies.get(slug);
    },
    onNavigate: (id) => select(id, { hop: true }),
    onClose: () => select(null),
    onBack: () => {
      const prev = history.pop();
      select(prev ?? null, { back: true });
    },
  });

  // ------------------------------------------------------------- URL
  function writeHash({ push = false } = {}) {
    const p = new URLSearchParams();
    if (state.selected) p.set('n', state.selected);
    if (state.topic) p.set('t', state.topic);
    if (state.q) p.set('q', state.q);
    paramsFromPrefs(p, state);
    if (state.terms) p.set('terms', '1');
    const s = p.toString();
    const url = location.pathname + location.search + (s ? `#${s}` : '');
    if (push) history_pushState(url); else window.history.replaceState(window.history.state, '', url);
  }
  const history_pushState = (url) => window.history.pushState({ pov: 1 }, '', url);

  // ------------------------------------------------------------- filters
  function refresh({ frame = false } = {}) {
    result = applyFilters(model, povBySlug, topicById, {
      q: state.q, topic: state.topic, samples: state.samples, drafts: state.drafts, terms: state.terms, until: state.until,
    });
    if (engine) {
      engine.setVisible(result.visible, { frame });
      engine.setFocus(focusSet(model, result));
    }
    const shown = result.counts.pov;
    const total = model.nodes.filter((n, i) => n.kind === 'pov' && (state.samples || !n.sample) && (state.drafts || n.status !== 'draft')).length;
    count.textContent = result.active ? `${matchedPovCount()} of ${total} POVs` : `${shown} ${shown === 1 ? 'POV' : 'POVs'}`;
    for (const b of chipList.querySelectorAll('.chip')) b.setAttribute('aria-pressed', String(b.dataset.topic === state.topic));
    for (const b of chipList.querySelectorAll('.chip')) b.hidden = isHidden(`t:${b.dataset.topic}`) && b.dataset.topic !== state.topic;
    if (state.selected && isHidden(state.selected)) select(null);
  }
  function matchedPovCount() {
    let n = 0;
    model.nodes.forEach((node, i) => { if (node.kind === 'pov' && result.visible[i] && result.matched[i]) n += 1; });
    return n;
  }

  // ------------------------------------------------------------- selection
  function select(id, { hop = false, back = false, fromUrl = false } = {}) {
    if (id && (!model.byId.has(id) || isHidden(id))) id = null;
    if (hop && state.selected && state.selected !== id) history.push(state.selected);
    if (!hop && !back) history.length = 0;
    const changed = state.selected !== id;
    state.selected = id;
    engine?.setSelected(id);
    if (!id) {
      reader.hide();
      engine?.setInsets({});
    } else {
      engine?.setInsets(readerInsets());
      reader.show(id, { moveFocus: !fromUrl, canGoBack: history.length > 0 });
    }
    root.classList.toggle('has-reader', Boolean(id));
    if (!fromUrl && changed) writeHash({ push: Boolean(id) });
  }
  function readerInsets() {
    const wide = window.matchMedia('(min-width: 900px)').matches;
    return wide ? { right: Math.min(440, window.innerWidth * 0.4) } : { bottom: Math.round(window.innerHeight * 0.46) };
  }

  // ------------------------------------------------------------- controls
  function buildChips() {
    for (const t of data.topics) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.topic = t.id;
      b.textContent = t.title;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        state.topic = state.topic === t.id ? '' : t.id;
        writeHash();
        refresh({ frame: true });
      });
      li.append(b);
      chipList.append(li);
    }
  }

  let queued = 0;
  input.addEventListener('input', () => {
    clearTimeout(queued);
    queued = setTimeout(() => {
      state.q = input.value.slice(0, MAX_QUERY);
      writeHash();
      refresh({ frame: true });
    }, 140);
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { if (input.value) { input.value = ''; state.q = ''; writeHash(); refresh({ frame: true }); } input.blur(); stage.focus(); }
  });

  sampleSwitch.checked = state.samples;
  draftSwitch.checked = state.drafts;
  termSwitch.checked = state.terms;
  const onSwitch = () => {
    state.samples = sampleSwitch.checked;
    state.drafts = draftSwitch.checked;
    state.terms = termSwitch.checked;
    legend.querySelector('.lg-term').hidden = !state.terms;
    savePref('samples', state.samples);
    savePref('drafts', state.drafts);
    writeHash();
    rebuildTimeline();
    refresh({ frame: true });
  };
  for (const s of [sampleSwitch, draftSwitch, termSwitch]) s.addEventListener('change', onSwitch);

  tools.addEventListener('click', (ev) => {
    const b = ev.target instanceof Element ? ev.target.closest('[data-act]') : null;
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'frame') engine?.frame();
    else if (act === 'reset') { engine?.reset(); }
    else if (act === 'tour') toggleTour();
    else if (act === 'fullscreen') toggleFullscreen();
  });

  function toggleFullscreen() {
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    root.requestFullscreen?.().catch(() => { /* not allowed here: nothing to do */ });
  }
  if (!root.requestFullscreen) tools.querySelector('[data-act="fullscreen"]').hidden = true;

  // ------------------------------------------------------------- timeline
  function setTime(pos, { quiet = false } = {}) {
    const date = timeline.dateAt(pos);
    state.until = pos >= timeline.max ? null : date;
    timeLabel.textContent = state.until ? `Up to ${prettyDate(state.until)}` : `All dates (${prettyDate(dates[0])} to ${prettyDate(dates[dates.length - 1])})`;
    slider.setAttribute('aria-valuetext', timeLabel.textContent);
    if (!quiet) refresh();
  }
  /** Rebuild the slider for the dates currently shown. Hides it when there is nothing to scrub. */
  function rebuildTimeline() {
    stopPlay();
    dates = distinctDates(model.nodes.filter((n) => (state.samples || !n.sample) && (state.drafts || n.status !== 'draft')));
    timeline = makeTimeline(dates);
    state.until = null;
    timeBox.hidden = !timeline.usable;
    if (!timeline.usable) return;
    slider.max = String(timeline.max);
    slider.value = String(timeline.max);
    setTime(timeline.max, { quiet: true });
  }
  slider.addEventListener('input', () => { stopPlay(); setTime(Number(slider.value)); });
  playBtn.addEventListener('click', () => (playing ? stopPlay() : startPlay()));
  if (picked.reduced) playBtn.hidden = true; // no autoplay under reduced motion; the slider still works
  rebuildTimeline();
  function startPlay() {
    if (!timeline.usable) return;
    if (Number(slider.value) >= timeline.max) { slider.value = '0'; setTime(0); }
    playBtn.textContent = 'Pause';
    playBtn.setAttribute('aria-label', 'Pause timeline');
    playing = setInterval(() => {
      const next = Number(slider.value) + 1;
      slider.value = String(next);
      setTime(next);
      if (next >= timeline.max) stopPlay();
    }, 650);
  }
  function stopPlay() {
    if (!playing) return;
    clearInterval(playing);
    playing = 0;
    playBtn.textContent = 'Play';
    playBtn.setAttribute('aria-label', 'Play timeline');
  }

  // ------------------------------------------------------------- tour
  const caption = document.createElement('aside');
  caption.className = 'tour';
  caption.hidden = true;
  caption.setAttribute('aria-live', 'polite');
  const tourTitle = document.createElement('h2');
  tourTitle.className = 'tour-title';
  const tourText = document.createElement('p');
  tourText.className = 'tour-text';
  const tourMeta = document.createElement('p');
  tourMeta.className = 'tour-meta';
  const tourBtns = document.createElement('p');
  tourBtns.className = 'tour-actions';
  const mk = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'tool'; b.textContent = label; b.addEventListener('click', fn); return b; };
  tourBtns.append(mk('Previous', () => tourGo(-1)), mk('Next', () => tourGo(1)), mk('Stop', () => stopTour()));
  caption.append(tourTitle, tourText, tourMeta, tourBtns);
  root.append(caption);
  let tourTimer = 0;

  function toggleTour() { if (tour) stopTour(); else startTour(); }
  function startTour() {
    const steps = tourSteps(model, topicById, (n) => !isHidden(n.id));
    if (!steps.length) return;
    select(null);
    tour = { steps, index: -1 };
    tourBtn.setAttribute('aria-pressed', 'true');
    engine?.setBusy(true);
    caption.hidden = false;
    root.classList.add('is-touring');
    tourGo(1);
  }
  function tourGo(delta) {
    if (!tour) return;
    tour.index = stepIndex(tour.index < 0 ? -1 : tour.index, delta, tour.steps.length);
    const s = tour.steps[tour.index];
    tourTitle.textContent = s.title;
    tourText.textContent = s.text;
    tourMeta.textContent = `Stop ${tour.index + 1} of ${tour.steps.length}${s.count ? ` \u00B7 ${s.count} ${s.count === 1 ? 'POV' : 'POVs'}` : ''}`;
    if (s.id) engine?.focusOn(s.id); else engine?.frame();
    clearTimeout(tourTimer);
    if (!picked.reduced && tour.index < tour.steps.length - 1) tourTimer = setTimeout(() => tourGo(1), 6500);
  }
  function stopTour() {
    clearTimeout(tourTimer);
    tour = null;
    tourBtn.setAttribute('aria-pressed', 'false');
    caption.hidden = true;
    root.classList.remove('is-touring');
    engine?.setBusy(false);
  }

  // ------------------------------------------------------------- start the engine
  async function start(tier) {
    const { createEngine } = await import('./graph-engine.js');
    const hooks = {
      reduced: picked.reduced,
      onSelect: (id) => { if (tour) stopTour(); select(id, { hop: Boolean(id) && Boolean(state.selected) }); },
      onInteract: () => { if (tour) stopTour(); },
      onLost: () => { engine?.destroy(); engine = null; startLite(); },
    };
    async function startLite() {
      try {
        const { createPainter2D } = await import('./graph2d.js');
        mount(createEngine(stage, model, createPainter2D, hooks));
      } catch (err) {
        console.warn('POV Exchange: the graph could not start, showing the list.', err);
        root.dataset.tier = 'static';
        root.classList.add('is-static');
      }
    }
    if (tier === 'full') {
      try {
        const { createPainter3D } = await import('./graph3d.js');
        mount(createEngine(stage, model, createPainter3D, hooks));
        return;
      } catch (err) {
        console.warn('POV Exchange: 3D is not available, using the 2D graph.', err);
      }
    }
    await startLite();
  }
  function mount(e) {
    engine = e;
    root.dataset.tier = e.kind;
    e.canvas.tabIndex = -1;
    stage.tabIndex = 0;
    stage.setAttribute('role', 'application');
    stage.setAttribute('aria-label', 'Knowledge graph. Drag to turn, scroll to zoom, arrow keys to turn, plus and minus to zoom, F to fit, 0 to reset.');
    refresh({ frame: true });
    engine.setSelected(state.selected, { fly: true });
    if (state.selected) engine.setInsets(readerInsets());
    // Fade the canvas in once it has drawn a frame. A timer is the fallback for a browser that is
    // holding animation frames back (an unfocused window), so the poster never lingers over a live graph.
    const goLive = () => stage.classList.add('live');
    requestAnimationFrame(() => requestAnimationFrame(goLive));
    setTimeout(goLive, 600);
  }

  // ------------------------------------------------------------- reveal the controls, then read the URL
  searchBox.hidden = false;
  chipList.hidden = false;
  tools.hidden = false;
  legend.hidden = false;
  help.hidden = false;
  legend.querySelector('.lg-draft').hidden = !hasDrafts;
  sampleLabel.hidden = !hasSamples;
  draftLabel.hidden = !hasDrafts;
  termLabel.hidden = !hasTerms;
  buildChips();
  setTimeout(() => { help.classList.add('fade'); }, 7000);

  function fromHash({ initial = false } = {}) {
    const p = readHashParams();
    const t = p.get('t') ?? '';
    state.topic = topicById.has(t) ? t : '';
    state.q = (p.get('q') ?? '').slice(0, MAX_QUERY);
    input.value = state.q;
    Object.assign(state, prefsFromParams(p));
    state.terms = p.get('terms') === '1' && hasTerms;
    sampleSwitch.checked = state.samples;
    draftSwitch.checked = state.drafts;
    termSwitch.checked = state.terms;
    legend.querySelector('.lg-term').hidden = !state.terms;
    rebuildTimeline();
    refresh({ frame: initial || true });
    const n = p.get('n');
    select(n && model.byId.has(n) ? n : null, { fromUrl: true });
  }
  window.addEventListener('popstate', () => fromHash());
  window.addEventListener('keydown', (ev) => {
    if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const typing = ev.target instanceof Element && ev.target.closest('input, textarea, select');
    if (ev.key === 'Escape' && !typing) {
      if (tour) stopTour();
      else if (state.selected) select(null);
    } else if (ev.key === '/' && !typing) {
      ev.preventDefault();
      input.focus();
      input.select();
    }
  });
  document.addEventListener('fullscreenchange', () => engine?.resize());

  fromHash({ initial: true });
  try {
    await start(picked.tier);
  } catch (err) {
    console.warn('POV Exchange: the graph could not start.', err);
    root.dataset.tier = 'static';
    root.classList.add('is-static');
  }
}
