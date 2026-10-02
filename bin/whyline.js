#!/usr/bin/env node
import { run } from '../src/cli.js';

const code = run(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
});
process.exitCode = code;
