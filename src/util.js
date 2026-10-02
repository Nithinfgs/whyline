import { execFileSync } from 'node:child_process';

/** Error with a message that is safe to print directly to the user. */
export class UserError extends Error {}

/**
 * Run git and return stdout. Throws UserError with git's own message on failure.
 * @param {string[]} args
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} [env]
 */
export function git(args, cwd, env) {
  try {
    return execFileSync('git', args, {
      cwd,
      env: env ?? process.env,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const e = /** @type {{ stderr?: Buffer | string, code?: string }} */ (err);
    if (e.code === 'ENOENT') throw new UserError('git was not found on PATH.');
    const detail = String(e.stderr ?? '').trim();
    throw new UserError(detail || `git ${args[0]} failed`);
  }
}

/**
 * Normalise a source line for comparison: indentation and trailing space are ignored.
 * @param {string} line
 */
export function norm(line) {
  return line.trim();
}

/**
 * True for lines that carry no identity on their own: blank, or only punctuation.
 * @param {string} line
 */
export function isTrivial(line) {
  return norm(line).length <= 2 || !/[A-Za-z0-9]/.test(line);
}

/**
 * @param {string} s
 * @param {number} max
 */
export function truncate(s, max) {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1))}…`;
}
