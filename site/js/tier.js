// Picks how much of the hero to run, from what this device can do.
//
//   full    live 3D graph (three.js, WebGL)
//   lite    2D canvas graph, same precomputed positions, simpler motion
//   static  the SVG snapshot already on the page, no animation
//
// Reduced motion, or no way to draw, always means static. The tier can be
// forced for testing with #tier=full|lite|static in the URL.

export function pickTier() {
  const forced = /[#&]tier=(full|lite|static)\b/.exec(location.hash);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return { tier: 'static', reason: 'reduced-motion' };
  if (forced) return { tier: forced[1], reason: 'forced' };

  const saveData = !!navigator.connection && navigator.connection.saveData === true;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const weak = saveData || cores <= 2 || memory <= 2;

  if (!canvas2d()) return { tier: 'static', reason: 'no-canvas' };
  if (weak) return { tier: 'lite', reason: 'weak-device' };
  if (!webgl()) return { tier: 'lite', reason: 'no-webgl' };
  return { tier: 'full', reason: 'capable' };
}

function canvas2d() {
  try { return !!document.createElement('canvas').getContext('2d'); } catch { return false; }
}

function webgl() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch { return false; }
}
