import { afterAll } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ROOT = join(import.meta.dir, '..');
export const STATUSLINE = join(ROOT, 'scripts', 'statusline.sh');
export const HOOK = join(ROOT, 'hooks', 'on-prompt.ts');
export const SYNC = join(ROOT, 'hooks', 'sync.sh');

/**
 * The prompt hook's bun arguments, exactly as hooks/hooks.json ships them, so
 * the tests run the hook the way Claude Code does.
 */
export function hookArgs(): string[] {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf-8'));
  const h = cfg.hooks.UserPromptSubmit[0].hooks[0];
  if (h.command !== 'bun') throw new Error(`unexpected hook command ${h.command}`);
  return (h.args as string[]).map((a) => a.replace('${CLAUDE_PLUGIN_ROOT}', ROOT));
}

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

export function tempDir(prefix = 'statmine-test-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  roots.push(d);
  return d;
}

/** A `date` shim on PATH that pins "now" to $FAKE_NOW (GNU date). */
export function dateShim(): string {
  const bin = tempDir('statmine-bin-');
  writeFileSync(
    join(bin, 'date'),
    `#!/usr/bin/env bash
d="$FAKE_NOW"; args=()
while [ $# -gt 0 ]; do
  case "$1" in
    -d) shift; if [ "$1" = yesterday ]; then d="$FAKE_NOW yesterday"; else d="$1"; fi ;;
    *) args+=("$1") ;;
  esac
  shift
done
exec /usr/bin/date -d "$d" "\${args[@]}"
`,
  );
  chmodSync(join(bin, 'date'), 0o755);
  return bin;
}

export function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
    },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

export function mkdirp(p: string): string {
  mkdirSync(p, { recursive: true });
  return p;
}
