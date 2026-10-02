import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * @typedef {Object} Prompt
 * @property {number} ts        epoch ms (NaN when the transcript has no timestamp)
 * @property {string} text
 *
 * @typedef {Object} EditEvent
 * @property {string} sessionId
 * @property {string} sessionFile
 * @property {number} ts        epoch ms
 * @property {number} seq       order within the session file
 * @property {'Edit'|'Write'} tool
 * @property {string} file      absolute path as recorded by the agent
 * @property {string} oldText    '' for Write
 * @property {string} newText
 * @property {number} promptIndex  index into Session.prompts, -1 when none precedes the edit
 * @property {string} said       the last thing the agent wrote in prose before this edit
 *
 * @typedef {Object} Session
 * @property {string} id
 * @property {string} file
 * @property {string} cwd
 * @property {number} startTs
 * @property {Prompt[]} prompts
 * @property {EditEvent[]} events
 * @property {number} skippedLines
 */

/** Claude Code names a project's transcript directory after its path, non-alphanumerics replaced by '-'. */
/** @param {string} p */
export function encodeProjectPath(p) {
  return p.replace(/[^a-zA-Z0-9]/g, '-');
}

/** @param {NodeJS.ProcessEnv} [env] */
export function defaultTranscriptRoot(env = process.env) {
  if (env.WHYLINE_TRANSCRIPTS) return env.WHYLINE_TRANSCRIPTS;
  const config = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(config, 'projects');
}

/**
 * Locate session files for a repository.
 * @param {string} transcriptRoot  ~/.claude/projects, or a directory containing .jsonl files directly
 * @param {string[]} repoRoots     real and raw spellings of the repo root
 * @param {{ explicit?: boolean }} [opts] explicit: the user pointed at this directory, so do not filter by repo
 * @returns {string[]}
 */
export function findSessionFiles(transcriptRoot, repoRoots, opts = {}) {
  /** @type {fs.Dirent[]} */
  let entries;
  try {
    entries = fs.readdirSync(transcriptRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  const directFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl'));
  for (const e of directFiles) files.push(path.join(transcriptRoot, e.name));

  // Sessions launched inside the repo (or a worktree of it) share its encoded prefix; sessions
  // launched in a parent directory are named after an ancestor. Edits are filtered by path later.
  const prefixes = repoRoots.map(encodeProjectPath);
  const ancestors = new Set(repoRoots.flatMap(ancestorsOf).map(encodeProjectPath));
  for (const dir of entries.filter((e) => e.isDirectory())) {
    const matches =
      opts.explicit || ancestors.has(dir.name) || prefixes.some((p) => dir.name === p || dir.name.startsWith(`${p}-`));
    if (!matches) continue;
    const full = path.join(transcriptRoot, dir.name);
    for (const f of safeReaddir(full)) {
      if (f.endsWith('.jsonl')) files.push(path.join(full, f));
    }
  }
  return files;
}

/** @param {string} p absolute path; returns every proper ancestor except the filesystem root */
function ancestorsOf(p) {
  const out = [];
  for (let d = path.dirname(p); d !== path.dirname(d); d = path.dirname(d)) out.push(d);
  return out;
}

/** @param {string} dir */
function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

const NOISE_BLOCKS = /<(system-reminder|command-name|command-message|command-args|local-command-stdout|local-command-caveat|ide_[a-z_]+)>[\s\S]*?<\/\1>/g;

/**
 * Extract the human-typed text of a user entry, or null if the entry is
 * tool output, injected context, or a slash-command echo.
 * @param {any} entry
 */
export function promptText(entry) {
  if (entry.isSidechain || entry.isMeta) return null;
  const content = entry.message?.content;
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    if (content.some((b) => b?.type === 'tool_result')) return null;
    text = content
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
  } else {
    return null;
  }
  text = text.replace(NOISE_BLOCKS, '').trim();
  if (!text || text.startsWith('[Request interrupted')) return null;
  return text;
}

/**
 * Parse one session transcript. Unknown entry types and malformed lines are
 * skipped, so format drift degrades results instead of crashing.
 * @param {string} file
 * @returns {Session}
 */
export function parseSession(file) {
  const raw = fs.readFileSync(file, 'utf8');
  /** @type {Session} */
  const session = {
    id: path.basename(file, '.jsonl'),
    file,
    cwd: '',
    startTs: NaN,
    prompts: [],
    events: [],
    skippedLines: 0,
  };
  let promptIndex = -1;
  let said = '';
  let seq = 0;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    /** @type {any} */
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      session.skippedLines++;
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    if (entry.sessionId) session.id = String(entry.sessionId);
    if (!session.cwd && typeof entry.cwd === 'string') session.cwd = entry.cwd;
    const ts = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
    if (Number.isNaN(session.startTs) && !Number.isNaN(ts)) session.startTs = ts;

    if (entry.type === 'user') {
      const text = promptText(entry);
      if (text !== null) {
        session.prompts.push({ ts, text });
        promptIndex = session.prompts.length - 1;
        said = '';
      }
    } else if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
      for (const block of entry.message.content) {
        if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          said = block.text.trim();
        } else if (block?.type === 'tool_use') {
          for (const ev of toEvents(block, { session, ts, seq, promptIndex, said })) {
            session.events.push(ev);
            seq++;
          }
        }
      }
    }
  }
  return session;
}

/**
 * @param {any} block
 * @param {{ session: Session, ts: number, seq: number, promptIndex: number, said: string }} ctx
 * @returns {EditEvent[]}
 */
function toEvents(block, ctx) {
  const input = block.input;
  if (!input || typeof input !== 'object') return [];
  const file = input.file_path ?? input.path;
  if (typeof file !== 'string') return [];
  const base = {
    sessionId: ctx.session.id,
    sessionFile: ctx.session.file,
    ts: ctx.ts,
    promptIndex: ctx.promptIndex,
    said: ctx.said,
    file,
  };
  if (block.name === 'Write' && typeof input.content === 'string') {
    return [{ ...base, seq: ctx.seq, tool: 'Write', oldText: '', newText: input.content }];
  }
  if (block.name === 'Edit' && typeof input.new_string === 'string') {
    return [{ ...base, seq: ctx.seq, tool: 'Edit', oldText: String(input.old_string ?? ''), newText: input.new_string }];
  }
  if (block.name === 'MultiEdit' && Array.isArray(input.edits)) {
    return input.edits
      .filter((/** @type {any} */ e) => e && typeof e.new_string === 'string')
      .map((/** @type {any} */ e, /** @type {number} */ i) => ({
        ...base,
        seq: ctx.seq + i,
        tool: /** @type {const} */ ('Edit'),
        oldText: String(e.old_string ?? ''),
        newText: e.new_string,
      }));
  }
  return [];
}

/**
 * @param {string[]} files
 * @returns {Session[]}
 */
export function loadSessions(files) {
  const sessions = [];
  for (const f of files) {
    try {
      sessions.push(parseSession(f));
    } catch {
      // unreadable file: ignore, other sessions may still explain the line
    }
  }
  return sessions;
}
