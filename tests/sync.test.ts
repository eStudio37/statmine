import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, STATUSLINE, SYNC, tempDir } from './helpers';

function sync(data: string, env: Record<string, string> = {}) {
  const base = { ...process.env };
  delete base.CLAUDE_PLUGIN_OPTION_LABEL;
  const r = spawnSync('bash', [SYNC], {
    env: { ...base, CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PLUGIN_DATA: data, ...env },
    encoding: 'utf-8',
  });
  expect(r.status).toBe(0);
  expect(r.stdout).toBe(''); // SessionStart output would enter the conversation
}

const version = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf-8')).version;

test('copies the statusline and writes the config with the default label', () => {
  const data = join(tempDir(), 'data');
  sync(data);
  expect(readFileSync(join(data, 'statusline.sh'), 'utf-8')).toBe(readFileSync(STATUSLINE, 'utf-8'));
  expect(statSync(join(data, 'statusline.sh')).mode & 0o777).toBe(0o700);
  expect(statSync(data).mode & 0o777).toBe(0o700);
  expect(JSON.parse(readFileSync(join(data, 'config.json'), 'utf-8'))).toEqual({ label: '米Claude Code', version });
});

test('a set label wins, and an empty label means none', () => {
  const data = tempDir();
  sync(data, { CLAUDE_PLUGIN_OPTION_LABEL: 'Mine' });
  expect(JSON.parse(readFileSync(join(data, 'config.json'), 'utf-8')).label).toBe('Mine');
  sync(data, { CLAUDE_PLUGIN_OPTION_LABEL: '' });
  expect(JSON.parse(readFileSync(join(data, 'config.json'), 'utf-8')).label).toBe('');
});

test('without plugin variables it does nothing', () => {
  const r = spawnSync('bash', [SYNC], { env: { PATH: process.env.PATH ?? '' }, encoding: 'utf-8' });
  expect(r.status).toBe(0);
  expect(r.stdout).toBe('');
});
