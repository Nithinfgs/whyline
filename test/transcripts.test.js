import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodeProjectPath, findSessionFiles, parseSession, promptText } from '../src/transcripts.js';

test('encodeProjectPath mirrors Claude Code directory naming', () => {
  assert.equal(encodeProjectPath('/Users/me/My Project/app'), '-Users-me-My-Project-app');
});

test('promptText keeps human prompts and drops tool output and injected context', () => {
  assert.equal(promptText({ type: 'user', message: { content: 'fix the bug' } }), 'fix the bug');
  assert.equal(promptText({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }), null);
  assert.equal(promptText({ type: 'user', isMeta: true, message: { content: 'hidden' } }), null);
  assert.equal(promptText({ type: 'user', isSidechain: true, message: { content: 'subagent task' } }), null);
  assert.equal(promptText({ type: 'user', message: { content: '<system-reminder>ctx</system-reminder>' } }), null);
  assert.equal(promptText({ type: 'user', message: { content: [{ type: 'text', text: '<system-reminder>ctx</system-reminder>\nadd tests' }] } }), 'add tests');
  assert.equal(promptText({ type: 'user', message: { content: '<pasted_content id="x1">fix it</pasted_content id="x1">' } }), 'fix it');
  assert.equal(promptText({ type: 'user', message: { content: '[Request interrupted by user]' } }), null);
});

test('parseSession tolerates garbage lines and unknown entry types', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whyline-t-'));
  const file = path.join(dir, 'abc.jsonl');
  const lines = [
    '{not json',
    JSON.stringify({ type: 'mode', value: 'x' }),
    JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z', sessionId: 'sess', message: { content: 'do it' } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-01-01T00:00:05Z', message: { content: [
      { type: 'text', text: 'on it' },
      { type: 'tool_use', name: 'MultiEdit', input: { file_path: '/r/a.js', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] } },
      { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
    ] } }),
  ];
  fs.writeFileSync(file, lines.join('\n'));
  const s = parseSession(file);
  assert.equal(s.id, 'sess');
  assert.equal(s.skippedLines, 1);
  assert.equal(s.prompts.length, 1);
  assert.equal(s.events.length, 2);
  assert.equal(s.events[0].said, 'on it');
  assert.equal(s.events[0].promptIndex, 0);
  assert.equal(s.events[1].seq, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('findSessionFiles finds sessions launched in the repo, a worktree of it, or a parent directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whyline-f-'));
  const repo = '/work/parent/repo';
  const mk = (name) => {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, 'x.jsonl'), '');
  };
  mk(encodeProjectPath(repo));
  mk(encodeProjectPath(`${repo}/.claude/worktrees/w1`));
  mk(encodeProjectPath('/work/parent'));
  mk(encodeProjectPath('/work/parent/repo-other'));
  mk(encodeProjectPath('/somewhere/else'));
  const found = findSessionFiles(root, [repo]).map((f) => path.basename(path.dirname(f)));
  // 'repo-other' also matches: the encoding turns '/' and '-' into the same character, so a sibling
  // directory is indistinguishable from a worktree. That only costs parse time; edits are filtered by path.
  assert.equal(found.length, 4);
  assert.ok(!found.includes(encodeProjectPath('/somewhere/else')));
  fs.rmSync(root, { recursive: true, force: true });
});
