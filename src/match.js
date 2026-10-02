import { isTrivial, norm } from './util.js';

/**
 * @typedef {import('./transcripts.js').Session} Session
 * @typedef {import('./transcripts.js').EditEvent} EditEvent
 * @typedef {import('./blame.js').BlameLine} BlameLine
 *
 * @typedef {Object} IndexedEvent
 * @property {EditEvent} event
 * @property {{ text: string, added: boolean }[]} lines   normalised lines of the new text
 *
 * @typedef {'high'|'medium'|'low'} Confidence
 *
 * @typedef {Object} Match
 * @property {EditEvent} event
 * @property {Session} session
 * @property {number} score        1 (the line alone) to 5 (line plus two neighbours each side)
 * @property {Confidence} confidence
 * @property {boolean} timeFits    the edit happened before the commit that introduced the line
 * @property {number} alternatives other edits that could equally have produced the line
 */

/** How long after an edit a commit may still be "the commit for that edit" is unbounded; how far
 *  *before* the edit it may be is not: a commit older than the edit cannot contain it. */
const CLOCK_SLACK_MS = 15 * 60 * 1000;

/**
 * Lines of `next` that were not already present in `prev` (multiset difference).
 * @param {string[]} prev
 * @param {string[]} next
 * @returns {boolean[]} per line of `next`: true when the edit introduced it
 */
export function addedLines(prev, next) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const l of prev) counts.set(l, (counts.get(l) ?? 0) + 1);
  return next.map((l) => {
    const c = counts.get(l) ?? 0;
    if (c > 0) {
      counts.set(l, c - 1);
      return false;
    }
    return true;
  });
}

/**
 * Convert a path recorded by the agent into a repo-relative path, or null if it is elsewhere.
 * @param {string} file
 * @param {string[]} roots  accepted spellings of the repo root
 */
export function relativeTo(file, roots) {
  const f = file.replace(/\\/g, '/');
  for (const r of roots) {
    const root = r.replace(/\\/g, '/').replace(/\/$/, '');
    if (f.startsWith(`${root}/`)) return f.slice(root.length + 1);
  }
  return null;
}

/**
 * Replay every recorded edit in time order, tracking file content where known so that a
 * whole-file Write only gets credit for lines that were not already there.
 * @param {Session[]} sessions
 * @param {string[]} roots  accepted spellings of the repo root
 * @returns {Map<string, IndexedEvent[]>}  repo-relative file -> events, oldest first
 */
export function buildIndex(sessions, roots) {
  /** @type {EditEvent[]} */
  const all = [];
  for (const s of sessions) all.push(...s.events);
  all.sort((a, b) => (a.ts || 0) - (b.ts || 0) || a.seq - b.seq);

  /** @type {Map<string, string>} */
  const state = new Map();
  /** @type {Map<string, IndexedEvent[]>} */
  const byFile = new Map();

  for (const ev of all) {
    const rel = relativeTo(ev.file, roots);
    if (rel === null) continue;

    const known = state.get(rel);
    let prevText = ev.oldText;
    if (ev.tool === 'Write') prevText = known ?? '';
    const nextLines = ev.newText.split('\n').map(norm);
    const flags = addedLines(prevText.split('\n').map(norm), nextLines);

    if (ev.tool === 'Write') state.set(rel, ev.newText);
    else if (known !== undefined && ev.oldText && known.includes(ev.oldText)) {
      state.set(rel, known.replace(ev.oldText, () => ev.newText));
    } else if (known !== undefined && !ev.oldText) {
      state.set(rel, known + ev.newText);
    } else {
      state.delete(rel); // we lost track of the file (edited outside the transcripts)
    }

    const list = byFile.get(rel) ?? [];
    list.push({ event: ev, lines: nextLines.map((text, i) => ({ text, added: flags[i] })) });
    byFile.set(rel, list);
  }
  return byFile;
}

/**
 * Find the edit that most plausibly produced line `i` of `current`.
 * Ranking: the edit predates the commit, then the longest run of identical neighbouring
 * lines, then the most recent.
 * @param {IndexedEvent[]} events
 * @param {string[]} current          normalised lines of the file as it is now
 * @param {number} i                  0-based
 * @param {number} commitTime         epoch ms, NaN if uncommitted
 * @param {Map<string, Session>} sessionById
 * @returns {Match|null}
 */
export function matchLine(events, current, i, commitTime, sessionById) {
  const target = current[i];
  if (!target) return null;
  const trivial = isTrivial(target);

  /** @type {{ ie: IndexedEvent, score: number, fits: boolean }[]} */
  const candidates = [];
  for (const ie of events) {
    let best = 0;
    for (let j = 0; j < ie.lines.length; j++) {
      const l = ie.lines[j];
      if (!l.added || l.text !== target) continue;
      let score = 1;
      for (let k = 1; k <= 2 && i - k >= 0 && j - k >= 0 && current[i - k] === ie.lines[j - k].text; k++) score++;
      for (let k = 1; k <= 2 && i + k < current.length && j + k < ie.lines.length && current[i + k] === ie.lines[j + k].text; k++) score++;
      if (score > best) best = score;
    }
    if (best === 0) continue;
    const fits = Number.isNaN(commitTime) || Number.isNaN(ie.event.ts) || ie.event.ts <= commitTime + CLOCK_SLACK_MS;
    candidates.push({ ie, score: best, fits });
  }
  if (candidates.length === 0) return null;

  candidates.sort(
    (a, b) =>
      Number(b.fits) - Number(a.fits) ||
      b.score - a.score ||
      (b.ie.event.ts || 0) - (a.ie.event.ts || 0) ||
      b.ie.event.seq - a.ie.event.seq,
  );
  const top = candidates[0];
  if (trivial && top.score < 3) return null;

  const session = sessionById.get(top.ie.event.sessionFile);
  if (!session) return null;
  const alternatives = candidates.filter(
    (c) => c !== top && c.fits === top.fits && c.score === top.score && c.ie.event.sessionId !== top.ie.event.sessionId,
  ).length;

  return {
    event: top.ie.event,
    session,
    score: top.score,
    confidence: confidenceOf(top.score, top.fits, target, alternatives),
    timeFits: top.fits,
    alternatives,
  };
}

/**
 * @param {number} score
 * @param {boolean} fits
 * @param {string} line
 * @param {number} alternatives
 * @returns {Confidence}
 */
function confidenceOf(score, fits, line, alternatives) {
  if (!fits) return 'low';
  const distinctive = line.length >= 25;
  if (score >= 4 && alternatives === 0) return 'high';
  if (score >= 3 && alternatives === 0) return distinctive ? 'high' : 'medium';
  if (score >= 2 || distinctive) return alternatives === 0 ? 'medium' : 'low';
  return 'low';
}
