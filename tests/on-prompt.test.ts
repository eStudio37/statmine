import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOOK, mkdirp, tempDir } from './helpers';
import { cleanSummary, isOperatorPrompt, stripChannels } from '../hooks/on-prompt';

// The day as the hook and the statusline see it (local time). bun test runs
// in UTC, so the test process's own calendar can be a day off.
const localDay = () => spawnSync('date', ['+%Y-%m-%d'], { encoding: 'utf-8' }).stdout.trim();

const SID = 'sess-1';
const LONG = 'please refactor the request rows so that they show only what I typed and nothing the harness sends';

/** A fake `claude` that records its argv and stdin, then prints a fixed line. */
function stubClaude(output = 'Refactor the request rows'): { bin: string; log: string } {
  const dir = tempDir('statmine-claude-');
  const log = join(dir, 'calls.log');
  const bin = join(dir, 'claude');
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
printf 'ARGV:%s\\n' "$*" >> "${log}"
printf 'STDIN:%s\\n' "$(cat)" >> "${log}"
printf 'WORKER:%s\\n' "\${STATMINE_WORKER:-}" >> "${log}"
printf '%s\\n' ${JSON.stringify(output)}
`,
  );
  chmodSync(bin, 0o755);
  return { bin, log };
}

function runHook(data: string, prompt: string, env: Record<string, string> = {}, sessionId = SID) {
  const r = spawnSync(process.execPath, ['--config=/dev/null', 'run', HOOK], {
    input: JSON.stringify({ session_id: sessionId, prompt, hook_event_name: 'UserPromptSubmit' }),
    env: { ...process.env, CLAUDE_PLUGIN_DATA: data, CLAUDE_BIN: '/nonexistent/claude', ...env },
    encoding: 'utf-8',
    timeout: 15_000,
  });
  expect(r.status).toBe(0);
  expect(r.stdout).toBe(''); // never adds context or changes the prompt
  return r;
}

function logged(data: string): { session_id: string; id: string; text: string }[] {
  const f = join(data, 'prompts', `${localDay()}.jsonl`);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function waitFor<T>(fn: () => T | undefined, ms = 8000): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v !== undefined) return v;
    await Bun.sleep(100);
  }
  return undefined;
}

function summaries(data: string): { session_id: string; id: string; summary: string }[] {
  const f = join(data, 'summaries.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// --- the rule for what counts ---

test('isOperatorPrompt keeps typed text, pastes, channel messages and commands with arguments', () => {
  expect(isOperatorPrompt('fix it')).toBe(true);
  expect(isOperatorPrompt('<pasted_content id="1">x</pasted_content>')).toBe(true);
  expect(isOperatorPrompt('<channel source="plugin:telegram:telegram" chat_id="1">hi</channel>')).toBe(true);
  expect(isOperatorPrompt('/plan a fix')).toBe(true);
  expect(isOperatorPrompt('<task-notification>done</task-notification>')).toBe(false);
  expect(isOperatorPrompt('  <agent-message from="x">hi</agent-message>')).toBe(false);
  expect(isOperatorPrompt('/login')).toBe(false);
  expect(isOperatorPrompt('/plugin:cmd  \n')).toBe(false);
});

test('stripChannels removes wrappers and their attributes', () => {
  expect(stripChannels('plain')).toBeNull();
  expect(stripChannels('<channel source="plugin:telegram:telegram" chat_id="999" user="op">hello there</channel>')).toBe('hello there');
  expect(stripChannels('<channel source="a" note="x>y">body</channel>')).toBe('body');
  expect(stripChannels('<channel source="a" chat_id="9" unterminated')).toBe('');
  expect(stripChannels('explain the <channel> tag')).toBeNull();
});

test('cleanSummary drops labels, markdown and quotes', () => {
  expect(cleanSummary('**Summary:** "Fix the rows"\nmore')).toBe('Fix the rows');
  expect(cleanSummary('\n\n`Do it`')).toBe('Do it');
});

// --- logging ---

test('a typed prompt is logged as one line; system input is not logged', () => {
  const data = tempDir();
  runHook(data, 'first\nprompt');
  runHook(data, '<task-notification>agent done</task-notification>');
  runHook(data, '/login');
  runHook(data, '/plan the next step');
  expect(logged(data).map((l) => l.text)).toEqual(['first prompt', '/plan the next step']);
  expect(logged(data).every((l) => l.session_id === SID && /^[0-9a-z]+-[0-9a-f]{8}$/.test(l.id))).toBe(true);
});

test('channel wrappers and chat ids never reach disk', () => {
  const data = tempDir();
  runHook(data, '<channel source="plugin:telegram:telegram" chat_id="99887766" user="op">ship it</channel>');
  runHook(data, '<channel source="plugin:telegram:telegram" chat_id="111222333" broken');
  expect(logged(data).map((l) => l.text)).toEqual(['ship it', 'channel message']);
  expect(readFileSync(join(data, 'prompts', `${localDay()}.jsonl`), 'utf-8')).not.toMatch(/chat_id|99887766|111222333/);
});

test('logged text is cut to 200 characters without splitting an emoji', () => {
  const data = tempDir();
  runHook(data, '😀'.repeat(250), { CLAUDE_PLUGIN_OPTION_SUMMARIES: 'false' });
  const t = logged(data)[0].text;
  expect([...t].length).toBe(200);
  expect(t).toBe('😀'.repeat(200));
});

test('files are private: folders 0700, files 0600', () => {
  const data = join(tempDir(), 'data');
  runHook(data, 'hello', { CLAUDE_PLUGIN_OPTION_SUMMARIES: 'false' });
  expect(statSync(join(data, 'prompts')).mode & 0o777).toBe(0o700);
  expect(statSync(join(data, 'prompts', `${localDay()}.jsonl`)).mode & 0o777).toBe(0o600);
});

test('prompt logs older than 7 days are deleted', () => {
  const data = tempDir();
  mkdirp(join(data, 'prompts'));
  writeFileSync(join(data, 'prompts', '2000-01-01.jsonl'), '{}\n');
  runHook(data, 'hello', { CLAUDE_PLUGIN_OPTION_SUMMARIES: 'false' });
  expect(existsSync(join(data, 'prompts', '2000-01-01.jsonl'))).toBe(false);
});

test('inside a summarizer session the hook does nothing', () => {
  const data = tempDir();
  runHook(data, 'hello', { STATMINE_WORKER: '1' });
  expect(logged(data)).toEqual([]);
});

// --- summaries ---

test('a long prompt gets a summary under its own id, sent on stdin', async () => {
  const data = tempDir();
  const { bin, log } = stubClaude();
  runHook(data, LONG, { CLAUDE_BIN: bin });
  const id = logged(data)[0].id;
  const got = await waitFor(() => summaries(data)[0]);
  expect(got).toEqual({ session_id: SID, id, summary: 'Refactor the request rows' });
  const calls = readFileSync(log, 'utf-8');
  expect(calls).toContain(`STDIN:${LONG}`);
  expect(calls).toContain('--model haiku');
  expect(calls).toContain('WORKER:1');
  expect(calls.split('\n').find((l) => l.startsWith('ARGV:'))).not.toContain('refactor the request rows');
  expect(statSync(join(data, 'summaries.jsonl')).mode & 0o777).toBe(0o600);
});

test('the summary model option is passed through', async () => {
  const data = tempDir();
  const { bin, log } = stubClaude();
  runHook(data, LONG, { CLAUDE_BIN: bin, CLAUDE_PLUGIN_OPTION_SUMMARY_MODEL: 'sonnet' });
  await waitFor(() => summaries(data)[0]);
  expect(readFileSync(log, 'utf-8')).toContain('--model sonnet');
});

test('short prompts and disabled summaries make no model call', async () => {
  const data = tempDir();
  const { bin, log } = stubClaude();
  runHook(data, 'short one', { CLAUDE_BIN: bin });
  runHook(data, LONG, { CLAUDE_BIN: bin, CLAUDE_PLUGIN_OPTION_SUMMARIES: 'false' });
  await Bun.sleep(1500);
  expect(existsSync(log)).toBe(false);
  expect(summaries(data)).toEqual([]);
  expect(logged(data).length).toBe(2);
});

test('a failing claude leaves no summary and frees its slot', async () => {
  const data = tempDir();
  const dir = tempDir('statmine-claude-');
  const bin = join(dir, 'claude');
  writeFileSync(bin, '#!/usr/bin/env bash\ncat >/dev/null; exit 3\n');
  chmodSync(bin, 0o755);
  runHook(data, LONG, { CLAUDE_BIN: bin });
  const freed = await waitFor(() => {
    const locks = join(data, '.locks');
    return existsSync(locks) && !existsSync(join(locks, 'slot-0')) ? true : undefined;
  });
  expect(freed).toBe(true);
  expect(summaries(data)).toEqual([]);
});
