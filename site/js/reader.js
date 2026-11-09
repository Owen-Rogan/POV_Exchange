// The reader: a panel inside the graph that shows a POV (or topic, or document)
// without leaving the page. Everything is built with createElement and
// textContent; the POV body comes from render-blocks.js. Nothing from the data
// is ever parsed as HTML.

import { connections } from './graph-data.js';
import { renderBlocks } from './render-blocks.js';
import { prettyDate } from './timeline.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {HTMLElement} host
 * @param {object} deps { model, povBySlug, topicById, loadBody(slug), onNavigate(id), onClose(), onBack(), isHidden(id) }
 */
export function createReader(host, deps) {
  const { model, povBySlug, topicById } = deps;
  const panel = el('aside', 'reader');
  panel.setAttribute('aria-label', 'Selected item');
  panel.hidden = true;

  const bar = el('div', 'reader-bar');
  const back = el('button', 'reader-back', 'Back');
  back.type = 'button';
  back.hidden = true;
  back.addEventListener('click', () => deps.onBack());
  const close = el('button', 'reader-close', 'Close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close the reader');
  close.addEventListener('click', () => deps.onClose());
  bar.append(back, close);

  const body = el('div', 'reader-body');
  panel.append(bar, body);
  host.append(panel);

  let token = 0; // a newer selection cancels an older one still loading

  function chips(parent, ids, heading) {
    const visible = ids.filter((id) => !deps.isHidden(id));
    if (!visible.length) return;
    const wrap = el('div', 'reader-group');
    wrap.append(el('h3', 'reader-h', heading));
    const list = el('ul', 'reader-links');
    for (const id of visible) {
      const n = model.byId.get(id);
      const li = el('li');
      const b = el('button', `link-btn k-${n.kind}`, n.label);
      b.type = 'button';
      b.addEventListener('click', () => deps.onNavigate(id));
      li.append(b);
      if (n.sample) li.append(el('span', 'tag', 'Sample'));
      list.append(li);
    }
    wrap.append(list);
    parent.append(wrap);
  }

  function header(kind, title, extra) {
    const head = el('header', 'reader-head');
    head.append(el('p', 'reader-kind', kind));
    const h = el('h2', 'reader-title', title);
    h.tabIndex = -1;
    head.append(h);
    if (extra) head.append(extra);
    return { head, h };
  }

  function showTopic(node) {
    const t = topicById.get(node.ref);
    const { head, h } = header(node.sample ? 'Topic \u00B7 Sample' : 'Topic', node.label);
    body.append(head);
    if (t?.view) body.append(el('p', 'reader-lede', t.view));
    const c = connections(model, node.id);
    const count = c.povs.filter((id) => !deps.isHidden(id)).length;
    body.append(el('p', 'reader-meta', `${count} ${count === 1 ? 'POV' : 'POVs'}`));
    chips(body, c.povs, 'POVs on this topic');
    chips(body, c.topics, 'Related topics');
    const a = el('a', 'btn ghost', 'See it in the library');
    a.href = `../#topic-${node.ref}`;
    const actions = el('p', 'reader-actions');
    actions.append(a);
    body.append(actions);
    return h;
  }

  function showDoc(node) {
    const p = povBySlug.get(node.ref);
    const { head, h } = header(node.sample ? 'Document \u00B7 Sample' : 'Document', node.label);
    body.append(head);
    if (p) body.append(el('p', 'reader-lede', `Attached to: ${p.title}`));
    const a = el('a', 'btn', 'Download');
    a.href = `../docs/${node.ref}/${encodeURIComponent(node.label)}`;
    a.setAttribute('download', '');
    const actions = el('p', 'reader-actions');
    actions.append(a);
    body.append(actions);
    const c = connections(model, node.id);
    if (c.pov) chips(body, [c.pov], 'Belongs to');
    return h;
  }

  async function showPov(node) {
    const p = povBySlug.get(node.ref);
    const mine = ++token;
    const tag = p?.sample ? el('p', 'reader-sample', 'Sample: this POV is fictional and says nothing about what the practice thinks.') : null;
    const { head, h } = header(p?.type === 'document' ? 'Document' : 'POV', node.label, tag);
    body.append(head);
    if (p?.summary) body.append(el('p', 'reader-lede', p.summary));
    if (p) body.append(el('p', 'reader-meta', `${p.author} \u00B7 ${prettyDate(p.date)}`));

    const text = el('div', 'reader-prose');
    text.append(el('p', 'reader-loading', 'Loading\u2026'));
    body.append(text);

    const actions = el('p', 'reader-actions');
    const full = el('a', 'btn ghost', 'Open full page');
    full.href = `../pov/${node.ref}/`;
    actions.append(full);
    body.append(actions);

    const c = connections(model, node.id);
    const docWrap = el('div', 'reader-docs');
    body.append(docWrap);
    chips(body, c.topics, 'Topics');
    chips(body, c.related, 'Related POVs');
    chips(body, c.siblings, c.moreSiblings ? `More on these topics (${c.moreSiblings} more in the library)` : 'More on these topics');

    // The body text is fetched on its own so the panel opens at once.
    try {
      const data = await deps.loadBody(node.ref);
      if (mine !== token) return h;
      text.replaceChildren(...renderBlocks(document, data.blocks));
      if (data.documents.length) {
        docWrap.append(el('h3', 'reader-h', 'Documents'));
        const list = el('ul', 'reader-links');
        for (const d of data.documents) {
          const li = el('li');
          const a = el('a', '', d.name);
          a.href = `../docs/${node.ref}/${encodeURIComponent(d.name)}`;
          a.setAttribute('download', '');
          li.append(a, el('span', 'size', ` ${d.ext.toUpperCase()}`));
          list.append(li);
        }
        docWrap.append(list);
      }
    } catch {
      if (mine !== token) return h;
      const note = el('p', 'reader-loading', 'The text could not be loaded. ');
      const a = el('a', '', 'Open the full page');
      a.href = `../pov/${node.ref}/`;
      note.append(a);
      text.replaceChildren(note);
    }
    return h;
  }

  return {
    get open() { return !panel.hidden; },
    el: panel,
    async show(id, { moveFocus = false, canGoBack = false } = {}) {
      const node = model.byId.get(id);
      if (!node) return;
      token += 1;
      body.replaceChildren();
      back.hidden = !canGoBack;
      panel.hidden = false;
      panel.scrollTop = 0;
      body.scrollTop = 0;
      let heading;
      if (node.kind === 'topic') heading = showTopic(node);
      else if (node.kind === 'doc') heading = showDoc(node);
      else heading = await showPov(node);
      if (moveFocus && heading) heading.focus({ preventScroll: true });
    },
    hide() {
      token += 1;
      panel.hidden = true;
    },
  };
}
