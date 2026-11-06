// Text rules shared by every file the build reads. Each rule reports the line
// number and a fixed message, never the matched text.

// Zero-width, bidirectional-override and other invisible formatting characters:
// U+061C, U+200B-U+200F, U+202A-U+202E, U+2060-U+2064, U+2066-U+2069, U+FEFF.
const INVISIBLE = new RegExp(
  '[\\u061C\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF]',
);

const RULES = [
  ['contains an email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/],
  // Slack user/channel/team IDs: a leading letter, 8-11 more capitals/digits, at least one digit.
  ['looks like a Slack ID', /\b[UWCTDB](?=[A-Z0-9]*\d)[A-Z0-9]{8,11}\b/],
  [
    'looks like an access token or key',
    /\b(?:xox[abposr]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/,
  ],
  ['contains a private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  [
    'contains a webhook URL',
    /hooks\.slack\.com\/(?:services|triggers|workflows)|webhook\.office\.com|outlook\.office\.com\/webhook|discord(?:app)?\.com\/api\/webhooks/i,
  ],
  ['contains control characters', /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/],
  ['contains bidirectional or invisible formatting characters', INVISIBLE],
];

const RAW_HTML = ['contains raw HTML or an <autolink> (use plain text or [text](https://...))', /<[A-Za-z/!?]/];

/**
 * @param {string} text normalised text (LF newlines)
 * @param {{html?: boolean}} opts html: also reject raw HTML (for markdown/front matter)
 * @returns {Array<{line:number, rule:string}>} first occurrence of each rule
 */
export function scanText(text, { html = false } = {}) {
  const rules = html ? [...RULES, RAW_HTML] : RULES;
  const found = new Map();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const [rule, re] of rules) {
      if (found.has(rule)) continue;
      // Inline code spans may legitimately contain "<". They are escaped on output.
      const subject = rule === RAW_HTML[0] ? lines[i].replace(/`[^`]*`/g, '``') : lines[i];
      if (re.test(subject)) found.set(rule, i + 1);
    }
  }
  return [...found].map(([rule, line]) => ({ line, rule }));
}

export const hasInvisible = (s) => INVISIBLE.test(s);
