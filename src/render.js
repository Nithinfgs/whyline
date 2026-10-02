import { truncate } from './util.js';

/**
 * @typedef {import('./analyze.js').FileReport} FileReport
 * @typedef {import('./analyze.js').LineReport} LineReport
 */

/** @param {boolean} enabled */
export function makeStyle(enabled) {
  /** @param {string} code */
  const wrap = (code) => (/** @type {string} */ s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);
  return {
    bold: wrap('1'),
    dim: wrap('2'),
    green: wrap('32'),
    yellow: wrap('33'),
    red: wrap('31'),
    cyan: wrap('36'),
    palette: ['36', '35', '33', '32', '34', '91', '95', '93'].map(wrap),
  };
}

/** @typedef {ReturnType<typeof makeStyle>} Style */

const TAGS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** @param {string} iso */
function day(iso) {
  return iso ? iso.slice(0, 10) : '?';
}
/** @param {string} iso */
function minute(iso) {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : '?';
}

/**
 * Group lines by the session that wrote them, ordered by first appearance in time.
 * @param {FileReport} report
 */
export function sessionLegend(report) {
  /** @type {Map<string, { id: string, first: string, prompt: string, lines: number }>} */
  const map = new Map();
  for (const l of report.lines) {
    if (!l.match) continue;
    const g = map.get(l.match.sessionId) ?? { id: l.match.sessionId, first: l.match.timestamp, prompt: l.match.prompt, lines: 0 };
    g.lines++;
    if (l.match.timestamp && l.match.timestamp < g.first) g.first = l.match.timestamp;
    map.set(l.match.sessionId, g);
  }
  return [...map.values()].sort((a, b) => a.first.localeCompare(b.first));
}

/**
 * Whole-file view: a provenance gutter next to every line.
 * @param {FileReport} report
 * @param {{ style: Style, width: number, summaryOnly?: boolean }} opts
 */
export function renderFileMap(report, { style, width, summaryOnly }) {
  const legend = sessionLegend(report);
  const tagOf = new Map(legend.map((g, i) => [g.id, TAGS[i] ?? '+']));
  const colorOf = (/** @type {string} */ id) => style.palette[[...tagOf.keys()].indexOf(id) % style.palette.length];
  const traced = report.lines.filter((l) => l.match).length;
  const nonBlank = report.lines.filter((l) => l.text.trim()).length;
  const untraced = report.lines.filter((l) => l.text.trim() && !l.match).length;
  const out = [];

  out.push(
    `${style.bold(report.file)}  ${style.dim('·')} ${report.lines.length} lines ${style.dim('·')} ` +
      `${traced} traced to ${legend.length} agent session${legend.length === 1 ? '' : 's'}` +
      (untraced > 0 ? ` ${style.dim('·')} ${untraced} untraced` : ''),
  );
  out.push('');

  if (!summaryOnly) {
    const numWidth = String(report.lines.length).length;
    for (const l of report.lines) {
      const tag = l.match ? colorOf(l.match.sessionId)(tagOf.get(l.match.sessionId) ?? '+') : style.dim('·');
      const sha = l.commit ? l.commit.sha.slice(0, 7) : style.dim('-------');
      const gutter = `${style.dim(sha)} ${tag} ${style.dim(String(l.line).padStart(numWidth))} ${style.dim('│')} `;
      const room = Math.max(20, width - (7 + 3 + numWidth + 3));
      out.push(gutter + truncate2(l.text, room));
    }
    out.push('');
  }

  for (const g of legend) {
    const tag = colorOf(g.id)(tagOf.get(g.id) ?? '+');
    const head = `${tag}  ${style.dim(minute(g.first))}  ${String(g.lines).padStart(3)} lines  `;
    out.push(head + style.bold(`“${truncate(g.prompt || '(prompt not found)', Math.max(20, width - 34))}”`));
  }
  if (legend.length === 0) {
    out.push(style.yellow(noMatchHint(report, nonBlank)));
  } else if (untraced > 0) {
    out.push(style.dim(`${style.dim('·')} no transcript edit matches these lines: written by hand, by another tool, or in a session whose transcript is gone`));
  }
  return out.join('\n');
}

/**
 * Truncate preserving indentation (unlike util.truncate, which flattens whitespace).
 * @param {string} s
 * @param {number} max
 */
function truncate2(s, max) {
  const t = s.replace(/\t/g, '  ');
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/** @param {FileReport} report @param {number} nonBlank */
function noMatchHint(report, nonBlank) {
  if (report.sessionsScanned === 0) {
    return 'No agent transcripts found for this repository. Looked in ~/.claude/projects (override with --transcripts DIR).';
  }
  if (report.editsIndexed === 0) {
    return `Scanned ${report.sessionsScanned} sessions, but none edited this file (${nonBlank} non-blank lines).`;
  }
  return `${report.editsIndexed} transcript edits touch this file, but none match its current lines.`;
}

/**
 * Detail cards for a line range: consecutive lines from the same edit share one card.
 * @param {FileReport} report
 * @param {number} from 1-based inclusive
 * @param {number} to   1-based inclusive
 * @param {{ style: Style, width: number }} opts
 */
export function renderLines(report, from, to, { style, width }) {
  const picked = report.lines.filter((l) => l.line >= from && l.line <= to);
  /** @type {LineReport[][]} */
  const groups = [];
  for (const l of picked) {
    const prev = groups[groups.length - 1];
    const last = prev?.[prev.length - 1];
    if (prev && last && sameOrigin(last, l)) prev.push(l);
    else groups.push([l]);
  }
  const out = [];
  const room = Math.max(30, width - 16);
  for (const g of groups) {
    const first = g[0];
    const lastLine = g[g.length - 1].line;
    const range = first.line === lastLine ? `${report.file}:${first.line}` : `${report.file}:${first.line}-${lastLine}`;
    out.push(style.bold(range));
    for (const l of g.slice(0, 4)) out.push(`  ${style.dim(String(l.line).padStart(4))} ${style.dim('│')} ${truncate2(l.text, room - 8)}`);
    if (g.length > 4) out.push(`  ${style.dim(`     … ${g.length - 4} more lines`)}`);
    out.push('');
    const label = (/** @type {string} */ k) => style.dim(k.padEnd(11));
    out.push(`  ${label('commit')}${commitLine(first, room)}`);
    if (first.match) {
      const m = first.match;
      out.push(`  ${label('written')}${m.tool} in agent session ${style.cyan(m.sessionId.slice(0, 8))} at ${minute(m.timestamp)}`);
      out.push(`  ${label('prompt')}${style.bold(`“${truncate(m.prompt || '(prompt not found)', room - 12)}”`)}`);
      if (m.said) out.push(`  ${label('agent said')}${truncate(m.said, room - 12)}`);
      out.push(`  ${label('confidence')}${confidenceLabel(first, style)}`);
    } else {
      out.push(`  ${label('written')}${style.yellow('no matching transcript edit')} ${style.dim('(by hand, another tool, or transcript missing)')}`);
    }
    out.push('');
  }
  return out.join('\n').trimEnd();
}

/** @param {LineReport} a @param {LineReport} b */
function sameOrigin(a, b) {
  if (!a.match || !b.match) return !a.match && !b.match && a.commit?.sha === b.commit?.sha;
  return a.match.sessionId === b.match.sessionId && a.match.timestamp === b.match.timestamp;
}

/** @param {LineReport} l @param {number} room */
function commitLine(l, room) {
  if (!l.commit) return 'not committed yet';
  return truncate(`${l.commit.sha.slice(0, 7)}  “${l.commit.summary}”  ·  ${l.commit.author}  ·  ${day(l.commit.date)}`, room);
}

/** @param {LineReport} l @param {Style} style */
function confidenceLabel(l, style) {
  if (!l.match) return '';
  const m = l.match;
  const paint = m.confidence === 'high' ? style.green : m.confidence === 'medium' ? style.yellow : style.red;
  const why = `${m.score === 1 ? 'line text' : `${m.score}-line context`} matches the edit`;
  const alt = m.alternatives > 0 ? `; ${m.alternatives} other session${m.alternatives === 1 ? '' : 's'} wrote identical text` : '';
  return `${paint(m.confidence)} ${style.dim(`(${why}${alt})`)}`;
}
