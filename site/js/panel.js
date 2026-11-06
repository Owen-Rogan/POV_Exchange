// The glass detail panel that opens when a node is selected. Built with
// createElement/textContent only: nothing from the data is ever parsed as HTML.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createPanel(hero, { onClose }) {
  const panel = el('aside', 'panel');
  panel.setAttribute('aria-label', 'Selected item');
  panel.hidden = true;

  const kind = el('p', 'panel-kind');
  const title = el('h2', 'panel-title');
  title.tabIndex = -1;
  const text = el('p', 'panel-text');
  const meta = el('p', 'panel-meta');
  const actions = el('p', 'panel-actions');
  const link = el('a', 'btn');
  const close = el('button', 'btn ghost', 'Close');
  close.type = 'button';
  close.addEventListener('click', () => onClose());
  actions.append(link, close);
  panel.append(kind, title, text, meta, actions);
  hero.append(panel);

  return {
    get open() { return !panel.hidden; },
    show(info, { moveFocus = false } = {}) {
      kind.textContent = info.kind;
      title.textContent = info.title;
      text.textContent = info.text;
      text.hidden = !info.text;
      meta.textContent = info.meta;
      meta.hidden = !info.meta;
      link.textContent = info.cta;
      link.href = info.href;
      if (info.download) link.setAttribute('download', ''); else link.removeAttribute('download');
      panel.hidden = false;
      hero.classList.add('has-panel');
      if (moveFocus) title.focus({ preventScroll: true });
    },
    hide() {
      panel.hidden = true;
      hero.classList.remove('has-panel');
    },
  };
}
