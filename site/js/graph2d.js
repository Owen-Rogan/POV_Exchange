// The lite tier painter: the same graph on a 2D canvas, for devices without
// WebGL or with little power. It owns no camera and no input; it draws the
// screen positions the engine computed, so it matches the 3D tier exactly.

const rgba = (hex, a) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(128,128,128,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** @returns a painter: { kind, canvas, setTheme, resize, draw, destroy } */
export function createPainter2D(stage, model) {
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  stage.prepend(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); throw new Error('no 2d context'); }

  const N = model.nodes.length;
  let palette = null;
  let dark = false;
  let width = 1;
  let height = 1;
  let dpr = 1;
  const order = Array.from({ length: N }, (_, i) => i);

  return {
    kind: 'lite',
    canvas,

    setTheme(p, isDark) { palette = p; dark = isDark; },

    resize(w, h, ratio) {
      width = w; height = h; dpr = ratio;
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    },

    draw(f) {
      const { screen, nodeLight, edgeLight, edgeShow, edgeEnds, pulse } = f;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      ctx.lineWidth = 1;
      model.edges.forEach((e, k) => {
        const [ai, bi] = edgeEnds[k];
        const a = screen[ai], b = screen[bi];
        const vis = Math.min(a.e, b.e) * edgeShow[k];
        if (vis < 0.02) return;
        const light = edgeLight[k];
        let alpha = (dark ? 0.3 : 0.38) * vis;
        if (light > 0) alpha += (0.85 * vis - alpha) * light;
        else if (light < 0) alpha *= 1 - 0.9 * -light;
        ctx.strokeStyle = rgba(light > 0.4 ? palette.lit : palette.edge, alpha);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      });

      order.sort((p, q) => screen[q].depth - screen[p].depth); // far to near
      for (const i of order) {
        const s = screen[i];
        if (s.a < 0.02) continue;
        const n = model.nodes[i];
        const light = nodeLight[i];
        const dim = light < 0 ? 1 - 0.84 * -light : 1;
        let r = s.r;
        if (i === pulse) r *= 1 + 0.18 * (0.5 + 0.5 * Math.sin(f.time * 3.2));
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
    },

    destroy() { canvas.remove(); },
  };
}

