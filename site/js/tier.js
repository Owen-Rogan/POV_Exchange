// Picks how much of the graph to run, from what this device can do.
//
//   full    live 3D graph (three.js, WebGL)
//   lite    2D canvas graph, same precomputed positions, same controls
//   static  the SVG snapshot already on the page, plus the list
//
// Reduced motion no longer forces the static picture: the graph page is the
// point of the site, so it stays interactive and just stops moving by itself
// (`reduced: true`). Only a device that cannot draw at all gets `static`.
// The tier can be forced for testing with #tier=full|lite|static in the URL.

export function pickTier() {
  const forced = /[#&]tier=(full|lite|static)\b/.exec(location.hash);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (forced) return { tier: forced[1], reason: 'forced', reduced };

  const saveData = !!navigator.connection && navigator.connection.saveData === true;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const weak = saveData || cores <= 2 || memory <= 2;

  if (!canvas2d()) return { tier: 'static', reason: 'no-canvas', reduced };
  if (weak) return { tier: 'lite', reason: 'weak-device', reduced };
  if (!webgl()) return { tier: 'lite', reason: 'no-webgl', reduced };
  return { tier: 'full', reason: 'capable', reduced };
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
