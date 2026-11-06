// Reading page extras: a progress bar that fills as you scroll.

export function initArticle() {
  const article = document.querySelector('.article');
  if (!article) return;

  const bar = document.createElement('div');
  bar.className = 'progress';
  bar.setAttribute('aria-hidden', 'true');
  document.body.prepend(bar);

  let queued = false;
  function update() {
    queued = false;
    const rect = article.getBoundingClientRect();
    const total = rect.height - innerHeight * 0.6;
    const done = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 1;
    bar.style.transform = `scaleX(${done.toFixed(4)})`;
  }
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  update();
}
