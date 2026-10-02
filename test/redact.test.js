import test from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/redact.js';

test('redacts well-known token shapes', () => {
  const out = redact('use sk-ant-api03-abcdefghijklmnop1234 and ghp_abcdefghijklmnopqrstuvwx and AKIAABCDEFGHIJKLMNOP');
  assert.equal(out, 'use [redacted] and [redacted] and [redacted]');
});

test('redacts key=value assignments but keeps the key name', () => {
  assert.equal(redact('set API_KEY=hunter2hunter2 now'), 'set API_KEY=[redacted] now');
  assert.equal(redact('password: "correct-horse"'), 'password: [redacted]');
});

test('leaves ordinary prose alone', () => {
  const s = 'add exponential backoff with jitter, capped at 30s';
  assert.equal(redact(s), s);
});
