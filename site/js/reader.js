// The reader: a panel inside the graph that shows a POV (or topic, or document)
// without leaving the page. Everything is built with createElement and
// textContent; the POV body comes from render-blocks.js. Nothing from the data
// is ever parsed as HTML.

import { hostLabel } from './shared/doc-links.js';
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
  const { model, povBySlug, topicById, glossaryBySlug } = deps;
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
      if (n.status === 'draft') li.append(el('span', 'status draft', 'Draft'));
      list.append(li);
    }
    wrap.append(list);
    parent.append(wrap);
  }

  /** Copies a link to this node on the Graph page. */
  function shareButton(id) {
    const b = el('button', 'btn ghost', 'Copy link');
    b.type = 'button';
    b.addEventListener('click', async () => {
      const url = `${location.origin}${location.pathname}#n=${encodeURIComponent(id)}`;
      try { await navigator.clipboard.writeText(url); b.textContent = 'Copied'; } catch { b.textContent = 'Copy failed'; }
      setTimeout(() => { b.textContent = 'Copy link'; }, 1800);
    });
    return b;
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

  function showTerm(node) {
    const g = glossaryBySlug?.get(node.ref);
    const { head, h } = header(node.sample ? 'Glossary term \u00B7 Sample' : 'Glossary term', node.label);
    body.append(head);
    if (g?.summary) body.append(el('p', 'reader-lede', g.summary));
    if (g?.aliases?.length) body.append(el('p', 'reader-meta', `Also: ${g.aliases.join(', ')}`));
    const c = connections(model, node.id);
    chips(body, c.povs, 'Used in');
    const a = el('a', 'btn ghost', 'See it in the glossary');
    a.href = `../glossary/#${node.ref}`;
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
    const doc = docFor(node);
    const actions = el('p', 'reader-actions');
    if (doc) {
      const a = el('a', 'btn', 'Open document');
      a.href = doc.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      actions.append(a);
      body.append(actions);
      body.append(el('p', 'reader-note', docNote(doc, node.sample)));
    }
    const c = connections(model, node.id);
    if (c.pov) chips(body, [c.pov], 'Belongs to');
    return h;
  }

  /** The document behind a graph node: nodes are d:<slug>/<position>, so the link lives in povs.json. */
  function docFor(node) {
    const i = Number(String(node.id).split('/').pop()) - 1;
    return povBySlug.get(node.ref)?.documents?.[i] ?? null;
  }
  const docNote = (d, sample) => `${hostLabel(d.host)}. ${sample ? 'Sample link: does not open a real document.' : 'May ask you to sign in.'}`;

  async function showPov(node) {
    const p = povBySlug.get(node.ref);
    const mine = ++token;
    const notes = el('div', 'reader-notes');
    if (p?.status === 'draft') notes.append(el('p', 'reader-draft', 'Draft: this view is still forming and is not the practice\'s agreed position.'));
    if (p?.sample) notes.append(el('p', 'reader-sample', 'Sample: this POV is fictional and says nothing about what the practice thinks.'));
    const kindWord = `${p?.type === 'document' ? 'Document' : 'POV'} \u00B7 ${p?.status === 'draft' ? 'Draft' : 'Agreed'}`;
    const { head, h } = header(kindWord, node.label, notes.childNodes.length ? notes : null);
    body.append(head);
    if (p?.summary) body.append(el('p', 'reader-lede', p.summary));
    if (p) body.append(el('p', 'reader-meta', `${p.author} \u00B7 ${prettyDate(p.date)}`));

    const text = el('div', 'reader-prose');
    text.append(el('p', 'reader-loading', 'Loading\u2026'));
    body.append(text);

    const actions = el('p', 'reader-actions');
    const full = el('a', 'btn ghost', 'Open full page');
    full.href = `../pov/${node.ref}/`;
    actions.append(full, shareButton(node.id));
    body.append(actions);
    if (deps.contactLine) body.append(el('p', 'reader-contact', deps.contactLine));

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
          const a = el('a', '', d.title);
          a.href = d.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          li.append(a, el('span', 'size', ` ${docNote(d, p?.sample)}`));
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
      else if (node.kind === 'term') heading = showTerm(node);
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
