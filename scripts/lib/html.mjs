// The one place text is escaped for HTML and SVG. Every value the build puts
// into a page goes through esc(). Nothing else builds markup from content.

const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => MAP[c]);
