// Renders docs/assets/demo.svg from whyline's real output on the generated demo repo.
// Usage: npm run render-demo
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeFile } from '../src/analyze.js';
import { createDemo } from '../src/demo.js';
import { makeStyle, renderFileMap, renderLines } from '../src/render.js';

const COLS = 88;
/** @type {Record<number, string>} */
const COLORS = { 31: '#ff7b72', 32: '#7ee787', 33: '#e3b341', 34: '#79c0ff', 35: '#d2a8ff', 36: '#56d4dd', 91: '#ffa198', 93: '#f2cc60', 95: '#e2c5ff' };
const ESC = String.fromCharCode(27);
const SGR_SPLIT = new RegExp(`(${ESC}\\[[0-9;]*m)`);
const SGR = new RegExp(`^${ESC}\\[([0-9;]*)m$`);
const FG = '#e6edf3';
const DIM = '#7d8590';

/**
 * Convert one ANSI-coloured line to <tspan>s.
 * @param {string} line
 */
function toSpans(line) {
  const esc = (/** @type {string} */ s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let fill = FG;
  let bold = false;
  let out = '';
  for (const part of line.split(SGR_SPLIT)) {
    const m = SGR.exec(part);
    if (m) {
      const code = Number(m[1] || 0);
      if (code === 0) (fill = FG), (bold = false);
      else if (code === 1) bold = true;
      else if (code === 2) fill = DIM;
      else if (COLORS[code]) fill = COLORS[code];
    } else if (part) {
      out += `<tspan fill="${fill}"${bold ? ' font-weight="700"' : ''}>${esc(part)}</tspan>`;
    }
  }
  return out;
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'whyline-svg-'));
const demo = createDemo(base);
const report = analyzeFile({ file: demo.file, cwd: demo.repo, transcripts: demo.transcripts });
const style = makeStyle(true);
const blocks = [
  ['$ whyline src/retry.js', renderFileMap(report, { style, width: COLS })],
  ['$ whyline src/retry.js:15', renderLines(report, 15, 15, { style, width: COLS + 14 })],
];

/** @type {string[]} */
const rows = [];
blocks.forEach(([cmd, body], i) => {
  if (i) rows.push('');
  rows.push(`${ESC}[1m${ESC}[32m${cmd}${ESC}[0m`);
  rows.push(...body.split('\n'));
});

const LH = 20;
const W = 920;
const H = 64 + rows.length * LH;
const text = rows
  .map((r, i) => `<text x="24" y="${56 + i * LH}" xml:space="preserve">${toSpans(r)}</text>`)
  .join('\n  ');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="whyline output: a provenance map of src/retry.js and the prompt behind line 15">
  <rect width="${W}" height="${H}" rx="10" fill="#0d1117"/>
  <rect width="${W}" height="34" rx="10" fill="#161b22"/><rect y="24" width="${W}" height="10" fill="#161b22"/>
  <circle cx="20" cy="17" r="6" fill="#ff5f57"/><circle cx="40" cy="17" r="6" fill="#febc2e"/><circle cx="60" cy="17" r="6" fill="#28c840"/>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace" font-size="13.5">
  ${text}
  </g>
</svg>
`;
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'assets', 'demo.svg');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, svg);
fs.rmSync(base, { recursive: true, force: true });
console.log(`wrote ${path.relative(process.cwd(), out)} (${(svg.length / 1024).toFixed(1)} KB, ${rows.length} rows)`);
