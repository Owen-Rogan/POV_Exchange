// Pointer, wheel, touch and keyboard input for the graph. It only reads events
// and calls the engine's small API; it never touches the camera itself, so the
// rules for what a gesture means live in one place.
//
// Mouse: drag turns (or slides, in Move mode), wheel zooms toward the cursor,
// right-drag / middle-drag always slides, Shift flips what a drag does, click
// selects, double-click focuses (empty space resets).
// Touch: one finger turns (or slides, in Move mode), two fingers pinch and
// slide, tap selects, double-tap focuses.
// Keys (stage focused): arrows turn, Shift+arrows slide, + - zoom, 0 reset, F frame.

const TAP_SLOP = 5; // pixels of movement that still count as a click
const DOUBLE_MS = 350;

/**
 * What a one-pointer drag does: 'rotate' (turn the view) or 'pan' (slide it).
 *   mode         'turn' (the default) or 'move', from the on-screen switch
 *   shift        Shift held on a mouse: flips the meaning, so either mode can do both
 *   button       mouse button; the middle and right buttons always slide
 *   pointerType  'mouse', 'touch' or 'pen'; only a mouse has buttons and a held Shift
 */
export function dragMeaning({ mode = 'turn', shift = false, button = 0, pointerType = 'mouse' } = {}) {
  if (pointerType === 'mouse' && (button === 1 || button === 2)) return 'pan';
  const base = mode === 'move' ? 'pan' : 'rotate';
  if (pointerType !== 'mouse' || !shift) return base;
  return base === 'pan' ? 'rotate' : 'pan';
}

/**
 * @param {HTMLElement} el   the stage; it receives all graph gestures
 * @param {object} api       { pick(x,y), rotate(dx,dy), pan(dx,dy), zoomAt(factor,x,y), hover(id,x,y),
 *                             select(id), focusNode(id), reset(), frame(), interact(), dragMode?() }
 * @returns {() => void} unbind
 */
export function bindControls(el, api) {
  const ptrs = new Map();
  let drag = null; // { x, y, lx, ly, mode: 'rotate' | 'pan', moved }
  let pinch = null; // { dist, mx, my }
  let lastTap = { t: 0, x: 0, y: 0 };

  const rel = (ev) => {
    const r = el.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  const capture = (ev) => { try { el.setPointerCapture(ev.pointerId); } catch { /* not an active pointer: the gesture still works */ } };
  const release = (ev) => { try { el.releasePointerCapture(ev.pointerId); } catch { /* nothing to release */ } };

  function pairInfo() {
    const [a, b] = [...ptrs.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  function down(ev) {
    if (ev.pointerType === 'mouse' && ev.button !== 0 && ev.button !== 1 && ev.button !== 2) return;
    const p = rel(ev);
    ptrs.set(ev.pointerId, p);
    capture(ev);
    api.interact();
    if (ptrs.size === 1) {
      const mode = dragMeaning({ mode: api.dragMode ? api.dragMode() : 'turn', shift: ev.shiftKey, button: ev.button, pointerType: ev.pointerType });
      drag = { x: p.x, y: p.y, lx: p.x, ly: p.y, mode, moved: false };
      el.classList.add('grabbing');
    } else if (ptrs.size === 2) {
      drag = null;
      pinch = pairInfo();
    }
  }

  function move(ev) {
    const p = rel(ev);
    if (ptrs.has(ev.pointerId)) ptrs.set(ev.pointerId, p);

    if (pinch && ptrs.size >= 2) {
      const now = pairInfo();
      api.zoomAt(pinch.dist / now.dist, now.mx, now.my);
      api.pan(now.mx - pinch.mx, now.my - pinch.my);
      pinch = now;
      api.interact();
      return;
    }
    if (drag) {
      if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) > TAP_SLOP) drag.moved = true;
      if (drag.moved) {
        const dx = p.x - drag.lx, dy = p.y - drag.ly;
        if (drag.mode === 'pan') api.pan(dx, dy); else api.rotate(dx, dy);
        api.interact();
      }
      drag.lx = p.x; drag.ly = p.y;
      return;
    }
    if (ev.pointerType === 'mouse') api.hover(api.pick(p.x, p.y), p.x, p.y);
  }

  function up(ev) {
    const p = rel(ev);
    const wasDrag = drag;
    ptrs.delete(ev.pointerId);
    release(ev);
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 0) { drag = null; el.classList.remove('grabbing'); }
    if (!wasDrag || wasDrag.moved) return;

    // A tap or click that did not move.
    const id = api.pick(p.x, p.y);
    const now = performance.now();
    const second = ev.pointerType !== 'mouse' && now - lastTap.t < DOUBLE_MS && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 24;
    lastTap = { t: now, x: p.x, y: p.y };
    if (second) { lastTap.t = 0; if (id) api.focusNode(id); else api.reset(); return; }
    api.select(id);
  }

  function cancel(ev) {
    ptrs.delete(ev.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 0) { drag = null; el.classList.remove('grabbing'); }
  }

  function leave(ev) {
    if (ev.pointerType === 'mouse' && !drag) api.hover(null, 0, 0);
  }

  function wheel(ev) {
    ev.preventDefault();
    const p = rel(ev);
    const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1; // lines and pages -> pixels
    const delta = Math.max(-240, Math.min(240, ev.deltaY * unit));
    api.zoomAt(Math.exp(delta * (ev.ctrlKey ? 0.01 : 0.0017)), p.x, p.y);
    api.interact();
  }

  function dbl(ev) {
    if (ev.pointerType === 'touch') return; // touch double-tap is handled in up()
    const p = rel(ev);
    const id = api.pick(p.x, p.y);
    if (id) api.focusNode(id); else api.reset();
  }

  function key(ev) {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const step = ev.shiftKey ? 'pan' : 'rotate';
    const amount = step === 'pan' ? 40 : 28;
    let handled = true;
    switch (ev.key) {
      case 'ArrowLeft': step === 'pan' ? api.pan(amount, 0) : api.rotate(-amount, 0); break;
      case 'ArrowRight': step === 'pan' ? api.pan(-amount, 0) : api.rotate(amount, 0); break;
      case 'ArrowUp': step === 'pan' ? api.pan(0, amount) : api.rotate(0, -amount); break;
      case 'ArrowDown': step === 'pan' ? api.pan(0, -amount) : api.rotate(0, amount); break;
      case '+': case '=': api.zoomAt(0.8, null, null); break;
      case '-': case '_': api.zoomAt(1.25, null, null); break;
      case '0': api.reset(); break;
      case 'f': case 'F': api.frame(); break;
      default: handled = false;
    }
    if (handled) { ev.preventDefault(); api.interact(); }
  }

  const noMenu = (ev) => ev.preventDefault();
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', leave);
  el.addEventListener('wheel', wheel, { passive: false });
  el.addEventListener('dblclick', dbl);
  el.addEventListener('keydown', key);
  el.addEventListener('contextmenu', noMenu);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
    el.removeEventListener('pointerleave', leave);
    el.removeEventListener('wheel', wheel);
    el.removeEventListener('dblclick', dbl);
    el.removeEventListener('keydown', key);
    el.removeEventListener('contextmenu', noMenu);
  };
}
