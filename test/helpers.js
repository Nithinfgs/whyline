import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDemo } from '../src/demo.js';

/** A fresh demo repo in a temp directory, removed by the returned cleanup function. */
export function demoRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'whyline-test-'));
  const demo = createDemo(base);
  return { ...demo, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}
