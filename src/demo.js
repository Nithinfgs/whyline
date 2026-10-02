import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from './util.js';
import { encodeProjectPath } from './transcripts.js';

// Builds a throwaway git repository plus matching Claude Code-style transcripts, so
// `whyline --demo` shows real output with no setup. Everything is synthetic.

const V1 = `export async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
`;

/**
 * @typedef {Object} Step
 * @property {string} session
 * @property {string} start      ISO timestamp of the prompt
 * @property {string} commitAt   ISO timestamp of the commit
 * @property {string} prompt
 * @property {string} said
 * @property {{ tool: 'Write'|'Edit', old?: string, next: string }[]} edits
 * @property {string} commitMessage
 * @property {{ name: string, apply?: (s: string) => string }} [human]  a manual edit instead of an agent
 */

/** @type {Step[]} */
const STEPS = [
  {
    session: '7e4d1a90-3c5b-4f0e-9a21-5b8c0d6e7f11',
    start: '2026-09-12T14:01:10Z',
    commitAt: '2026-09-12T14:06:00Z',
    prompt: 'add a fetchWithRetry helper that retries failed requests',
    said: "I'll add a small helper that retries network failures up to three times.",
    edits: [{ tool: 'Write', next: V1 }],
    commitMessage: 'add fetchWithRetry',
  },
  {
    session: 'b2c9f6d3-81aa-4d17-bb64-0f3e9a2c5d88',
    start: '2026-09-15T10:20:41Z',
    commitAt: '2026-09-15T10:31:00Z',
    prompt: "retries hammer the API when it's down. add exponential backoff with jitter, capped at 30s",
    said: 'Backoff doubles from 200ms and is capped at 30s; jitter spreads out clients that failed together.',
    edits: [
      {
        tool: 'Edit',
        old: 'export async function fetchWithRetry(url, attempts = 3) {',
        next: `const BASE_MS = 200;
const CAP_MS = 30_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchWithRetry(url, attempts = 3) {`,
      },
      {
        tool: 'Edit',
        old: '      lastError = err;\n    }',
        next: `      lastError = err;
      const backoff = Math.min(BASE_MS * 2 ** i, CAP_MS);
      await sleep(backoff * (0.5 + Math.random() / 2));
    }`,
      },
    ],
    commitMessage: 'retry: exponential backoff with jitter',
  },
  {
    session: '',
    start: '',
    commitAt: '2026-09-16T09:12:00Z',
    prompt: '',
    said: '',
    edits: [],
    commitMessage: 'lower retry cap, 30s felt broken in the UI',
    human: { name: 'Maya Chen', apply: (s) => s.replace('30_000', '10_000') },
  },
  {
    session: 'e5a07c12-9d3f-48b6-a1c4-72f0b3d9e604',
    start: '2026-09-20T16:44:05Z',
    commitAt: '2026-09-20T16:52:00Z',
    prompt: "don't retry on 4xx, those will never succeed",
    said: 'Client errors are now returned immediately; only 5xx responses and network failures are retried.',
    edits: [
      {
        tool: 'Edit',
        old: '      return await fetch(url);',
        next: `      const res = await fetch(url);
      if (res.status < 500) return res; // 4xx never succeeds on retry
      throw new Error(\`HTTP \${res.status}\`);`,
      },
    ],
    commitMessage: 'retry: do not retry client errors',
  },
];

/** @param {number} n */
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * @param {string} [baseDir] defaults to a fresh temp directory
 * @returns {{ repo: string, transcripts: string, file: string }}
 */
export function createDemo(baseDir) {
  const base = fs.realpathSync(baseDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'whyline-demo-')));
  const repo = path.join(base, 'api-client');
  const transcripts = path.join(base, 'transcripts', encodeProjectPath(repo));
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(transcripts, { recursive: true });
  const file = path.join(repo, 'src', 'retry.js');
  const env = (/** @type {string} */ date, /** @type {string} */ name) => ({
    ...process.env,
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: 'demo@example.com',
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: 'demo@example.com',
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
  const commit = (/** @type {Step} */ step, /** @type {string} */ name) => {
    git(['add', '-A'], repo);
    git(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', step.commitMessage], repo, env(step.commitAt, name));
  };
  git(['init', '-q', '-b', 'main'], repo);

  let content = '';
  let n = 0;
  for (const step of STEPS) {
    if (step.human) {
      content = step.human.apply?.(content) ?? content;
      fs.writeFileSync(file, content);
      commit(step, step.human.name);
      continue;
    }
    /** @type {string[]} */
    const lines = [];
    const push = (/** @type {any} */ o) => lines.push(JSON.stringify({ ...o, sessionId: step.session, cwd: repo, isSidechain: false }));
    const start = Date.parse(step.start);
    push({ type: 'user', uuid: uuid(++n), timestamp: step.start, message: { role: 'user', content: step.prompt } });
    push({
      type: 'assistant',
      uuid: uuid(++n),
      timestamp: new Date(start + 4000).toISOString(),
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: step.said }] },
    });
    step.edits.forEach((e, i) => {
      const ts = new Date(start + 8000 + i * 6000).toISOString();
      const input =
        e.tool === 'Write'
          ? { file_path: file, content: e.next }
          : { file_path: file, old_string: e.old, new_string: e.next };
      push({
        type: 'assistant',
        uuid: uuid(++n),
        timestamp: ts,
        message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_${n}`, name: e.tool, input }] },
      });
      push({
        type: 'user',
        uuid: uuid(++n),
        timestamp: ts,
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${n - 1}`, content: 'ok' }] },
      });
      content = e.tool === 'Write' ? e.next : content.replace(/** @type {string} */ (e.old), () => e.next);
    });
    fs.writeFileSync(file, content);
    fs.writeFileSync(path.join(transcripts, `${step.session}.jsonl`), `${lines.join('\n')}\n`);
    commit(step, 'Maya Chen');
  }
  return { repo, transcripts: path.dirname(transcripts), file: 'src/retry.js' };
}
