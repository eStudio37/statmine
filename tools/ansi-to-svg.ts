#!/usr/bin/env bun
// Turn the statusline's ANSI output (stdin) into an SVG image (stdout) that
// looks like a terminal. Used by tools/render-demo.sh for the README images.
//
// Handles the codes statusline.sh prints: 0 (reset), 1 (bold), 2 (dim) and
// 38;2;R;G;B (truecolor foreground). Every character gets its own x position
// on a fixed cell grid, so a fallback font for a glyph like ▰ or ⎇ cannot
// shift the rest of the line. East Asian wide characters take two cells.

const CELL_W = 8.4;     // px per cell at FONT_SIZE
const LINE_H = 20;      // px per row
const FONT_SIZE = 14;
const PAD_X = 16;
const PAD_TOP = 40;     // room for the window bar
const PAD_BOTTOM = 14;
const BG = '#0f172a';
const BAR = '#1e293b';
const DEFAULT_FG = '#e2e8f0';

interface Run { text: string; fg: string; bold: boolean; dim: boolean; col: number }

/** True for code points that a terminal draws two cells wide. */
export function isWide(cp: number): boolean {
  return (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd) ||
    // ⏱ and its neighbours are one cell in most terminals, but browsers draw
    // them with a wide emoji font, which would overlap the next character.
    (cp >= 0x23e9 && cp <= 0x23fa);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Split one line into styled runs, with each run's starting cell. */
export function parseLine(line: string): { runs: Run[]; cells: number } {
  const runs: Run[] = [];
  let fg = DEFAULT_FG, bold = false, dim = false, col = 0;
  const parts = line.split(/(\x1b\[[0-9;]*m)/);
  for (const part of parts) {
    const m = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (m) {
      const codes = (m[1] || '0').split(';').map(Number);
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i];
        if (c === 0) { fg = DEFAULT_FG; bold = false; dim = false; }
        else if (c === 1) bold = true;
        else if (c === 2) dim = true;
        else if (c === 22) { bold = false; dim = false; }
        else if (c === 39) fg = DEFAULT_FG;
        else if (c === 38 && codes[i + 1] === 2 && i + 4 < codes.length) {
          const [r, g, b] = codes.slice(i + 2, i + 5).map((v) => Math.max(0, Math.min(255, v)));
          fg = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
          i += 4;
        }
      }
      continue;
    }
    if (!part) continue;
    // Drop any other control characters; they have no place in an image.
    const text = part.replace(/[\u0000-\u001f\u007f]/g, '');
    if (!text) continue;
    runs.push({ text, fg, bold, dim, col });
    for (const ch of text) col += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return { runs, cells: col };
}

export function toSvg(input: string, title: string): string {
  const lines = input.replace(/\n+$/, '').split('\n').map(parseLine);
  const cols = Math.max(20, ...lines.map((l) => l.cells));
  const width = Math.ceil(PAD_X * 2 + cols * CELL_W);
  const height = PAD_TOP + lines.length * LINE_H + PAD_BOTTOM;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">`);
  out.push(`<title>${esc(title)}</title>`);
  out.push(`<rect width="${width}" height="${height}" rx="8" fill="${BG}"/>`);
  out.push(`<path d="M0 8a8 8 0 0 1 8-8h${width - 16}a8 8 0 0 1 8 8v20H0z" fill="${BAR}"/>`);
  ['#ef4444', '#f59e0b', '#22c55e'].forEach((c, i) => out.push(`<circle cx="${18 + i * 18}" cy="14" r="5" fill="${c}"/>`));
  out.push(`<g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Noto Sans Mono CJK JP', monospace" font-size="${FONT_SIZE}" xml:space="preserve">`);
  lines.forEach((line, row) => {
    const y = PAD_TOP + row * LINE_H + FONT_SIZE;
    for (const run of line.runs) {
      const xs: string[] = [];
      let col = run.col, text = '';
      for (const ch of run.text) {
        const x = PAD_X + col * CELL_W;
        xs.push(x.toFixed(1));
        // The bar cells (▰ filled, ▱ empty) are drawn as shapes: fallback
        // fonts draw them wider than a cell, so they would run together.
        if (ch === '▰' || ch === '▱') {
          const top = y - 10, bot = y - 1, lean = 2;
          const pts = [[x + lean + 1, top], [x + CELL_W - 0.5, top], [x + CELL_W - lean - 1, bot], [x + 0.5, bot]]
            .map(([px, py]) => `${px.toFixed(1)},${py}`).join(' ');
          out.push(ch === '▰'
            ? `<polygon points="${pts}" fill="${run.fg}"/>`
            : `<polygon points="${pts}" fill="none" stroke="${run.fg}" stroke-width="1"/>`);
          text += ' ';
        } else text += ch;
        col += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1;
      }
      if (!text.trim()) continue;
      run.text = text;
      const attrs = [`x="${xs.join(' ')}"`, `y="${y}"`, `fill="${run.fg}"`];
      if (run.bold) attrs.push('font-weight="bold"');
      if (run.dim) attrs.push('opacity="0.6"');
      out.push(`<text ${attrs.join(' ')}>${esc(run.text)}</text>`);
    }
  });
  out.push('</g>', '</svg>');
  return out.join('\n') + '\n';
}

if (import.meta.main) {
  const title = Bun.argv[2] || 'statmine statusline';
  process.stdout.write(toSvg(await Bun.stdin.text(), title));
}
