// The date slider: maps a slider position to a date cut-off and back.
//
// Positions are spread over the distinct dates in the content, not over calendar
// time, so ten POVs written in one week and two written a year later still move
// smoothly. Position 0 shows the earliest date; the maximum shows everything.

/** Sorted, de-duplicated YYYY-MM-DD dates from the POV nodes. */
export function distinctDates(nodes) {
  return [...new Set(nodes.filter((n) => n.kind === 'pov' && n.date).map((n) => n.date))].sort();
}

/**
 * @param {string[]} dates sorted distinct dates
 * @returns {{max:number, dateAt:(pos:number)=>string|null, posOf:(date:string)=>number, usable:boolean}}
 */
export function makeTimeline(dates) {
  const max = Math.max(0, dates.length - 1);
  return {
    max,
    // The slider needs at least two different dates to mean anything.
    usable: dates.length >= 2,
    dateAt(pos) {
      if (!dates.length) return null;
      const i = Math.min(max, Math.max(0, Math.round(pos)));
      return dates[i];
    },
    posOf(date) {
      let best = 0;
      dates.forEach((d, i) => { if (d <= date) best = i; });
      return best;
    },
  };
}

/** "5 Jan 2026" from "2026-01-05". Anything unexpected is returned unchanged. */
export function prettyDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!m) return String(date ?? '');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}
