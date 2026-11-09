// Chooses which graph labels to show, and where. Pure maths over screen points;
// the DOM work lives in graph-common.js. Rules:
//   - topics always get a label (when they fit)
//   - POV labels appear once you are zoomed in enough, or when the POV is the
//     selection, hovered, or a neighbour of the selection
//   - document labels only for the hovered or selected node
//   - never more than `limit` labels, and no two boxes overlap
// Higher priority wins when two labels would collide.

const PRIORITY = { selected: 100, hover: 90, neighbour: 60, topic: 50, pov: 20, doc: 10 };

/**
 * @param {Array<{i:number, kind:string, x:number, y:number, r:number, a:number, w:number, h:number, weight?:number}>} items
 * @param {{selected:number, hover:number, near:Set<number>, zoom:number, limit?:number, bounds?:{w:number,h:number}}} ctx
 *        zoom is >= 1 and grows as the camera gets closer
 * @returns {Map<number, {x:number, y:number}>} label top-centre positions for the chosen items
 */
export function chooseLabels(items, ctx) {
  const limit = ctx.limit ?? 45;
  const gap = 4;
  const showPovs = ctx.showPovs ?? ctx.zoom >= 1.6;

  const candidates = [];
  for (const it of items) {
    if (it.a < 0.15) continue;
    let p = 0;
    if (it.i === ctx.selected) p = PRIORITY.selected;
    else if (it.i === ctx.hover) p = PRIORITY.hover;
    else if (ctx.near.has(it.i) && it.kind !== 'doc') p = PRIORITY.neighbour;
    else if (it.kind === 'topic') p = PRIORITY.topic + Math.min(it.weight ?? 0, 20) * 0.1;
    else if (it.kind === 'pov' && showPovs) p = PRIORITY.pov + Math.min(ctx.zoom, 6);
    if (p > 0) candidates.push({ it, p });
  }
  candidates.sort((a, b) => b.p - a.p || a.it.i - b.it.i);

  const placed = [];
  const out = new Map();
  for (const { it } of candidates) {
    if (out.size >= limit) break;
    const x = Math.round(it.x);
    const y = Math.round(it.y + it.r + 4);
    const box = { x0: x - it.w / 2 - gap, x1: x + it.w / 2 + gap, y0: y - gap, y1: y + it.h + gap };
    if (ctx.bounds && (box.x1 < 0 || box.x0 > ctx.bounds.w || box.y1 < 0 || box.y0 > ctx.bounds.h)) continue;
    if (placed.some((q) => box.x0 < q.x1 && q.x0 < box.x1 && box.y0 < q.y1 && q.y0 < box.y1)) continue;
    placed.push(box);
    out.set(it.i, { x, y });
  }
  return out;
}
