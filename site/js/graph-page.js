// The Graph page: starts the engine at the right tier and connects it to the
// toolbar, the side browser (search, switches, topics and POVs), the movement
// buttons, the timeline, the guided tour, the reader panel and the URL.
//
// URL hash (kept in step as you explore, so every view can be shared):
//   #n=p:some-slug     the selected node         #t=agents   select that topic
//   #q=text            search                     #samples=0  samples hidden
//   #drafts=1          drafts shown               #terms=1    glossary terms shown
// Selecting a node adds a history entry, so Back steps through your hops.
//
// Two panels can sit beside the graph: the browser on the left and the reader on
// the right. Below 1200px wide only one is open at a time, and on a phone they
// are bottom sheets.

import { browseTree } from './browse-model.js';
import { createBrowser } from './browse.js';
import { applyFilters, focusSet } from './graph-filter.js';
import { withIndex } from './graph-data.js';
import { paramsFromPrefs, prefsFromParams, readHashParams, savePref } from './prefs.js';
import { createReader } from './reader.js';
import { distinctDates, makeTimeline, prettyDate } from './timeline.js';
import { pickTier } from './tier.js';
import { stepIndex, tourSteps } from './tour.js';

const MAX_QUERY = 100;
const BROWSE_WIDTH = 300; // keep in step with .browse in styles.css
const GAP = 12; // the space between a panel and the edge of the graph
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

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
  const browsePanel = $('#browse');
  const browseBtn = $('[data-act="browse"]');
  const nav = $('.gp-nav');
  const input = $('#g-q');
  const plain = document.querySelector('#plain');
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
  const state = { q: '', ...prefsFromParams(new URLSearchParams()), terms: false, until: null, selected: null, browse: false, drag: 'turn' };
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
      q: state.q, topic: '', samples: state.samples, drafts: state.drafts, terms: state.terms, until: state.until,
    });
    if (engine) {
      engine.setVisible(result.visible, { frame });
      engine.setFocus(focusSet(model, result));
    }
    const tree = browseTree(model, povBySlug, data.topics, topicById, result);
    count.textContent = result.active ? `${tree.shown} of ${plural(tree.total, 'POV', 'POVs')}` : plural(tree.total, 'POV', 'POVs');
    browser.render(tree, result.active
      ? (tree.shown ? `${tree.shown} of ${plural(tree.total, 'POV', 'POVs')} match` : 'No POVs match')
      : 'Pick a topic to see its POVs, or search.');
    browser.setCurrent(state.selected, { reveal: false });
    if (state.selected && isHidden(state.selected)) select(null);
  }

  // ------------------------------------------------------------- selection
  function select(id, { hop = false, back = false, fromUrl = false } = {}) {
    if (id && (!model.byId.has(id) || isHidden(id))) id = null;
    if (hop && state.selected && state.selected !== id) history.push(state.selected);
    if (!hop && !back) history.length = 0;
    const changed = state.selected !== id;
    state.selected = id;
    engine?.setSelected(id);
    browser.setCurrent(id);
    if (!id) {
      reader.hide();
    } else {
      // Below 1200px there is room for one panel: the reader takes over from the browser.
      if (!roomForBoth() && state.browse) setBrowse(false, { quiet: true });
      reader.show(id, { moveFocus: !fromUrl, canGoBack: history.length > 0 });
    }
    root.classList.toggle('has-reader', Boolean(id));
    applyInsets();
    if (!fromUrl && changed) writeHash({ push: Boolean(id) });
  }

  // ------------------------------------------------------------- panels
  const roomForBoth = () => window.matchMedia('(min-width: 1200px)').matches;
  const isPhone = () => !window.matchMedia('(min-width: 900px)').matches;

  /** Tell the camera how much of the graph the open panels cover, so what you pick stays in the clear middle. */
  function applyInsets() {
    if (!engine) return;
    if (isPhone()) {
      const sheet = state.selected || state.browse;
      engine.setInsets(sheet ? { bottom: Math.round(window.innerHeight * 0.46) } : {});
      return;
    }
    engine.setInsets({
      left: state.browse ? BROWSE_WIDTH + GAP : 0,
      right: state.selected ? Math.min(440, window.innerWidth * 0.4) + GAP : 0,
    });
  }

  function setBrowse(open, { quiet = false, focus = false } = {}) {
    state.browse = open;
    browsePanel.hidden = !open;
    root.classList.toggle('has-browse', open);
    browseBtn.setAttribute('aria-expanded', String(open));
    browseBtn.setAttribute('aria-pressed', String(open));
    if (open && !roomForBoth() && state.selected && !quiet) select(null); // one panel at a time
    // Focus the search box where there is a keyboard to type on. On a phone that would raise the on-screen
    // keyboard over the list, so focus the list itself instead (keyboard and screen-reader users still land in it).
    if (open && focus) (isPhone() ? browsePanel.querySelector('.browse-body') : input).focus({ preventScroll: true });
    applyInsets();
  }
  browseBtn.addEventListener('click', () => setBrowse(!state.browse, { focus: true }));
  browsePanel.querySelector('.browse-close').addEventListener('click', () => { setBrowse(false); browseBtn.focus(); });

  const browser = createBrowser(browsePanel, {
    model, povBySlug,
    onPick: (id) => {
      if (tour) stopTour();
      if (id === state.selected) { engine?.focusOn(id); return; }
      select(id, { hop: Boolean(state.selected) });
    },
    onHover: (id) => engine?.setHover(id && model.byId.has(id) && !isHidden(id) ? id : null),
  });

  // ------------------------------------------------------------- controls
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
    if (ev.key === 'Escape') { if (input.value) { input.value = ''; state.q = ''; writeHash(); refresh({ frame: true }); } else { input.blur(); stage.focus(); } }
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
    syncPlainList();
  };
  for (const s of [sampleSwitch, draftSwitch, termSwitch]) s.addEventListener('change', onSwitch);

  /** The plain list at the foot of the page follows the same two switches (the way the Library does). */
  function syncPlainList() {
    if (!plain) return;
    const eligible = (e) => (state.samples || e.dataset.sample !== '1') && (state.drafts || e.dataset.status !== 'draft');
    for (const row of plain.querySelectorAll('.row')) row.hidden = !eligible(row);
    for (const g of plain.querySelectorAll('.pl-topic')) {
      const rows = [...g.querySelectorAll('.row')];
      const live = rows.filter((r) => !r.hidden).length;
      g.hidden = (g.dataset.sample === '1' && !state.samples) || (rows.length > 0 && live === 0);
      const c = g.querySelector('summary .count-s');
      if (c && !g.classList.contains('pl-terms')) c.textContent = plural(live, 'POV', 'POVs');
    }
    const termGroup = plain.querySelector('.pl-terms');
    if (termGroup) termGroup.hidden = !state.terms || termGroup.querySelectorAll('.row:not([hidden])').length === 0;
  }

  tools.addEventListener('click', (ev) => {
    const b = ev.target instanceof Element ? ev.target.closest('[data-act]') : null;
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'tour') toggleTour();
    else if (act === 'fullscreen') toggleFullscreen();
  });

  // Zoom in and out, back to the whole graph, what a drag does, and the how-to hint.
  nav.addEventListener('click', (ev) => {
    const b = ev.target instanceof Element ? ev.target.closest('[data-act], [data-mode]') : null;
    if (!b) return;
    if (b.dataset.mode) { setDragMode(b.dataset.mode); return; }
    const act = b.dataset.act;
    if (tour) stopTour();
    if (act === 'zoom-in') engine?.zoomBy(0.8);
    else if (act === 'zoom-out') engine?.zoomBy(1.25);
    else if (act === 'home') { select(null); engine?.reset(); }
    else if (act === 'help') toggleHelp();
  });
  function setDragMode(mode) {
    state.drag = mode === 'move' ? 'move' : 'turn';
    for (const b of nav.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === state.drag));
    stage.classList.toggle('mode-move', state.drag === 'move');
  }
  function toggleHelp() {
    const on = help.hidden || help.classList.contains('fade');
    help.hidden = false;
    help.classList.toggle('fade', !on);
    nav.querySelector('[data-act="help"]').setAttribute('aria-pressed', String(on));
  }

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
      dragMode: () => state.drag,
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
    e.canvas.removeAttribute('tabindex'); // the stage is the one focus target; the canvas is hidden from assistive technology
    stage.tabIndex = 0;
    stage.setAttribute('role', 'application');
    stage.setAttribute('aria-label', 'Knowledge graph. Drag to turn, scroll to zoom, arrow keys to turn, plus and minus to zoom, F to fit, 0 to reset.');
    applyInsets(); // before the first framing, so the picture centres on the space the panels leave clear
    refresh({ frame: true });
    engine.setSelected(state.selected, { fly: true });
    // Fade the canvas in once it has drawn a frame. A timer is the fallback for a browser that is
    // holding animation frames back (an unfocused window), so the poster never lingers over a live graph.
    const goLive = () => stage.classList.add('live');
    requestAnimationFrame(() => requestAnimationFrame(goLive));
    setTimeout(goLive, 600);
  }

  // ------------------------------------------------------------- reveal the controls, then read the URL
  browseBtn.hidden = false;
  tools.hidden = false;
  nav.hidden = false;
  legend.hidden = false;
  help.hidden = false;
  legend.querySelector('.lg-draft').hidden = !hasDrafts;
  sampleLabel.hidden = !hasSamples;
  draftLabel.hidden = !hasDrafts;
  termLabel.hidden = !hasTerms;
  setBrowse(roomForBoth() && !isPhone(), { quiet: true }); // open by default where there is room
  setTimeout(() => { help.classList.add('fade'); nav.querySelector('[data-act="help"]').setAttribute('aria-pressed', 'false'); }, 7000);
  nav.querySelector('[data-act="help"]').setAttribute('aria-pressed', 'true');

  function fromHash({ initial = false } = {}) {
    const p = readHashParams();
    state.q = (p.get('q') ?? '').slice(0, MAX_QUERY);
    input.value = state.q;
    Object.assign(state, prefsFromParams(p));
    state.terms = p.get('terms') === '1' && hasTerms;
    sampleSwitch.checked = state.samples;
    draftSwitch.checked = state.drafts;
    termSwitch.checked = state.terms;
    legend.querySelector('.lg-term').hidden = !state.terms;
    rebuildTimeline();
    syncPlainList();
    refresh({ frame: initial || true });
    // #n= picks a node. A bare #t=agents picks that topic (older links used it as a filter).
    const n = p.get('n');
    const t = p.get('t');
    const wanted = n && model.byId.has(n) ? n : (t && model.byId.has(`t:${t}`) ? `t:${t}` : null);
    select(wanted, { fromUrl: true });
  }
  window.addEventListener('popstate', () => fromHash());
  window.addEventListener('resize', () => {
    // Crossing below 1200px with both panels open: keep the one you were last using (the reader).
    if (!roomForBoth() && state.browse && state.selected) setBrowse(false, { quiet: true });
    applyInsets();
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const typing = ev.target instanceof Element && ev.target.closest('input, textarea, select');
    if (ev.key === 'Escape' && !typing) {
      if (tour) stopTour();
      else if (state.selected) select(null);
      else if (state.browse && !roomForBoth()) setBrowse(false);
    } else if (ev.key === '/' && !typing) {
      ev.preventDefault();
      if (!state.browse) setBrowse(true);
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
