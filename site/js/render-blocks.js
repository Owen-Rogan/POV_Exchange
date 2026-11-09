// Turns the build's parsed blocks into DOM nodes for the reader panel.
//
// Only createElement / createTextNode / setAttribute are used, so nothing from
// the content is ever parsed as HTML. `doc` is a document (or a test stand-in
// with the same few methods), which lets a test render the same blocks here and
// in the build and compare the two outputs.
//
// Links were already checked at build time; they are checked again here, so a
// block that did not come from the build still cannot make a non-https link.

const SAFE_HREF = /^https:\/\/[^\s"'<>]+$/;

function appendInline(doc, parent, nodes) {
  for (const n of nodes) {
    switch (n.t) {
      case 'text':
        parent.append(doc.createTextNode(n.v));
        break;
      case 'code': {
        const el = doc.createElement('code');
        el.append(doc.createTextNode(n.v));
        parent.append(el);
        break;
      }
      case 'strong':
      case 'em': {
        const el = doc.createElement(n.t);
        appendInline(doc, el, n.c);
        parent.append(el);
        break;
      }
      case 'link': {
        if (!SAFE_HREF.test(n.href ?? '')) { appendInline(doc, parent, n.c); break; }
        const el = doc.createElement('a');
        el.setAttribute('href', n.href);
        el.setAttribute('rel', 'noopener noreferrer');
        appendInline(doc, el, n.c);
        parent.append(el);
        break;
      }
      default:
        throw new Error('unknown inline node');
    }
  }
}

/** @returns the elements for these blocks, in order, as an array (append them wherever needed) */
export function renderBlocks(doc, blocks) {
  const out = [];
  for (const b of blocks) {
    let el;
    switch (b.t) {
      case 'h':
        el = doc.createElement(`h${b.level === 2 ? 3 : 4}`); // the reader's own title is the h2, so POV headings sit one level lower
        appendInline(doc, el, b.c);
        break;
      case 'p':
        el = doc.createElement('p');
        appendInline(doc, el, b.c);
        break;
      case 'quote': {
        el = doc.createElement('blockquote');
        const p = doc.createElement('p');
        appendInline(doc, p, b.c);
        el.append(p);
        break;
      }
      case 'ul':
      case 'ol':
        el = doc.createElement(b.t);
        for (const item of b.items) {
          const li = doc.createElement('li');
          appendInline(doc, li, item);
          el.append(li);
        }
        break;
      default:
        throw new Error('unknown block');
    }
    out.push(el);
  }
  return out;
}
