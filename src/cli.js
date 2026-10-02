import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeFile } from './analyze.js';
import { createDemo } from './demo.js';
import { makeStyle, renderFileMap, renderLines } from './render.js';
import { UserError } from './util.js';

const HELP = `whyline: which agent prompt wrote this line?

Usage
  whyline <file>                 provenance map of the whole file
  whyline <file>:<line>          explain one line
  whyline <file>:<from>-<to>     explain a range
  whyline --demo                 try it on a generated sample repo

Options
  --json                 machine-readable output
  --summary              with a bare <file>: only the session legend, no per-line map
  --transcripts <dir>    read transcripts from <dir> instead of ~/.claude/projects
  --no-color             disable ANSI colors (also honours NO_COLOR)
  -v, --version
  -h, --help

Reads Claude Code transcripts (~/.claude/projects) and git blame. Nothing leaves your machine.
`;

/**
 * @param {string[]} argv
 * @returns {{ target?: string, json: boolean, summary: boolean, color: boolean, demo: boolean,
 *             transcripts?: string, help: boolean, version: boolean }}
 */
export function parseArgs(argv) {
  /** @type {ReturnType<typeof parseArgs>} */
  const opts = {
    target: undefined,
    json: false,
    summary: false,
    color: !process.env.NO_COLOR && Boolean(process.stdout.isTTY),
    demo: false,
    transcripts: undefined,
    help: false,
    version: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--summary') opts.summary = true;
    else if (a === '--no-color') opts.color = false;
    else if (a === '--color') opts.color = true;
    else if (a === '--demo') opts.demo = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '-v' || a === '--version') opts.version = true;
    else if (a === '--transcripts') {
      const v = argv[++i];
      if (!v) throw new UserError('--transcripts needs a directory');
      opts.transcripts = v;
    } else if (a.startsWith('--transcripts=')) opts.transcripts = a.slice('--transcripts='.length);
    else if (a.startsWith('-') && a !== '-') throw new UserError(`Unknown option ${a}. Try --help.`);
    else if (opts.target === undefined) opts.target = a;
    else throw new UserError(`Unexpected argument ${a}. Try --help.`);
  }
  return opts;
}

/**
 * Split "path/to/file.js:12-20" into its parts. A trailing :N or :N-M is a range
 * unless a file with that literal name exists.
 * @param {string} target
 * @param {string} cwd
 * @returns {{ file: string, from?: number, to?: number }}
 */
export function parseTarget(target, cwd) {
  const m = /^(.*):(\d+)(?:-(\d+))?$/.exec(target);
  if (!m || fs.existsSync(path.resolve(cwd, target))) return { file: target };
  const from = Number(m[2]);
  const to = m[3] ? Number(m[3]) : from;
  if (from < 1 || to < from) throw new UserError(`Invalid line range in ${target}`);
  return { file: m[1], from, to };
}

/**
 * @param {string[]} argv
 * @param {{ stdout: (s: string) => void, stderr: (s: string) => void, cwd?: string }} io
 * @returns {number} exit code
 */
export function run(argv, io) {
  try {
    const opts = parseArgs(argv);
    if (opts.help) return io.stdout(HELP), 0;
    if (opts.version) return io.stdout(`${readVersion()}\n`), 0;

    let cwd = io.cwd ?? process.cwd();
    let transcripts = opts.transcripts;
    let target = opts.target;
    if (opts.demo) {
      const demo = createDemo();
      cwd = demo.repo;
      transcripts = demo.transcripts;
      target = target ?? demo.file;
      if (!opts.json) io.stdout(`demo repo: ${demo.repo}  (synthetic; safe to delete)\n\n`);
    }
    if (!target) {
      io.stderr(HELP);
      return 2;
    }

    const { file, from, to } = parseTarget(target, cwd);
    const report = analyzeFile({ file, cwd, transcripts });
    const width = Math.min(process.stdout.columns || 100, 120);
    const style = makeStyle(opts.color);

    if (opts.json) {
      const lines = from ? report.lines.filter((l) => l.line >= from && l.line <= (to ?? from)) : report.lines;
      io.stdout(`${JSON.stringify({ ...report, lines }, null, 2)}\n`);
    } else if (from) {
      if (from > report.lines.length) throw new UserError(`${report.file} has only ${report.lines.length} lines`);
      io.stdout(`${renderLines(report, from, to ?? from, { style, width })}\n`);
    } else {
      io.stdout(`${renderFileMap(report, { style, width, summaryOnly: opts.summary })}\n`);
      if (opts.demo) io.stdout(`\nnext: whyline --demo ${report.file}:14\n`);
    }
    return 0;
  } catch (err) {
    if (err instanceof UserError) {
      io.stderr(`whyline: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

function readVersion() {
  const pkg = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  return JSON.parse(fs.readFileSync(pkg, 'utf8')).version;
}
