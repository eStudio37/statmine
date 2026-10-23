// One-shot text completion through the user's own `claude` CLI.
//
// The prompt goes on stdin, never in argv: argv text could be parsed as a
// claude option, and argv is visible to other accounts on the host via ps.
// Tools and setting sources are off, so the child session runs no tools and
// loads no hooks or plugins (no recursion into this plugin). STATMINE_WORKER=1
// is set as a second guard: the prompt hook exits at once when it sees it.

import { spawnSync } from 'child_process';

export interface InferenceOptions {
  /** The user prompt (sent on stdin) */
  userPrompt: string;
  systemPrompt: string;
  /** Model alias or id passed to --model, e.g. "haiku" */
  model: string;
  timeoutMs?: number;
}

export interface InferenceResult {
  output: string;
  success: boolean;
  error?: string;
}

/**
 * The claude binary: $CLAUDE_BIN when it is an absolute path, else `claude`
 * found on PATH. A relative CLAUDE_BIN is ignored.
 */
export function claudeBinary(): string | null {
  const env = process.env.CLAUDE_BIN;
  if (env && env.startsWith('/')) return env;
  return Bun.which('claude');
}

export function inference(opts: InferenceOptions): InferenceResult {
  const bin = claudeBinary();
  if (!bin) return { output: '', success: false, error: 'claude not found on PATH' };

  const args = [
    '--print',
    '--model', opts.model,
    '--output-format', 'text',
    '--system-prompt', opts.systemPrompt,
    '--tools', '',
    '--setting-sources', '',
  ];

  try {
    const result = spawnSync(bin, args, {
      env: { ...process.env, STATMINE_WORKER: '1' },
      input: opts.userPrompt,
      timeout: opts.timeoutMs ?? 30_000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (result.error) return { output: '', success: false, error: result.error.message };
    if (result.status !== 0) {
      return { output: '', success: false, error: `exit ${result.status}: ${(result.stderr || '').trim().slice(0, 300)}` };
    }
    return { output: (result.stdout || '').trim(), success: true };
  } catch (err: any) {
    return { output: '', success: false, error: String(err?.message ?? err) };
  }
}
