// The full tier painter: draws the graph with WebGL (three.js).
//
// It owns no camera and no input. Each frame the engine passes the camera, the
// per-node screen positions and the brightness / visibility arrays, and this
// file turns them into pixels: glowing sprites in one draw call and edges in
// another, so it stays cheap with hundreds of nodes.

import * as THREE from '../vendor/three/three.module.js';
import { FOV } from './camera.js';
import { parseColor } from './graph-common.js';

const BLOOM = 1.1;
const SPRITE = 2.6; // sprite size relative to the visible core, leaves room for the glow
const EDGE_WEIGHT = { parent: 0.9, link: 0.75, related: 1, topic: 0.6, doc: 0.5 };

const NODE_VERT = `
attribute float aSize;
attribute vec3 aColor;
attribute float aLight;
attribute float aShow;
attribute float aDelay;
attribute float aPulse;
attribute float aRing;
uniform float uTime;
uniform float uScale;
uniform float uPx;
varying vec3 vColor;
varying float vLight;
varying float vAlpha;
varying float vRing;
void main() {
  float t = clamp((uTime - aDelay) / ${BLOOM.toFixed(2)}, 0.0, 1.0);
  float e = 1.0 - pow(1.0 - t, 3.0);
  vec4 mv = modelViewMatrix * vec4(position * e, 1.0);
  float pulse = 1.0 + aPulse * 0.28 * (0.5 + 0.5 * sin(uTime * 3.2));
  float lift = 1.0 + max(aLight, 0.0) * 0.3;
  // size in device pixels: the shared pixel rule (uPx) at this depth, with room for the glow
  float core = clamp(aSize * 0.31 * uPx / max(-mv.z, 1.0), 2.4, 60.0);
  gl_PointSize = clamp(core * ${SPRITE.toFixed(2)} * e * aShow * pulse * lift * uScale, 0.0, 300.0);
  gl_Position = projectionMatrix * mv;
  vColor = aColor;
  vLight = aLight;
  vAlpha = e * aShow;
  vRing = aRing;
}`;

const NODE_FRAG = `
uniform float uGlow;
varying vec3 vColor;
varying float vLight;
varying float vAlpha;
varying float vRing;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0 || vAlpha < 0.01) discard;
  float core = smoothstep(${(1 / SPRITE + 0.03).toFixed(3)}, ${(1 / SPRITE - 0.04).toFixed(3)}, d);
  // A draft is drawn as a ring: the middle of the core is cut away.
  core *= mix(1.0, smoothstep(0.17, 0.23, d), vRing);
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
attribute float aShow;
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
  vA = e * e2 * aWeight * aShow;
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
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uColor, uLit, max(vL, 0.0)), a);
}`;

/** @returns a painter: { kind, canvas, setTheme, resize, draw, destroy } */
export function createPainter3D(stage, model, { onLost }) {
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
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 4000);
  const N = model.nodes.length;
  const E = model.edges.length;
  const index = model.index;

  // ---- nodes (attributes the engine updates every frame are DynamicDraw)
  const nPos = new Float32Array(N * 3);
  const nSize = new Float32Array(N);
  const nColor = new Float32Array(N * 3);
  const nLight = new Float32Array(N);
  const nShow = new Float32Array(N);
  const nDelay = new Float32Array(N);
  const nPulse = new Float32Array(N);
  const nRing = Float32Array.from(model.nodes, (n) => (n.status === 'draft' ? 1 : 0));
  model.nodes.forEach((n, i) => { nPos.set([n.x, n.y, n.z], i * 3); });

  const nodeGeo = new THREE.BufferGeometry();
  const dyn = (array, size) => new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
  nodeGeo.setAttribute('position', new THREE.BufferAttribute(nPos, 3));
  nodeGeo.setAttribute('aSize', new THREE.BufferAttribute(nSize, 1));
  nodeGeo.setAttribute('aColor', new THREE.BufferAttribute(nColor, 3));
  nodeGeo.setAttribute('aLight', dyn(nLight, 1));
  nodeGeo.setAttribute('aShow', dyn(nShow, 1));
  nodeGeo.setAttribute('aDelay', new THREE.BufferAttribute(nDelay, 1));
  nodeGeo.setAttribute('aPulse', new THREE.BufferAttribute(nPulse, 1));
  nodeGeo.setAttribute('aRing', new THREE.BufferAttribute(nRing, 1));
  const nodeMat = new THREE.ShaderMaterial({
    vertexShader: NODE_VERT,
    fragmentShader: NODE_FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uPx: { value: 1 }, uGlow: { value: 1 } },
  });
  const points = new THREE.Points(nodeGeo, nodeMat);
  points.frustumCulled = false;

  // ---- edges (two vertices each; each vertex knows both ends' delays)
  const ePos = new Float32Array(E * 6);
  const eDelay = new Float32Array(E * 2);
  const eDelay2 = new Float32Array(E * 2);
  const eLight = new Float32Array(E * 2);
  const eShow = new Float32Array(E * 2);
  const eWeight = new Float32Array(E * 2);
  model.edges.forEach((e, k) => {
    const a = index.get(e.s), b = index.get(e.t);
    ePos.set([model.nodes[a].x, model.nodes[a].y, model.nodes[a].z, model.nodes[b].x, model.nodes[b].y, model.nodes[b].z], k * 6);
    eWeight[k * 2] = eWeight[k * 2 + 1] = EDGE_WEIGHT[e.k] ?? 0.7;
  });
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  edgeGeo.setAttribute('aDelay', new THREE.BufferAttribute(eDelay, 1));
  edgeGeo.setAttribute('aDelay2', new THREE.BufferAttribute(eDelay2, 1));
  edgeGeo.setAttribute('aLight', dyn(eLight, 1));
  edgeGeo.setAttribute('aShow', dyn(eShow, 1));
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
  scene.add(lines, points);

  let delaysSet = false;
  let dpr = 1;
  let height = 1;

  canvas.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); onLost?.(); });

  return {
    kind: 'full',
    canvas,

    setTheme(palette, dark) {
      model.nodes.forEach((n, i) => nColor.set(parseColor(palette[n.kind]), i * 3));
      nodeGeo.attributes.aColor.needsUpdate = true;
      edgeMat.uniforms.uColor.value.set(...parseColor(palette.edge));
      edgeMat.uniforms.uLit.value.set(...parseColor(palette.lit));
      edgeMat.uniforms.uBase.value = dark ? 0.32 : 0.4;
      nodeMat.uniforms.uGlow.value = dark ? 1 : 0.55;
      const blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
      nodeMat.blending = edgeMat.blending = blending;
      nodeMat.needsUpdate = edgeMat.needsUpdate = true;
    },

    resize(width, h, ratio) {
      dpr = ratio;
      height = h;
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, h, false);
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      camera.aspect = width / h;
      camera.updateProjectionMatrix();
    },

    draw(f) {
      const { cam, view, basis: b } = f;
      if (!delaysSet) {
        for (let i = 0; i < N; i++) { nDelay[i] = f.delays[i]; nSize[i] = f.sizes[i]; nPulse[i] = i === f.pulse ? 1 : 0; }
        nodeGeo.attributes.aDelay.needsUpdate = true;
        nodeGeo.attributes.aSize.needsUpdate = true;
        nodeGeo.attributes.aPulse.needsUpdate = true;
        model.edges.forEach((e, k) => {
          const a = index.get(e.s), c = index.get(e.t);
          eDelay[k * 2] = f.delays[a]; eDelay[k * 2 + 1] = f.delays[c];
          eDelay2[k * 2] = f.delays[c]; eDelay2[k * 2 + 1] = f.delays[a];
        });
        edgeGeo.attributes.aDelay.needsUpdate = true;
        edgeGeo.attributes.aDelay2.needsUpdate = true;
        delaysSet = true;
      }

      for (let i = 0; i < N; i++) { nLight[i] = f.nodeLight[i]; nShow[i] = f.nodeShow[i]; }
      nodeGeo.attributes.aLight.needsUpdate = true;
      nodeGeo.attributes.aShow.needsUpdate = true;
      for (let k = 0; k < E; k++) {
        eLight[k * 2] = eLight[k * 2 + 1] = f.edgeLight[k];
        eShow[k * 2] = eShow[k * 2 + 1] = f.edgeShow[k];
      }
      edgeGeo.attributes.aLight.needsUpdate = true;
      edgeGeo.attributes.aShow.needsUpdate = true;

      // The shared camera, as a three.js camera looking at the target.
      camera.position.set(cam.tx + b.d[0] * cam.dist, cam.ty + b.d[1] * cam.dist, cam.tz + b.d[2] * cam.dist);
      camera.up.set(b.up[0], b.up[1], b.up[2]);
      camera.lookAt(cam.tx, cam.ty, cam.tz);
      // Shift the picture's centre (keeps the target clear of the reader panel).
      camera.setViewOffset(view.width, view.height, -view.shiftX, -view.shiftY, view.width, view.height);

      nodeMat.uniforms.uTime.value = edgeMat.uniforms.uTime.value = f.clock;
      nodeMat.uniforms.uScale.value = dpr;
      // pixels per world unit at distance 1, so the shader's depth division matches nodePixels()
      nodeMat.uniforms.uPx.value = (height / 2) / Math.tan((FOV * Math.PI) / 360);
      renderer.render(scene, camera);
    },

    destroy() {
      nodeGeo.dispose(); edgeGeo.dispose(); nodeMat.dispose(); edgeMat.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      canvas.remove();
    },
  };
}

