import test from 'node:test';
import assert from 'node:assert/strict';
import { addedLines, buildIndex, matchLine, relativeTo } from '../src/match.js';

/** @returns {import('../src/transcripts.js').EditEvent} */
const ev = (o) => ({ sessionId: 's', sessionFile: 's.jsonl', ts: 0, seq: 0, tool: 'Edit', file: '/r/a.js', oldText: '', newText: '', promptIndex: 0, said: '', ...o });
const session = (file, events) => ({ id: file, file, cwd: '/r', startTs: 0, prompts: [{ ts: 0, text: 'p' }], events, skippedLines: 0 });

test('addedLines ignores lines that existed before (multiset)', () => {
  assert.deepEqual(addedLines(['a', 'b'], ['a', 'x', 'b', 'b']), [false, true, false, true]);
});

test('relativeTo only accepts paths under a known root', () => {
  assert.equal(relativeTo('/r/src/a.js', ['/r']), 'src/a.js');
  assert.equal(relativeTo('/other/src/a.js', ['/r']), null);
  assert.equal(relativeTo('/r2/a.js', ['/r']), null);
});

test('a later whole-file Write does not steal lines it did not change', () => {
  const s1 = session('one.jsonl', [ev({ sessionId: 'one', sessionFile: 'one.jsonl', ts: 1, tool: 'Write', newText: 'alpha()\nbeta()\n' })]);
  const s2 = session('two.jsonl', [ev({ sessionId: 'two', sessionFile: 'two.jsonl', ts: 2, tool: 'Write', newText: 'alpha()\nbeta()\ngamma()\n' })]);
  const index = buildIndex([s1, s2], ['/r']).get('a.js');
  assert.ok(index);
  const byFile = new Map([[s1.file, s1], [s2.file, s2]]);
  const current = ['alpha()', 'beta()', 'gamma()', ''];
  assert.equal(matchLine(index, current, 0, NaN, byFile)?.event.sessionId, 'one');
  assert.equal(matchLine(index, current, 2, NaN, byFile)?.event.sessionId, 'two');
});

test('an edit made after the commit cannot explain that commit', () => {
  const early = session('e.jsonl', [ev({ sessionId: 'early', sessionFile: 'e.jsonl', ts: 1_000, newText: 'const total = sum(items);' })]);
  const late = session('l.jsonl', [ev({ sessionId: 'late', sessionFile: 'l.jsonl', ts: 9_000_000_000, newText: 'const total = sum(items);' })]);
  const index = buildIndex([early, late], ['/r']).get('a.js');
  assert.ok(index);
  const byFile = new Map([[early.file, early], [late.file, late]]);
  const m = matchLine(index, ['const total = sum(items);'], 0, 2_000, byFile);
  assert.equal(m?.event.sessionId, 'early');
});

test('trivial lines such as a closing brace are not attributed without context', () => {
  const s = session('s.jsonl', [ev({ ts: 1, newText: '}' })]);
  const index = buildIndex([s], ['/r']).get('a.js');
  assert.ok(index);
  assert.equal(matchLine(index, ['}'], 0, NaN, new Map([[s.file, s]])), null);
});

test('identical text from two sessions lowers confidence', () => {
  const mk = (id, ts) => session(`${id}.jsonl`, [ev({ sessionId: id, sessionFile: `${id}.jsonl`, ts, newText: 'export const retries = 3;' })]);
  const a = mk('a', 1);
  const b = mk('b', 2);
  const index = buildIndex([a, b], ['/r']).get('a.js');
  assert.ok(index);
  const m = matchLine(index, ['export const retries = 3;'], 0, NaN, new Map([[a.file, a], [b.file, b]]));
  assert.equal(m?.event.sessionId, 'b');
  assert.equal(m?.alternatives, 1);
  assert.notEqual(m?.confidence, 'high');
});
