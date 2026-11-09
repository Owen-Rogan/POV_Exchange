// The graph engine: owns the camera, the input, the label choice and the frame
// loop. It does not draw. A "painter" (graph3d.js with WebGL, or graph2d.js on
// a 2D canvas) draws whatever the engine hands it each frame, so both tiers
// behave identically and share every control.
//
// Positions come from the build (graph.json); nothing is simulated here.

import {
  HOME, basis, boundsOf, fitDistance, flyTo, makeCamera, panBy, project, rotateBy, stepCamera, zoomAt,
} from './camera.js';
import { bindControls } from './controls.js';
import {
  clamp, computeTargets, createLabelLayer, createTip, damp, diameter, edgeReveal, introDelays, labelBox, nearest, nodePixels, readPalette,
} from './graph-common.js';
import { neighbourSet } from './graph-data.js';
import { chooseLabels } from './labels.js';
import { isDark, onTheme } from './theme.js';

const BLOOM = 1.1; // seconds for one node to grow out of the centre
const IDLE_BEFORE_DRIFT = 3.5; // seconds without input before the slow turn starts

/**
 * @param {HTMLElement} stage
 * @param {object} model         from withIndex()
 * @param {(stage, model, opts)=>object} makePainter
 * @param {{reduced?:boolean, onSelect?:(id:string|null)=>void, onHover?:(id:string|null)=>void,
 *          onLost?:()=>void, onInteract?:()=>void}} hooks
 */
export function createEngine(stage, model, makePainter, hooks = {}) {
  const reduced = Boolean(hooks.reduced);
  const N = model.nodes.length;
  const E = model.edges.length;
  const painter = makePainter(stage, model, { reduced, onLost: () => hooks.onLost?.() });
  const cam = makeCamera();
  const view = { width: 1, height: 1, shiftX: 0, shiftY: 0, insetX: 0, insetY: 0 };
  const shiftGoal = { x: 0, y: 0 };

  const sizes = Float32Array.from(model.nodes, diameter);
  const delays = introDelays(model);
  const pulse = model.newest ? (model.index.get(`p:${model.newest}`) ?? -1) : -1;
  const edgeEnds = model.edges.map((e) => [model.index.get(e.s), model.index.get(e.t)]);
  const boxes = model.nodes.map((n) => labelBox(n.kind, n.label));

  const state = { hover: null, selected: null, focus: null };
  const nodeLight = new Float32Array(N);
  const nodeShow = new Float32Array(N).fill(1);
  const showGoal = new Float32Array(N).fill(1);
  const edgeLight = new Float32Array(E);
  const edgeShow = new Float32Array(E).fill(1);
  const edgeReveal0 = edgeReveal(model, null);
  const edgeRevealNow = new Float32Array(E); // eased 0..1, so a revealed line fades in and out
  edgeRevealNow.set(edgeReveal0);
  let reveal = edgeReveal0;
  let targets = computeTargets(model, state);
  let targetsDirty = true;

  const screen = model.nodes.map((n, i) => ({ id: n.id, i, x: -999, y: -999, r: 0, depth: 0, ppu: 1, e: 0, ok: false, a: 0 }));
  const tmp = {};
  const tip = createTip(stage);
  const labels = createLabelLayer(stage, model);

  let clock = reduced ? 99 : 0; // intro clock: nodes bloom while it is below ~3
  let time = 0; // always runs; idle detection
  let idleSince = 0;
  let busy = false; // a tour or similar is driving the camera
  let baseDist = 260;
  let started = false;
  let hoverIndex = -1;

  // ---- theme
  const applyTheme = () => painter.setTheme(readPalette(), isDark());
  applyTheme();
  const offTheme = onTheme(applyTheme);

  // ---- helpers
  const go = (goal, instant = false) => { flyTo(cam, goal, instant || reduced); idleSince = time; };
  const visibleNodes = () => {
    const out = [];
    for (let i = 0; i < N; i++) if (showGoal[i] > 0.5) out.push(model.nodes[i]);
    return out;
  };
  function frameGoal() {
    const b = boundsOf(visibleNodes());
    return { tx: b.cx, ty: b.cy, tz: b.cz, dist: fitDistance(b.radius, view) };
  }
  function recomputeBase() {
    const b = boundsOf(visibleNodes());
    baseDist = fitDistance(b.radius, { width: view.width, height: view.height });
    cam.maxDist = Math.max(baseDist * 2.6, 120);
  }

  // ---- sizing
  function resize() {
    const r = stage.getBoundingClientRect();
    view.width = Math.max(1, Math.round(r.width));
    view.height = Math.max(1, Math.round(r.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    painter.resize(view.width, view.height, dpr);
    recomputeBase();
    if (!started) {
      started = true;
      const g = frameGoal();
      cam.tx = g.tx; cam.ty = g.ty; cam.tz = g.tz;
      cam.dist = reduced ? g.dist : g.dist * 1.8;
      if (!reduced) go({ dist: g.dist });
    }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();

  // ---- state setters
  function focusOn(id) {
    const i = model.index.get(id);
    if (i === undefined) return;
    const n = model.nodes[i];
    let reach = 24;
    for (const other of neighbourSet(model, id)) {
      const j = model.index.get(other);
      if (j === undefined || showGoal[j] < 0.5) continue;
      const o = model.nodes[j];
      reach = Math.max(reach, Math.hypot(o.x - n.x, o.y - n.y, o.z - n.z));
    }
    go({ tx: n.x, ty: n.y, tz: n.z, dist: clamp(fitDistance(reach + 10, view), 36, baseDist) });
  }
  function setSelected(id, { fly = true } = {}) {
    state.selected = id && model.index.has(id) ? id : null;
    targetsDirty = true;
    if (state.selected && fly) focusOn(state.selected);
  }
  function setHover(id) {
    if (state.hover === id) return;
    state.hover = id;
    hoverIndex = id ? (model.index.get(id) ?? -1) : -1;
    targetsDirty = true;
    stage.classList.toggle('over', Boolean(id));
  }
  function setFocus(set) { state.focus = set; targetsDirty = true; }
  function setVisible(mask, { frame = false } = {}) {
    for (let i = 0; i < N; i++) showGoal[i] = mask ? mask[i] : 1;
    if (state.hover && showGoal[model.index.get(state.hover)] < 0.5) setHover(null);
    recomputeBase();
    if (frame) go(frameGoal());
  }
  /** Pixels taken by panels. The centre of attention moves to the middle of what is left clear. */
  function setInsets({ left = 0, right = 0, bottom = 0 } = {}) {
    view.insetX = left + right;
    view.insetY = bottom;
    shiftGoal.x = (left - right) / 2;
    shiftGoal.y = -bottom / 2;
    if (reduced) { view.shiftX = shiftGoal.x; view.shiftY = shiftGoal.y; }
  }
  function flyToNodes(ids) {
    const pts = ids.map((id) => model.byId.get(id)).filter(Boolean);
    if (!pts.length) return;
    const b = boundsOf(pts);
    go({ tx: b.cx, ty: b.cy, tz: b.cz, dist: clamp(fitDistance(b.radius + 8, view), 36, baseDist) });
  }
  const frameAll = (instant = false) => go(frameGoal(), instant);
  const resetView = (instant = false) => go({ yaw: HOME.yaw, pitch: HOME.pitch, ...frameGoal() }, instant);

  // ---- input
  const pick = (x, y) => nearest(screen, x, y, 8);
  const unbind = bindControls(stage, {
    pick,
    rotate: (dx, dy) => rotateBy(cam, -dx * 0.006, dy * 0.005),
    pan: (dx, dy) => panBy(cam, view, dx, dy),
    zoomAt: (factor, x, y) => zoomAt(cam, view, factor, x ?? view.width / 2 + view.shiftX, y ?? view.height / 2 + view.shiftY),
    hover(id, x, y) {
      setHover(id);
      hooks.onHover?.(id);
      if (id) tip.show(model.byId.get(id).label, x, y); else tip.hide();
    },
    select: (id) => hooks.onSelect?.(id),
    focusNode: (id) => { hooks.onSelect?.(id); },
    reset: () => resetView(),
    frame: () => frameAll(),
    dragMode: () => hooks.dragMode?.() ?? 'turn',
    interact() { idleSince = time; hooks.onInteract?.(); },
  });

  // ---- the frame
  const f = {
    cam, view, basis: null, clock: 0, time: 0, pulse, sizes, delays, screen,
    nodeLight, nodeShow, edgeLight, edgeShow, edgeEnds, reduced,
  };
  let raf = 0;
  let last = 0;
  let visible = true;
  let destroyed = false;

  function frame(now) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    clock += dt;
    time += dt;

    // brightness and visibility ease toward their targets
    if (targetsDirty) { targets = computeTargets(model, state); reveal = edgeReveal(model, targets.active); targetsDirty = false; }
    const k = damp(9, dt);
    const ks = damp(reduced ? 60 : 5, dt);
    for (let i = 0; i < N; i++) {
      let d = targets.nodes[i] - nodeLight[i];
      nodeLight[i] += Math.abs(d) < 0.002 ? d : d * k;
      d = showGoal[i] - nodeShow[i];
      nodeShow[i] += Math.abs(d) < 0.003 ? d : d * ks;
    }
    for (let i = 0; i < E; i++) {
      const d = targets.edges[i] - edgeLight[i];
      edgeLight[i] += Math.abs(d) < 0.002 ? d : d * k;
      const [a, b] = edgeEnds[i];
      const r = reveal[i] - edgeRevealNow[i];
      edgeRevealNow[i] += Math.abs(r) < 0.003 ? r : r * k;
      edgeShow[i] = Math.min(nodeShow[a], nodeShow[b]) * edgeRevealNow[i];
    }

    // camera: fly-to, slow turn when idle, panel offset
    stepCamera(cam, dt);
    if (!reduced && !busy && !cam.goal && !state.selected && !state.hover && time - idleSince > IDLE_BEFORE_DRIFT) cam.yaw -= dt * 0.045;
    const ke = damp(6, dt);
    view.shiftX += (shiftGoal.x - view.shiftX) * ke;
    view.shiftY += (shiftGoal.y - view.shiftY) * ke;

    // where every node is on screen
    const b = basis(cam);
    f.basis = b;
    f.clock = clock;
    f.time = time;
    for (let i = 0; i < N; i++) {
      const n = model.nodes[i];
      const t = clamp((clock - delays[i]) / BLOOM, 0, 1);
      const e = 1 - (1 - t) * (1 - t) * (1 - t);
      project(cam, view, n.x * e, n.y * e, n.z * e, b, tmp);
      const s = screen[i];
      const show = nodeShow[i];
      s.x = tmp.x; s.y = tmp.y; s.depth = tmp.depth; s.ppu = tmp.ppu; s.e = e;
      s.r = Math.max((nodePixels(sizes[i], tmp.ppu) * e * show) / 2, 3);
      s.ok = e > 0.6 && show > 0.5 && tmp.depth > 4;
      s.a = e * show * (nodeLight[i] < -0.5 ? 0.12 : 1);
    }

    placeLabels();
    painter.draw(f);
  }

  const items = [];
  function placeLabels() {
    items.length = 0;
    let povCount = 0;
    for (let i = 0; i < N; i++) {
      const n = model.nodes[i];
      const s = screen[i];
      if (n.kind === 'pov' && s.a > 0.5) povCount += 1;
      if (s.a < 0.15 || s.x < -80 || s.x > view.width + 80 || s.y < -40 || s.y > view.height + 40) continue;
      items.push({ i, kind: n.kind, x: s.x, y: s.y, r: s.r, a: s.a, w: boxes[i].w, h: boxes[i].h, weight: n.n ?? 0 });
    }
    const active = state.hover ?? state.selected;
    const near = new Set();
    if (active) for (const id of neighbourSet(model, active)) near.add(model.index.get(id));
    const zoom = baseDist / cam.dist;
    labels.place(chooseLabels(items, {
      selected: state.selected ? model.index.get(state.selected) : -1,
      hover: hoverIndex,
      near,
      zoom,
      showPovs: povCount <= 18 || zoom >= 1.6,
      limit: 45,
      bounds: { w: view.width, h: view.height },
    }));
  }

  function run() {
    if (raf || destroyed || !visible || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  const io = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible) run(); else stop();
  });
  io.observe(stage);
  const onVisibility = () => (document.hidden ? stop() : run());
  document.addEventListener('visibilitychange', onVisibility);
  run();

  return {
    kind: painter.kind,
    canvas: painter.canvas,
    setSelected, setHover, setFocus, setVisible, setInsets, flyToNodes, focusOn,
    frame: frameAll,
    reset: resetView,
    zoomBy(factor) {
      zoomAt(cam, view, factor, view.width / 2 + view.shiftX, view.height / 2 + view.shiftY);
      idleSince = time;
    },
    setBusy(on) { busy = Boolean(on); if (!on) idleSince = time; },
    resize,
    destroy() {
      destroyed = true;
      stop();
      unbind();
      io.disconnect();
      ro.disconnect();
      offTheme();
      document.removeEventListener('visibilitychange', onVisibility);
      tip.remove();
      labels.remove();
      painter.destroy();
    },
  };
}
