import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { analyzeFile } from '../src/analyze.js';
import { parseArgs, parseTarget, run } from '../src/cli.js';
import { demoRepo } from './helpers.js';

function capture(argv, cwd) {
  let out = '';
  let err = '';
  const code = run(argv, { stdout: (s) => (out += s), stderr: (s) => (err += s), cwd });
  return { code, out, err };
}

test('demo repo: every line is attributed to the right session, and the human edit is not', () => {
  const d = demoRepo();
  try {
    const r = analyzeFile({ file: d.file, cwd: d.repo, transcripts: d.transcripts });
    const by = (n) => r.lines[n - 1].match;
    assert.equal(r.sessionsScanned, 3);
    assert.equal(by(6)?.sessionId.slice(0, 4), '7e4d'); // function signature: session 1
    assert.equal(by(1)?.sessionId.slice(0, 4), 'b2c9'); // BASE_MS: session 2
    assert.equal(by(2), null); // CAP_MS=10_000 was typed by a human
    assert.equal(by(11)?.sessionId.slice(0, 4), 'e5a0'); // 4xx guard: session 3
    assert.equal(by(14)?.sessionId.slice(0, 4), '7e4d'); // `lastError = err` was inside session 2's edit but not authored by it
    assert.match(by(15)?.prompt ?? '', /exponential backoff/);
    assert.equal(by(15)?.confidence, 'high');
    assert.equal(r.lines[1].commit?.author, 'Maya Chen');
  } finally {
    d.cleanup();
  }
});

test('uncommitted working-tree edits are reported as not committed', () => {
  const d = demoRepo();
  try {
    fs.appendFileSync(`${d.repo}/${d.file}`, 'export const local = 1;\n');
    const r = analyzeFile({ file: d.file, cwd: d.repo, transcripts: d.transcripts });
    const last = r.lines[r.lines.length - 1];
    assert.equal(last.commit, null);
    assert.equal(last.match, null);
  } finally {
    d.cleanup();
  }
});

test('cli: line range card, json output and file map', () => {
  const d = demoRepo();
  try {
    const card = capture([`${d.file}:14-15`, '--no-color', '--transcripts', d.transcripts], d.repo);
    assert.equal(card.code, 0);
    assert.match(card.out, /prompt\s+“add a fetchWithRetry helper/);
    assert.match(card.out, /prompt\s+“retries hammer the API/);

    const json = capture([`${d.file}:15`, '--json', '--transcripts', d.transcripts], d.repo);
    const parsed = JSON.parse(json.out);
    assert.equal(parsed.lines.length, 1);
    assert.equal(parsed.lines[0].match.tool, 'Edit');

    const map = capture([d.file, '--no-color', '--transcripts', d.transcripts], d.repo);
    assert.match(map.out, /17 traced to 3 agent sessions/);
    assert.match(map.out, /1 untraced/);
  } finally {
    d.cleanup();
  }
});

test('cli: --demo works from anywhere', () => {
  const r = capture(['--demo', '--no-color', '--summary'], os.tmpdir());
  assert.equal(r.code, 0);
  assert.match(r.out, /traced to 3 agent sessions/);
});

test('cli: helpful errors', () => {
  const d = demoRepo();
  try {
    assert.equal(capture(['nope.js'], d.repo).code, 1);
    assert.match(capture(['nope.js'], d.repo).err, /No such file/);
    assert.match(capture([`${d.file}:999`, '--transcripts', d.transcripts], d.repo).err, /only \d+ lines/);
    assert.match(capture(['--bogus'], d.repo).err, /Unknown option/);
    assert.equal(capture([], d.repo).code, 2);
    const outside = fs.mkdtempSync(`${os.tmpdir()}/whyline-nogit-`);
    fs.writeFileSync(`${outside}/a.js`, 'x\n');
    assert.match(capture(['a.js'], outside).err, /Not inside a git repository/);
    fs.rmSync(outside, { recursive: true, force: true });
  } finally {
    d.cleanup();
  }
});

test('cli: no transcripts gives an explanation, not a crash', () => {
  const d = demoRepo();
  try {
    const empty = fs.mkdtempSync(`${os.tmpdir()}/whyline-empty-`);
    const r = capture([d.file, '--no-color', '--transcripts', empty], d.repo);
    assert.equal(r.code, 0);
    assert.match(r.out, /No agent transcripts found/);
    fs.rmSync(empty, { recursive: true, force: true });
  } finally {
    d.cleanup();
  }
});

test('parseArgs / parseTarget', () => {
  assert.equal(parseArgs(['a.js', '--json']).json, true);
  assert.deepEqual(parseTarget('src/a.js:3-9', '/nonexistent'), { file: 'src/a.js', from: 3, to: 9 });
  assert.deepEqual(parseTarget('src/a.js:3', '/nonexistent'), { file: 'src/a.js', from: 3, to: 3 });
  assert.deepEqual(parseTarget('src/a.js', '/nonexistent'), { file: 'src/a.js' });
  assert.throws(() => parseTarget('a.js:9-3', '/x'), /Invalid line range/);
  assert.throws(() => parseArgs(['a', 'b']), /Unexpected argument/);
});
