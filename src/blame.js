import fs from 'node:fs';
import path from 'node:path';
import { git, UserError } from './util.js';

/**
 * @typedef {Object} BlameLine
 * @property {number} line        1-based
 * @property {string} text
 * @property {string|null} sha    null when the line is not committed yet
 * @property {string} author
 * @property {number} authorTime  epoch ms (Infinity-safe: NaN when uncommitted)
 * @property {string} summary
 */

/** @param {string} cwd */
export function repoRoot(cwd) {
  try {
    return fs.realpathSync(git(['rev-parse', '--show-toplevel'], cwd).trim());
  } catch {
    throw new UserError('Not inside a git repository.');
  }
}

/**
 * Resolve a user-supplied path to a repo-relative, forward-slash path.
 * @param {string} root real path of the repo root
 * @param {string} cwd
 * @param {string} input
 */
export function toRepoRelative(root, cwd, input) {
  const abs = path.resolve(cwd, input);
  let real = abs;
  try {
    real = fs.realpathSync(abs);
  } catch {
    throw new UserError(`No such file: ${input}`);
  }
  const rel = path.relative(root, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new UserError(`${input} is outside the repository at ${root}`);
  }
  return rel.split(path.sep).join('/');
}

/**
 * Blame a file (working tree included, so uncommitted edits are reported as such).
 * @param {string} root
 * @param {string} relFile
 * @returns {BlameLine[]}
 */
export function blameFile(root, relFile) {
  const out = git(['blame', '--line-porcelain', '--', relFile], root);
  /** @type {BlameLine[]} */
  const lines = [];
  /** @type {Partial<BlameLine> & { rawSha?: string }} */
  let cur = {};
  for (const l of out.split('\n')) {
    if (l.startsWith('\t')) {
      const uncommitted = /^0+$/.test(cur.rawSha ?? '');
      lines.push({
        line: /** @type {number} */ (cur.line),
        text: l.slice(1),
        sha: uncommitted ? null : /** @type {string} */ (cur.rawSha),
        author: uncommitted ? 'Not committed yet' : (cur.author ?? ''),
        authorTime: uncommitted ? NaN : (cur.authorTime ?? NaN),
        summary: uncommitted ? '' : (cur.summary ?? ''),
      });
      cur = {};
      continue;
    }
    const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(l);
    if (header) {
      cur.rawSha = header[1];
      cur.line = Number(header[2]);
    } else if (l.startsWith('author ')) cur.author = l.slice(7);
    else if (l.startsWith('author-time ')) cur.authorTime = Number(l.slice(12)) * 1000;
    else if (l.startsWith('summary ')) cur.summary = l.slice(8);
  }
  return lines;
}
