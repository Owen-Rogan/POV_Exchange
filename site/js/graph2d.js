// The lite tier: the same graph on a 2D canvas, for devices without WebGL or
// with little power. Same precomputed positions, same bloom-in, same hover and
// click behaviour, with simpler motion (a slow turn, no glow shaders).

import {
  clamp, computeTargets, createLabels, createTip, damp, diameter, introDelays,
  layoutShift, nearest, readPalette,
} from './graph-common.js';
import { isDark, onTheme } from './theme.js';

const BLOOM = 1.1;
const RADIUS = 108;
const CAM = 320;

export function create2D(stage, model, { onHover, onSelect, onLost }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  stage.prepend(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); throw new Error('no 2d context'); }

  const N = model.nodes.length;
  const E = model.edges.length;
  const index = new Map(model.nodes.map((n, i) => [n.id, i]));
  const delays = introDelays(model);
  const pulseId = model.newest ? `p:${model.newest}` : null;

  let palette = readPalette();
  let dark = isDark();
  const offTheme = onTheme((d) => { dark = d; palette = readPalette(); });

  const state = { hover: null, selected: null, focus: null };
  let targets = computeTargets(model, state);
  let targetsDirty = true;
  const nodeCur = new Float32Array(N);
  const edgeCur = new Float32Array(E);

  let width = 1, height = 1, dpr = 1, scale = 1, shift = { dx: 0, dy: 0 };
  let yaw = 0.35, pitch = 0.18, following = false, yawT = 0, pitchT = 0;
  let px = 0, py = 0, pxT = 0, pyT = 0;
  let zoom = 1, clock = 0, idleSince = 0, dragging = null;
  const screen = model.nodes.map((n) => ({ id: n.id, x: -999, y: -999, r: 0, a: 0, ok: false, z: 0 }));

  const tip = createTip(stage);
  const labels = createLabels(stage, model);

  function resize() {
    const r = stage.getBoundingClientRect();
    width = Math.max(1, Math.round(r.width));
    height = Math.max(1, Math.round(r.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    shift = layoutShift(width, height);
    const avail = Math.max(60, Math.min(width / 2 - Math.abs(shift.dx), height / 2 - Math.abs(shift.dy)) * 0.92);
    scale = avail / RADIUS;
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  function setSelected(id) {
    state.selected = id;
    targetsDirty = true;
    if (id) {
      const n = model.nodes[index.get(id)];
      yawT = Math.atan2(-n.x, n.z);
      const zz = -n.x * Math.sin(yawT) + n.z * Math.cos(yawT);
      pitchT = clamp(Math.atan2(n.y, zz), -0.9, 0.9);
      following = true;
    } else {
      following = false;
    }
  }
  function setHover(id) { if (state.hover !== id) { state.hover = id; targetsDirty = true; } }
  function setFocus(set) { state.focus = set; targetsDirty = true; }

  const hit = (x, y) => nearest(screen, x, y, 8);
  const local = (ev) => { const r = stage.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };

  canvas.style.touchAction = 'pan-y';
  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointermove', (ev) => {
    const { x, y } = local(ev);
    pxT = clamp((x / width) * 2 - 1, -1, 1);
    pyT = clamp((y / height) * 2 - 1, -1, 1);
    if (dragging) {
      if (Math.abs(ev.clientX - dragging.x) + Math.abs(ev.clientY - dragging.y) > 4) dragging.moved = true;
      if (dragging.moved) {
        yaw += (ev.clientX - dragging.lx) * 0.006;
        if (ev.pointerType === 'mouse') pitch = clamp(pitch + (ev.clientY - dragging.ly) * 0.005, -1.1, 1.1);
        following = false;
        idleSince = clock;
      }
      dragging.lx = ev.clientX; dragging.ly = ev.clientY;
      return;
    }
    if (ev.pointerType !== 'mouse') return;
    const id = hit(x, y);
    setHover(id);
    onHover(id);
    canvas.style.cursor = id ? 'pointer' : 'grab';
    if (id) tip.show(model.byId.get(id).label, x, y); else tip.hide();
  });
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    dragging = { x: ev.clientX, y: ev.clientY, lx: ev.clientX, ly: ev.clientY, moved: false };
    try { canvas.setPointerCapture(ev.pointerId); } catch { /* not an active pointer: dragging still works without capture */ }
  });
  canvas.addEventListener('pointerup', (ev) => {
    const d = dragging;
    dragging = null;
    try { canvas.releasePointerCapture(ev.pointerId); } catch { /* nothing to release */ }
    if (!d || d.moved) return;
    const { x, y } = local(ev);
    onSelect(hit(x, y));
  });
  canvas.addEventListener('pointercancel', () => { dragging = null; });
  canvas.addEventListener('pointerleave', () => {
    if (dragging) return;
    setHover(null); onHover(null); tip.hide(); pxT = 0; pyT = 0;
  });

  function rgba(hex, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return `rgba(128,128,128,${a})`;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  let raf = 0, last = 0, visible = true, destroyed = false;

  function frame(now) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    clock += dt;

    if (targetsDirty) { targets = computeTargets(model, state); targetsDirty = false; }
    const k = damp(9, dt);
    for (let i = 0; i < N; i++) { const d = targets.nodes[i] - nodeCur[i]; nodeCur[i] += Math.abs(d) < 0.002 ? d : d * k; }
    for (let i = 0; i < E; i++) { const d = targets.edges[i] - edgeCur[i]; edgeCur[i] += Math.abs(d) < 0.002 ? d : d * k; }

    if (following) {
      const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
      yaw += wrap(yawT - yaw) * damp(3.2, dt);
      pitch += (pitchT - pitch) * damp(3.2, dt);
    } else if (!dragging && !state.hover && clock - idleSince > 2.5) {
      yaw += dt * 0.04;
      pitch += (0.18 - pitch) * damp(0.6, dt);
    }
    zoom += ((state.selected ? 1.25 : 1) - zoom) * damp(3, dt);
    px += (pxT - px) * damp(2.5, dt);
    py += (pyT - py) * damp(2.5, dt);

    const ya = yaw + px * 0.1, pa = pitch + py * 0.04;
    const cy = Math.cos(ya), sy = Math.sin(ya), cp = Math.cos(pa), sp = Math.sin(pa);
    const cx = width / 2 + shift.dx, cyy = height / 2 + shift.dy;
    for (let i = 0; i < N; i++) {
      const n = model.nodes[i];
      const t = clamp((clock - delays[i]) / BLOOM, 0, 1);
      const e = 1 - Math.pow(1 - t, 3);
      const x1 = (n.x * cy + n.z * sy) * e;
      const z1 = (-n.x * sy + n.z * cy) * e;
      const y2 = n.y * e * cp - z1 * sp;
      const z2 = n.y * e * sp + z1 * cp;
      const persp = CAM / (CAM - z2);
      const s = screen[i];
      s.x = cx + x1 * persp * scale * zoom;
      s.y = cyy - y2 * persp * scale * zoom;
      s.z = z2;
      s.r = (diameter(n) / 2) * persp * scale * zoom * 0.62 * e;
      s.ok = e > 0.6;
      s.a = e * (nodeCur[i] < -0.5 ? 0.3 : 1);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.lineWidth = 1;
    for (let i = 0; i < E; i++) {
      const e = model.edges[i];
      const a = screen[index.get(e.s)], b = screen[index.get(e.t)];
      const vis = Math.min(a.a, b.a);
      if (vis < 0.02) continue;
      const light = edgeCur[i];
      let alpha = (dark ? 0.3 : 0.38) * vis;
      if (light > 0) alpha = alpha + (0.85 - alpha) * light;
      else if (light < 0) alpha *= 1 - 0.9 * -light;
      ctx.strokeStyle = rgba(light > 0.4 ? palette.lit : palette.edge, alpha);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    const order = screen.map((_, i) => i).sort((p, q) => screen[p].z - screen[q].z);
    for (const i of order) {
      const n = model.nodes[i];
      const s = screen[i];
      if (s.a < 0.02) continue;
      const light = nodeCur[i];
      const dim = light < 0 ? 1 - 0.84 * -light : 1;
      let r = s.r;
      if (n.id === pulseId) r *= 1 + 0.18 * (0.5 + 0.5 * Math.sin(clock * 3.2));
      if (light > 0) r *= 1 + light * 0.2;
      const col = palette[n.kind];
      if (dark && dim > 0.5) {
        const g = ctx.createRadialGradient(s.x, s.y, r * 0.4, s.x, s.y, r * 2.6);
        g.addColorStop(0, rgba(col, 0.38 * dim * s.a));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = rgba(col, dim * s.a);
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(r, 1), 0, Math.PI * 2);
      ctx.fill();
      if (light > 0.3) {
        ctx.strokeStyle = rgba(palette.lit, 0.9 * light);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
    labels.update(screen);
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
    kind: 'lite',
    setSelected,
    setHover,
    setFocus,
    resize,
    destroy() {
      destroyed = true;
      stop();
      io.disconnect();
      ro.disconnect();
      offTheme();
      document.removeEventListener('visibilitychange', onVisibility);
      tip.remove();
      labels.remove();
      canvas.remove();
    },
  };
}
