// Share and cite buttons on a POV page. The citation is already on the page as
// text (inside a <details>), so this only adds the buttons: copy the link, copy
// the citation, and print or save as PDF. Without JavaScript the buttons stay
// hidden and the citation can still be read and copied by hand.

function flash(button, text) {
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.textContent = text;
  clearTimeout(Number(button.dataset.timer));
  button.dataset.timer = String(setTimeout(() => { button.textContent = button.dataset.label; }, 2000));
}

async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    flash(button, 'Copied');
  } catch {
    flash(button, 'Copy failed. Select the text yourself.');
  }
}

export function initShare() {
  for (const button of document.querySelectorAll('[data-share]')) {
    const kind = button.dataset.share;
    button.hidden = false;
    button.addEventListener('click', () => {
      if (kind === 'print') window.print();
      else if (kind === 'copy-link') copy(location.origin + location.pathname, button);
      else if (kind === 'copy-cite') copy(document.querySelector('[data-cite]')?.textContent ?? '', button);
    });
  }
  // A closed <details> prints without its contents, so open it for the printout.
  addEventListener('beforeprint', () => { for (const d of document.querySelectorAll('details.cite')) d.open = true; });
}
