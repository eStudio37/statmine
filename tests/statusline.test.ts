import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATUSLINE, dateShim, git, mkdirp, tempDir } from './helpers';

const SID = 'sess-1';
const DAY = '2026-10-22';
const NOW = '2026-10-22 12:00';
const BIN = dateShim();

interface Fx { data: string; cwd: string }

function fixture(config: object | null = { label: 'TEST', version: '9.9.9' }): Fx {
  const data = tempDir();
  if (config) writeFileSync(join(data, 'config.json'), JSON.stringify(config));
  return { data, cwd: tempDir('statmine-cwd-') };
}

let n = 0;
const p = (text: string, session_id = SID, id = `id${n++}`) => JSON.stringify({ session_id, id, text });
const s = (id: string, summary: string, session_id = SID) => JSON.stringify({ session_id, id, summary });

function writeDay(fx: Fx, day: string, lines: string[], finalNewline = true): void {
  mkdirp(join(fx.data, 'prompts'));
  writeFileSync(join(fx.data, 'prompts', `${day}.jsonl`), lines.join('\n') + (finalNewline ? '\n' : ''));
}

function render(fx: Fx, opts: { now?: string; sid?: string; projectDir?: string; input?: object } = {}) {
  const input = opts.input ?? {
    session_id: opts.sid ?? SID,
    workspace: { current_dir: fx.cwd, ...(opts.projectDir ? { project_dir: opts.projectDir } : {}) },
    model: { display_name: 'Opus' },
    effort: { level: 'high' },
    context_window: { context_window_size: 1000000, used_percentage: 12, current_usage: { input_tokens: 120000 } },
    cost: { total_duration_ms: 5_400_000 },
  };
  const r = spawnSync('bash', [STATUSLINE], {
    input: JSON.stringify(input),
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, FAKE_NOW: opts.now ?? NOW, STATMINE_DATA: fx.data },
    encoding: 'utf-8',
    timeout: 15_000,
  });
  expect(r.status).toBe(0);
  const out = (r.stdout || '').replace(/\x1b\[[0-9;]*m/g, '');
  const lines = out.split('\n').filter((l) => l.length > 0);
  const reqLines = lines.filter((l) => /^\d+\. /.test(l));
  reqLines.forEach((l, i) => expect(l.startsWith(`${reqLines.length - i}. `)).toBe(true));
  return { out, lines, rows: reqLines.map((l) => l.replace(/^\d+\. /, '')) };
}

// --- full view ---

test('full view: header with label, version, date and time', () => {
  const fx = fixture();
  const { lines } = render(fx);
  expect(lines[0]).toBe('TEST  v9.9.9  Thursday, October 22, 2026  12:00');
  expect(lines[1]).toContain('⏱ 1h30m');
  expect(lines[2]).toContain('12%  120k/1000k  Opus  effort high');
});

test('no config file: default label, no version', () => {
  const fx = fixture(null);
  expect(render(fx).lines[0]).toBe('米Claude Code  Thursday, October 22, 2026  12:00');
});

test('an empty label shows no label', () => {
  const fx = fixture({ label: '', version: '1.0.0' });
  expect(render(fx).lines[0]).toBe('v1.0.0  Thursday, October 22, 2026  12:00');
});

test('the last three prompts of this session, newest last', () => {
  const fx = fixture();
  writeDay(fx, DAY, [p('one'), p('two'), p('three'), p('four')]);
  expect(render(fx).rows).toEqual(['two', 'three', 'four']);
});

test('a summary replaces the text of its own prompt only', () => {
  const fx = fixture();
  writeDay(fx, DAY, [p('short a', SID, 'a'), p('a long prompt b', SID, 'b')]);
  writeFileSync(join(fx.data, 'summaries.jsonl'), [s('b', 'Do b'), s('b', 'Do b better'), s('a', '  ')].join('\n') + '\n');
  // last summary wins; a blank summary falls back to the text
  expect(render(fx).rows).toEqual(['short a', 'Do b better']);
});

test('other sessions are excluded, and no session id means no rows', () => {
  const fx = fixture();
  writeDay(fx, DAY, [p('mine'), p('theirs', 'sess-2')]);
  expect(render(fx).rows).toEqual(['mine']);
  expect(render(fx, { sid: '' }).rows).toEqual([]);
});

test('rows survive midnight and the month boundary', () => {
  const fx = fixture();
  writeDay(fx, '2026-10-31', [p('last night')]);
  writeDay(fx, '2026-11-01', [p('this morning')]);
  expect(render(fx, { now: '2026-11-01 00:05' }).rows).toEqual(['last night', 'this morning']);
});

test('a damaged line in yesterday\'s log does not hide today\'s rows', () => {
  const fx = fixture();
  writeDay(fx, '2026-10-21', [p('yesterday'), '{"session_id":"sess-1","id":"x","te'], false);
  writeDay(fx, DAY, [p('today')]);
  expect(render(fx).rows).toEqual(['yesterday', 'today']);
});

test('a damaged summaries file falls back to the logged text', () => {
  const fx = fixture();
  writeDay(fx, DAY, [p('kept', SID, 'k')]);
  writeFileSync(join(fx.data, 'summaries.jsonl'), 'not json\n{"session_id":');
  expect(render(fx).rows).toEqual(['kept']);
});

test('long rows are cut to the row width', () => {
  const fx = fixture();
  writeDay(fx, DAY, [p('x'.repeat(80))]);
  expect(render(fx).rows).toEqual(['x'.repeat(49) + '...']);
});

test('malformed stdin still renders and exits 0', () => {
  const fx = fixture();
  const r = spawnSync('bash', [STATUSLINE], {
    input: 'not json',
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, FAKE_NOW: NOW, STATMINE_DATA: fx.data },
    encoding: 'utf-8',
  });
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('TEST');
});

// --- compact view ---

test('compact view is one line of cells', () => {
  const fx = fixture();
  writeFileSync(join(fx.data, 'mode'), 'compact\n');
  writeDay(fx, DAY, [p('not shown in compact')]);
  const { lines, rows } = render(fx);
  expect(lines.length).toBe(1);
  expect(lines[0].startsWith('TEST 12:00 │ ')).toBe(true);
  expect(lines[0]).toContain(' 120k/1000k │ Opus high');
  expect(lines[0]).not.toContain('%');
  expect(rows).toEqual([]);
});

test('an unknown mode falls back to full', () => {
  const fx = fixture();
  writeFileSync(join(fx.data, 'mode'), 'bogus\n');
  expect(render(fx).lines.length).toBeGreaterThan(1);
});

// --- git cell ---

function repo(dir: string, branch = 'main'): string {
  git(dir, 'init', '-q', '-b', branch);
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

test('green on the trunk of the session repo, with ⊘ for no remote', () => {
  const fx = fixture();
  repo(fx.cwd);
  const r = spawnSync('bash', [STATUSLINE], {
    input: JSON.stringify({ session_id: SID, workspace: { current_dir: fx.cwd, project_dir: fx.cwd } }),
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, FAKE_NOW: NOW, STATMINE_DATA: fx.data },
    encoding: 'utf-8',
  });
  const row = r.stdout.split('\n')[1];
  const name = fx.cwd.split('/').pop();
  expect(row).toContain('\x1b[38;2;52;211;153m' + `${name} → ${name} ⎇ main`);
  expect(row.replace(/\x1b\[[0-9;]*m/g, '').startsWith('⊘ ↓1  ')).toBe(true);
});

test('red when commits would land in another repo than the session\'s', () => {
  const fx = fixture();
  repo(fx.cwd);
  const other = repo(tempDir('statmine-other-'));
  const r = spawnSync('bash', [STATUSLINE], {
    input: JSON.stringify({ session_id: SID, workspace: { current_dir: fx.cwd, project_dir: other } }),
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, FAKE_NOW: NOW, STATMINE_DATA: fx.data },
    encoding: 'utf-8',
  });
  expect(r.stdout.split('\n')[1]).toContain('\x1b[38;2;239;68;68m');
});

test('amber when a <repo>--<slug> worktree is on another branch', () => {
  const fx = fixture();
  const base = tempDir('statmine-wt-');
  const main = repo(mkdirp(join(base, 'proj')));
  git(main, 'worktree', 'add', '-q', '-b', 'other-work', join(base, 'proj--feature'));
  const r = spawnSync('bash', [STATUSLINE], {
    input: JSON.stringify({ session_id: SID, workspace: { current_dir: join(base, 'proj--feature'), project_dir: main } }),
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, FAKE_NOW: NOW, STATMINE_DATA: fx.data },
    encoding: 'utf-8',
  });
  const row = r.stdout.split('\n')[1];
  expect(row).toContain('\x1b[38;2;251;191;36mproj--feature → proj ⎇ other-work');
});
