// Camera maths for the graph page. Pure functions: no DOM, no three.js.
//
// The camera orbits a target point. yaw turns it around the vertical axis,
// pitch lifts it, dist is how far it sits from the target. Both renderers use
// project() below, so the 3D and 2D pictures line up exactly, and hit-testing
// (which node is under the pointer) uses the same numbers.

export const FOV = 45; // vertical field of view, degrees
export const TAN = Math.tan((FOV * Math.PI) / 360);
export const HOME = { yaw: 0.35, pitch: 0.18 };
export const MAX_PITCH = 1.4;
export const LIMIT = 170; // the target may not wander further than this from the graph centre

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function makeCamera() {
  return { yaw: HOME.yaw, pitch: HOME.pitch, dist: 260, tx: 0, ty: 0, tz: 0, minDist: 22, maxDist: 600, goal: null };
}

/** Unit vectors of the camera: d points from the target toward the camera. */
export function basis(cam) {
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  return { d: [sy * cp, sp, cy * cp], right: [cy, 0, -sy], up: [-sy * sp, cp, -cy * sp] };
}

export function eyePosition(cam, b = basis(cam)) {
  return [cam.tx + b.d[0] * cam.dist, cam.ty + b.d[1] * cam.dist, cam.tz + b.d[2] * cam.dist];
}

/**
 * Screen position of a world point.
 * view = { width, height, shiftX, shiftY }: shift moves the picture's centre
 * (used to keep the target clear of the reader panel).
 * Writes into `out` when given, so the per-frame loop allocates nothing.
 */
export function project(cam, view, x, y, z, b = basis(cam), out = {}) {
  const qx = x - cam.tx, qy = y - cam.ty, qz = z - cam.tz;
  const xc = qx * b.right[0] + qy * b.right[1] + qz * b.right[2];
  const yc = qx * b.up[0] + qy * b.up[1] + qz * b.up[2];
  const depth = cam.dist - (qx * b.d[0] + qy * b.d[1] + qz * b.d[2]);
  const ppu = view.height / 2 / (Math.max(depth, 1) * TAN); // pixels per world unit at this depth
  out.x = view.width / 2 + view.shiftX + xc * ppu;
  out.y = view.height / 2 + view.shiftY - yc * ppu;
  out.depth = depth;
  out.ppu = ppu;
  return out;
}

/** Bounding sphere of points [{x,y,z}] using the box centre, so it is stable and cheap. */
export function boundsOf(points) {
  if (!points.length) return { cx: 0, cy: 0, cz: 0, radius: 100 };
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z;
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  let radius = 0;
  for (const p of points) radius = Math.max(radius, Math.hypot(p.x - cx, p.y - cy, p.z - cz));
  return { cx, cy, cz, radius };
}

/**
 * Distance at which a sphere of this radius just fits the free part of the
 * view. view.insetX / insetY are the pixels taken by panels.
 */
export function fitDistance(radius, view, pad = 1.12) {
  const w = Math.max(160, view.width - (view.insetX || 0));
  const h = Math.max(160, view.height - (view.insetY || 0));
  const r = Math.max(radius, 14);
  return (pad * r * view.height) / (TAN * Math.min(w, h));
}

/** Start (or perform, when instant) a move to a goal: any of yaw, pitch, dist, tx, ty, tz. */
export function flyTo(cam, goal, instant = false) {
  if (instant) {
    for (const k of ['yaw', 'pitch', 'dist', 'tx', 'ty', 'tz']) if (goal[k] !== undefined) cam[k] = goal[k];
    cam.dist = clamp(cam.dist, cam.minDist, cam.maxDist);
    cam.goal = null;
    return;
  }
  cam.goal = { ...goal };
  if (cam.goal.dist !== undefined) cam.goal.dist = clamp(cam.goal.dist, cam.minDist, cam.maxDist);
}

const EPS = { yaw: 0.002, pitch: 0.002, dist: 0.05, tx: 0.03, ty: 0.03, tz: 0.03 };

/** Ease toward the goal. Returns true while still moving. */
export function stepCamera(cam, dt, rate = 3.2) {
  const g = cam.goal;
  if (!g) return false;
  const k = 1 - Math.exp(-rate * dt);
  let moving = false;
  for (const key of Object.keys(EPS)) {
    if (g[key] === undefined) continue;
    let d = g[key] - cam[key];
    if (key === 'yaw') d = Math.atan2(Math.sin(d), Math.cos(d)); // shortest way round
    if (Math.abs(d) <= EPS[key]) { cam[key] = key === 'yaw' ? cam[key] + d : g[key]; continue; }
    cam[key] += d * k;
    moving = true;
  }
  if (!moving) cam.goal = null;
  return moving;
}

export function rotateBy(cam, dyaw, dpitch) {
  cam.goal = null;
  cam.yaw += dyaw;
  cam.pitch = clamp(cam.pitch + dpitch, -MAX_PITCH, MAX_PITCH);
}

function limitTarget(cam) {
  const r = Math.hypot(cam.tx, cam.ty, cam.tz);
  if (r > LIMIT) { const k = LIMIT / r; cam.tx *= k; cam.ty *= k; cam.tz *= k; }
}

/** Slide the view by a drag of (dx, dy) pixels. */
export function panBy(cam, view, dx, dy) {
  cam.goal = null;
  const ppu = view.height / 2 / (cam.dist * TAN);
  const b = basis(cam);
  cam.tx += (-b.right[0] * dx + b.up[0] * dy) / ppu;
  cam.ty += (-b.right[1] * dx + b.up[1] * dy) / ppu;
  cam.tz += (-b.right[2] * dx + b.up[2] * dy) / ppu;
  limitTarget(cam);
}

/** Zoom by a factor (below 1 moves closer), keeping the point under (px, py) where it is. */
export function zoomAt(cam, view, factor, px, py) {
  cam.goal = null;
  const next = clamp(cam.dist * factor, cam.minDist, cam.maxDist);
  const f = next / cam.dist;
  const ppu = view.height / 2 / (cam.dist * TAN);
  const wx = (px - (view.width / 2 + view.shiftX)) / ppu;
  const wy = -(py - (view.height / 2 + view.shiftY)) / ppu;
  const b = basis(cam);
  cam.tx += (b.right[0] * wx + b.up[0] * wy) * (1 - f);
  cam.ty += (b.right[1] * wx + b.up[1] * wy) * (1 - f);
  cam.tz += (b.right[2] * wx + b.up[2] * wy) * (1 - f);
  cam.dist = next;
  limitTarget(cam);
}
