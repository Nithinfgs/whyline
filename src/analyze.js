import fs from 'node:fs';
import { blameFile, repoRoot, toRepoRelative } from './blame.js';
import { buildIndex, matchLine } from './match.js';
import { redact } from './redact.js';
import { defaultTranscriptRoot, findSessionFiles, loadSessions } from './transcripts.js';
import { norm } from './util.js';

/**
 * @typedef {Object} LineReport
 * @property {number} line
 * @property {string} text
 * @property {{ sha: string, author: string, date: string, summary: string }|null} commit
 * @property {{ sessionId: string, tool: string, timestamp: string, prompt: string, said: string,
 *              confidence: 'high'|'medium'|'low', score: number, alternatives: number }|null} match
 *
 * @typedef {Object} FileReport
 * @property {string} file
 * @property {number} sessionsScanned
 * @property {number} editsIndexed    edits to this file found in transcripts
 * @property {LineReport[]} lines
 */

/**
 * @param {Object} opts
 * @param {string} opts.file                 path as typed by the user
 * @param {string} [opts.cwd]
 * @param {string} [opts.transcripts]        directory override
 * @returns {FileReport}
 */
export function analyzeFile(opts) {
  const cwd = opts.cwd ?? process.cwd();
  const root = repoRoot(cwd);
  const rel = toRepoRelative(root, cwd, opts.file);
  const blame = blameFile(root, rel);

  const roots = unique([root, ...rawSpellings(cwd, root)]);
  const transcriptRoot = opts.transcripts ?? defaultTranscriptRoot();
  const files = findSessionFiles(transcriptRoot, roots, { explicit: Boolean(opts.transcripts) });
  const sessions = loadSessions(files);
  const byFile = buildIndex(sessions, roots);
  const events = byFile.get(rel) ?? [];
  const sessionByFile = new Map(sessions.map((s) => [s.file, s]));

  const current = blame.map((b) => norm(b.text));
  /** @type {LineReport[]} */
  const lines = blame.map((b, i) => {
    const m = events.length ? matchLine(events, current, i, b.authorTime, sessionByFile) : null;
    const prompt = m ? m.session.prompts[m.event.promptIndex] : undefined;
    return {
      line: b.line,
      text: b.text,
      commit: b.sha
        ? { sha: b.sha, author: b.author, date: new Date(b.authorTime).toISOString(), summary: b.summary }
        : null,
      match: m
        ? {
            sessionId: m.event.sessionId,
            tool: m.event.tool,
            timestamp: Number.isNaN(m.event.ts) ? '' : new Date(m.event.ts).toISOString(),
            prompt: redact(prompt?.text ?? ''),
            said: redact(m.event.said),
            confidence: m.confidence,
            score: m.score,
            alternatives: m.alternatives,
          }
        : null,
    };
  });

  return { file: rel, sessionsScanned: sessions.length, editsIndexed: events.length, lines };
}

/** @param {string[]} xs */
function unique(xs) {
  return [...new Set(xs)];
}

/**
 * Agents record the path they were launched with, which may be a symlinked spelling.
 * @param {string} cwd
 * @param {string} root
 */
function rawSpellings(cwd, root) {
  /** @type {string[]} */
  const out = [];
  const pwd = process.env.PWD;
  if (pwd && fs.existsSync(pwd) && fs.realpathSync(pwd) === fs.realpathSync(cwd)) {
    // Strip the cwd's offset from the repo root to recover the unresolved root spelling.
    const real = fs.realpathSync(cwd);
    if (real.startsWith(root)) out.push(pwd.slice(0, pwd.length - (real.length - root.length)));
  }
  if (root.startsWith('/private/')) out.push(root.slice('/private'.length));
  return out;
}
