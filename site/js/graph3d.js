// The full tier: the knowledge graph in WebGL with three.js.
//
// Positions are precomputed at build time (graph.json), so there is no physics
// here. This file only draws, animates the bloom-in and the slow drift, and
// handles hover, click and drag. Nodes are glowing sprites in one draw call and
// edges are one line-segment draw call, so it stays cheap even with hundreds.

import * as THREE from '../vendor/three/three.module.js';
import {
  clamp, computeTargets, createLabels, createTip, damp, diameter, introDelays,
  layoutShift, nearest, parseColor, readPalette,
} from './graph-common.js';
import { isDark, onTheme } from './theme.js';

const FOV = 45;
const BLOOM = 1.1; // seconds for one node to grow out of the centre
const SPRITE = 2.6; // sprite size relative to the visible core, leaves room for the glow
const RADIUS = 108; // layout radius (100) plus node size
const EDGE_WEIGHT = { parent: 0.9, link: 0.75, related: 1, topic: 0.6, doc: 0.5 };

const NODE_VERT = `
attribute float aSize;
attribute vec3 aColor;
attribute float aLight;
attribute float aDelay;
attribute float aPulse;
uniform float uTime;
uniform float uScale;
uniform float uDist;
varying vec3 vColor;
varying float vLight;
varying float vAlpha;
void main() {
  float t = clamp((uTime - aDelay) / ${BLOOM.toFixed(2)}, 0.0, 1.0);
  float e = 1.0 - pow(1.0 - t, 3.0);
  vec4 mv = modelViewMatrix * vec4(position * e, 1.0);
  float pulse = 1.0 + aPulse * 0.28 * (0.5 + 0.5 * sin(uTime * 3.2));
  float lift = 1.0 + max(aLight, 0.0) * 0.3;
  float size = aSize * ${SPRITE.toFixed(2)} * e * pulse * lift * uScale * 300.0 / max(-mv.z, 1.0);
  gl_PointSize = clamp(size, 0.0, 240.0);
  gl_Position = projectionMatrix * mv;
  float near = clamp(1.0 - (-mv.z - uDist + 110.0) / 220.0, 0.0, 1.0);
  vColor = aColor;
  vLight = aLight;
  vAlpha = e * mix(0.55, 1.0, near);
}`;

const NODE_FRAG = `
uniform float uGlow;
varying vec3 vColor;
varying float vLight;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = smoothstep(${(1 / SPRITE + 0.03).toFixed(3)}, ${(1 / SPRITE - 0.04).toFixed(3)}, d);
  float glow = pow(1.0 - d, 3.0) * uGlow;
  float dim = vLight < 0.0 ? mix(1.0, 0.16, -vLight) : 1.0;
  float a = clamp(core + glow * (0.55 + max(vLight, 0.0) * 0.6), 0.0, 1.0) * vAlpha * dim;
  vec3 c = mix(vColor, vec3(1.0), core * 0.3 + max(vLight, 0.0) * 0.35);
  gl_FragColor = vec4(c, a);
}`;

const EDGE_VERT = `
attribute float aDelay;
attribute float aDelay2;
attribute float aLight;
attribute float aWeight;
uniform float uTime;
varying float vA;
varying float vL;
void main() {
  float t = clamp((uTime - aDelay) / ${BLOOM.toFixed(2)}, 0.0, 1.0);
  float t2 = clamp((uTime - aDelay2) / ${BLOOM.toFixed(2)}, 0.0, 1.0);
  float e = 1.0 - pow(1.0 - t, 3.0);
  float e2 = 1.0 - pow(1.0 - t2, 3.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position * e, 1.0);
  vA = e * e2 * aWeight;
  vL = aLight;
}`;

const EDGE_FRAG = `
uniform vec3 uColor;
uniform vec3 uLit;
uniform float uBase;
varying float vA;
varying float vL;
void main() {
  float a = uBase * vA;
  if (vL > 0.0) a = mix(a, 0.9 * vA, vL);
  else if (vL < 0.0) a *= mix(1.0, 0.1, -vL);
  gl_FragColor = vec4(mix(uColor, uLit, max(vL, 0.0)), a);
}`;

/**
 * @param {HTMLElement} stage   positioned element the canvas is added to
 * @param {object} model        from loadGraph()
 * @param {{onHover:(id:string|null)=>void, onSelect:(id:string|null)=>void, onLost:()=>void}} handlers
 */
export function create3D(stage, model, { onHover, onSelect, onLost }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  stage.prepend(canvas);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (err) {
    canvas.remove();
    throw err;
  }
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 2000);
  const group = new THREE.Group();
  group.rotation.order = 'XYZ'; // yaw (Y) is applied before pitch (X)
  scene.add(group);

  const N = model.nodes.length;
  const E = model.edges.length;
  const index = new Map(model.nodes.map((n, i) => [n.id, i]));
  const delays = introDelays(model);
  const pulseId = model.newest ? `p:${model.newest}` : null;

  // ---- nodes
  const nPos = new Float32Array(N * 3);
  const nSize = new Float32Array(N);
  const nColor = new Float32Array(N * 3);
  const nLight = new Float32Array(N);
  const nPulse = new Float32Array(N);
  model.nodes.forEach((n, i) => {
    nPos.set([n.x, n.y, n.z], i * 3);
    nSize[i] = diameter(n);
    nPulse[i] = n.id === pulseId ? 1 : 0;
  });
  const nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute('position', new THREE.BufferAttribute(nPos, 3));
  nodeGeo.setAttribute('aSize', new THREE.BufferAttribute(nSize, 1));
  nodeGeo.setAttribute('aColor', new THREE.BufferAttribute(nColor, 3));
  nodeGeo.setAttribute('aLight', new THREE.BufferAttribute(nLight, 1));
  nodeGeo.setAttribute('aDelay', new THREE.BufferAttribute(Float32Array.from(delays), 1));
  nodeGeo.setAttribute('aPulse', new THREE.BufferAttribute(nPulse, 1));
  const nodeMat = new THREE.ShaderMaterial({
    vertexShader: NODE_VERT,
    fragmentShader: NODE_FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uDist: { value: 250 }, uGlow: { value: 1 } },
  });
  const points = new THREE.Points(nodeGeo, nodeMat);
  points.frustumCulled = false;

  // ---- edges (two vertices each; each vertex knows both ends' delays)
  const ePos = new Float32Array(E * 6);
  const eDelay = new Float32Array(E * 2);
  const eDelay2 = new Float32Array(E * 2);
  const eLight = new Float32Array(E * 2);
  const eWeight = new Float32Array(E * 2);
  model.edges.forEach((e, k) => {
    const a = index.get(e.s), b = index.get(e.t);
    ePos.set([model.nodes[a].x, model.nodes[a].y, model.nodes[a].z, model.nodes[b].x, model.nodes[b].y, model.nodes[b].z], k * 6);
    eDelay[k * 2] = delays[a]; eDelay[k * 2 + 1] = delays[b];
    eDelay2[k * 2] = delays[b]; eDelay2[k * 2 + 1] = delays[a];
    eWeight[k * 2] = eWeight[k * 2 + 1] = EDGE_WEIGHT[e.k] ?? 0.7;
  });
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  edgeGeo.setAttribute('aDelay', new THREE.BufferAttribute(eDelay, 1));
  edgeGeo.setAttribute('aDelay2', new THREE.BufferAttribute(eDelay2, 1));
  edgeGeo.setAttribute('aLight', new THREE.BufferAttribute(eLight, 1));
  edgeGeo.setAttribute('aWeight', new THREE.BufferAttribute(eWeight, 1));
  const edgeMat = new THREE.ShaderMaterial({
    vertexShader: EDGE_VERT,
    fragmentShader: EDGE_FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
      uLit: { value: new THREE.Vector3(1, 1, 1) },
      uBase: { value: 0.3 },
    },
  });
  const lines = new THREE.LineSegments(edgeGeo, edgeMat);
  lines.frustumCulled = false;
  group.add(lines, points);

  // ---- theme
  function applyTheme() {
    const p = readPalette();
    const dark = isDark();
    model.nodes.forEach((n, i) => nColor.set(parseColor(p[n.kind]), i * 3));
    nodeGeo.attributes.aColor.needsUpdate = true;
    edgeMat.uniforms.uColor.value.set(...parseColor(p.edge));
    edgeMat.uniforms.uLit.value.set(...parseColor(p.lit));
    edgeMat.uniforms.uBase.value = dark ? 0.32 : 0.4;
    nodeMat.uniforms.uGlow.value = dark ? 1 : 0.55;
    const blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    nodeMat.blending = edgeMat.blending = blending;
    nodeMat.needsUpdate = edgeMat.needsUpdate = true;
  }
  applyTheme();
  const offTheme = onTheme(applyTheme);

  // ---- state
  const state = { hover: null, selected: null, focus: null };
  let targets = computeTargets(model, state);
  let targetsDirty = true;
  const nodeCur = new Float32Array(N);
  const edgeCur = new Float32Array(E);

  let width = 1, height = 1, dpr = 1;
  let baseDist = 260, dist = 260;
  let yaw = 0.35, pitch = 0.18, following = false, yawT = 0, pitchT = 0;
  let px = 0, py = 0, pxT = 0, pyT = 0; // pointer parallax
  let clock = 0; // intro clock, seconds
  let idleSince = 0;
  let dragging = null;
  let screen = new Array(N);
  const points2d = model.nodes.map((n, i) => (screen[i] = { id: n.id, x: -999, y: -999, r: 0, a: 0, ok: false }));

  const tip = createTip(stage);
  const labels = createLabels(stage, model);

  // ---- sizing
  function resize() {
    const r = stage.getBoundingClientRect();
    width = Math.max(1, Math.round(r.width));
    height = Math.max(1, Math.round(r.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    const { dx, dy } = layoutShift(width, height);
    camera.aspect = width / height;
    camera.setViewOffset(width, height, -dx, -dy, width, height);
    const avail = Math.max(60, Math.min(width / 2 - Math.abs(dx), height / 2 - Math.abs(dy)) * 0.92);
    baseDist = ((RADIUS * (height / 2)) / (avail * Math.tan((FOV * Math.PI) / 360))) * 1.3;
    nodeMat.uniforms.uScale.value = (height / 800) * dpr;
  }
  resize();
  dist = baseDist;
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  // ---- selection / focus API
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
  function setHover(id) {
    if (state.hover === id) return;
    state.hover = id;
    targetsDirty = true;
  }
  function setFocus(set) {
    state.focus = set;
    targetsDirty = true;
  }

  // ---- pointer
  const hit = (x, y) => nearest(points2d, x, y, 8);
  const local = (ev) => {
    const r = stage.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  function onPointerMove(ev) {
    const { x, y } = local(ev);
    pxT = clamp((x / width) * 2 - 1, -1, 1);
    pyT = clamp((y / height) * 2 - 1, -1, 1);
    if (dragging) {
      const dxm = ev.clientX - dragging.x, dym = ev.clientY - dragging.y;
      if (Math.abs(dxm) + Math.abs(dym) > 4) dragging.moved = true;
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
  }
  function onPointerDown(ev) {
    if (ev.button !== undefined && ev.button !== 0) return;
    dragging = { x: ev.clientX, y: ev.clientY, lx: ev.clientX, ly: ev.clientY, moved: false };
    try { canvas.setPointerCapture(ev.pointerId); } catch { /* not an active pointer: dragging still works without capture */ }
    if (ev.pointerType === 'mouse') canvas.style.cursor = 'grabbing';
  }
  function onPointerUp(ev) {
    const d = dragging;
    dragging = null;
    try { canvas.releasePointerCapture(ev.pointerId); } catch { /* nothing to release */ }
    if (!d) return;
    canvas.style.cursor = 'grab';
    if (d.moved) return;
    const { x, y } = local(ev);
    const id = hit(x, y);
    onSelect(id); // null (empty space) clears the selection
  }
  function onLeave() {
    if (dragging) return;
    setHover(null);
    onHover(null);
    tip.hide();
    pxT = 0; pyT = 0;
  }
  canvas.style.touchAction = 'pan-y';
  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', () => { dragging = null; });
  canvas.addEventListener('pointerleave', onLeave);

  // ---- loop
  const v = new THREE.Vector3();
  const vc = new THREE.Vector3();
  let raf = 0, last = 0, visible = true, destroyed = false;

  function frame(now) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    clock += dt;

    // brightness targets -> eased current values
    if (targetsDirty) { targets = computeTargets(model, state); targetsDirty = false; }
    const k = damp(9, dt);
    let moving = false;
    for (let i = 0; i < N; i++) {
      const d = targets.nodes[i] - nodeCur[i];
      nodeCur[i] += Math.abs(d) < 0.002 ? d : d * k;
      if (d !== 0) moving = true;
    }
    for (let i = 0; i < E; i++) {
      const d = targets.edges[i] - edgeCur[i];
      edgeCur[i] += Math.abs(d) < 0.002 ? d : d * k;
      const a = i * 2;
      eLight[a] = eLight[a + 1] = edgeCur[i];
      if (d !== 0) moving = true;
    }
    if (moving || clock < 3) {
      nLight.set(nodeCur);
      nodeGeo.attributes.aLight.needsUpdate = true;
      edgeGeo.attributes.aLight.needsUpdate = true;
    }

    // rotation: drift when idle, ease toward the selected node, follow the pointer
    if (following) {
      const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
      yaw += wrap(yawT - yaw) * damp(3.2, dt);
      pitch += (pitchT - pitch) * damp(3.2, dt);
    } else if (!dragging && !state.hover && clock - idleSince > 2.5) {
      yaw += dt * 0.05;
      pitch += (0.18 - pitch) * damp(0.6, dt);
    }
    const want = state.selected ? baseDist * 0.74 : baseDist;
    dist += (want - dist) * damp(3, dt);
    px += (pxT - px) * damp(2.5, dt);
    py += (pyT - py) * damp(2.5, dt);

    group.rotation.set(pitch + py * 0.05, yaw + px * 0.12, 0);
    camera.position.set(px * 7, -py * 5, dist);
    camera.lookAt(0, 0, 0);
    group.updateMatrixWorld();
    camera.updateMatrixWorld();

    nodeMat.uniforms.uTime.value = edgeMat.uniforms.uTime.value = clock;
    nodeMat.uniforms.uDist.value = dist;

    // screen positions for hit testing and the topic labels
    const scale = nodeMat.uniforms.uScale.value / dpr;
    for (let i = 0; i < N; i++) {
      const n = model.nodes[i];
      const t = clamp((clock - delays[i]) / BLOOM, 0, 1);
      const e = 1 - Math.pow(1 - t, 3);
      v.set(n.x * e, n.y * e, n.z * e).applyMatrix4(group.matrixWorld);
      vc.copy(v).applyMatrix4(camera.matrixWorldInverse);
      const depth = Math.max(-vc.z, 1);
      v.project(camera);
      const s = screen[i];
      s.x = (v.x * 0.5 + 0.5) * width;
      s.y = (-v.y * 0.5 + 0.5) * height;
      s.r = (nSize[i] * e * scale * 300) / depth / 2;
      s.ok = e > 0.6;
      s.a = e * (nodeCur[i] < -0.5 ? 0.3 : 1);
    }
    labels.update(screen);

    renderer.render(scene, camera);
  }

  function run() {
    if (raf || destroyed || !visible || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  const io = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible) run(); else stop();
  });
  io.observe(stage);
  const onVisibility = () => (document.hidden ? stop() : run());
  document.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); stop(); onLost(); });

  run();

  return {
    kind: 'full',
    setSelected,
    setHover(id) { setHover(id); },
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
      nodeGeo.dispose(); edgeGeo.dispose(); nodeMat.dispose(); edgeMat.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      canvas.remove();
    },
  };
}
