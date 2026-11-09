// The guided tour: one stop per topic, busiest first, plus a closing stop that
// shows everything. Pure data; graph-page.js moves the camera and shows the caption.

/**
 * @param {object} model         from withIndex()
 * @param {Map} topicById        id -> { title, view }
 * @param {(node)=>boolean} [isVisible]  only visible topics become stops
 * @returns {Array<{id:string, title:string, text:string, count:number}>}
 */
export function tourSteps(model, topicById, isVisible = () => true) {
  const topics = model.nodes
    .filter((n) => n.kind === 'topic' && isVisible(n))
    .sort((a, b) => (b.n ?? 0) - (a.n ?? 0) || (a.label < b.label ? -1 : 1));
  const steps = topics.map((n) => ({
    id: n.id,
    title: n.label,
    text: topicById.get(n.ref)?.view ?? '',
    count: n.n ?? 0,
  }));
  if (steps.length) {
    steps.push({ id: null, title: 'The whole picture', text: 'Every topic, POV and document together. Select anything to read it.', count: 0 });
  }
  return steps;
}

/** Previous and next positions that wrap neither way (returns the same index at the ends). */
export function stepIndex(current, delta, length) {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, current + delta));
}
