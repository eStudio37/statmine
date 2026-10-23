#!/usr/bin/env bun
// statmine UserPromptSubmit hook: logs each prompt you type for the
// statusline's request rows, and summarizes the long ones in the background.
//
// HOOK MODE (default): read the hook JSON on stdin and drop system input
//   (isOperatorPrompt). Append {session_id, id, text} to prompts/<day>.jsonl,
//   where text is the prompt as one line, channel wrappers removed, cut to
//   TEXT_MAX characters. A prompt longer than a statusline row also gets a
//   summary: claim one of CAP slots, stage the full text in a job file, spawn
//   a detached worker, exit 0. The hook never blocks or changes the prompt.
// WORKER MODE (--worker <session> <jobPath> <slotPath>): read and delete the
//   job, ask the model for a short restatement, append {session_id, id,
//   summary} to summaries.jsonl, trim it, release the slot. Any failure leaves
//   no summary; the row shows the logged text.
//
// Everything lives in the plugin data folder ($CLAUDE_PLUGIN_DATA): folders
// are created 0700 and files 0600, since prompt text is private.
//
// Options (plugin userConfig, exported by Claude Code to hook processes):
//   CLAUDE_PLUGIN_OPTION_SUMMARIES      "false" turns summaries off
//   CLAUDE_PLUGIN_OPTION_SUMMARY_MODEL  model for summaries (default haiku)

import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { inference } from './lib/inference';

const CAP = 3;            // max concurrent summarizer workers (fixed slots)
const TRIM_LINES = 200;   // summaries.jsonl keeps its last TRIM_LINES lines
const STALE_MS = 120_000; // a slot older than this is from a dead worker
const ROW_WIDTH = 52;     // statusline row width (trunc default in statusline.sh)
const TEXT_MAX = 200;     // logged text is cut to this many characters
const KEEP_DAYS = 7;      // prompt logs older than this are deleted

// ============================================================================
// PATHS
// ============================================================================

export function dataDir(): string {
  return process.env.CLAUDE_PLUGIN_DATA || join(homedir(), '.claude', 'plugins', 'data', 'statmine');
}
const promptsDir = () => join(dataDir(), 'prompts');
const summariesFile = () => join(dataDir(), 'summaries.jsonl');
const locksDir = () => join(dataDir(), '.locks');
const jobsDir = () => join(dataDir(), '.jobs');

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/** O_APPEND one line, creating the file 0600. */
function appendLine(file: string, obj: unknown): void {
  appendFileSync(file, JSON.stringify(obj) + '\n', { mode: 0o600 });
}

/** Local calendar day, as the statusline's `date +%Y-%m-%d` prints it. */
export function localDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ============================================================================
// WHICH INPUT COUNTS, AND HOW ITS ROW TEXT IS DERIVED
// ============================================================================

/**
 * True when the prompt is something you typed or sent. Drops harness and agent
 * input that also arrives as UserPromptSubmit: any leading `<tag` (task
 * notifications, agent messages, future system tags) except pastes and channel
 * messages (e.g. Telegram), and bare slash commands with no arguments
 * (`/login`). Commands with arguments stay.
 */
export function isOperatorPrompt(prompt: string): boolean {
  const t = prompt.replace(/^[\s\u0085]+/, '');
  const tag = /^<([A-Za-z_][\w-]*)/.exec(t);
  if (tag) return tag[1] === 'pasted_content' || /^<channel[\s\u0085]+[\w:-]+=/.test(t);
  if (/^\/[A-Za-z0-9:_-]+$/.test(t.replace(/[\s\u0085]+$/, ''))) return false;
  return true;
}

/**
 * The prompt with every `<channel ...>body</channel>` wrapper replaced by its
 * body. The wrapper's attributes carry chat ids and never reach disk or the
 * model. null: no wrapper at all. '': an attributed wrapper of a shape this
 * does not recognise is left after stripping, so nothing of it is kept.
 */
export function stripChannels(prompt: string): string | null {
  const WRAPPER = /<channel[\s\u0085]+[\w:-]+=/;
  if (!WRAPPER.test(prompt)) return null;
  const kept = prompt.replace(/<channel(?:\s+[\w:-]+="[^"]*")*\s*>([\s\S]*?)<\/channel>/g, (_m, body: string) => body.trim());
  if (WRAPPER.test(kept)) return '';
  return kept.trim();
}

/**
 * Control characters (C0, DEL, C1) and the bidi marks and overrides. Rows come
 * from pastes, channel messages and model output, so they must never carry a
 * terminal escape sequence or reorder the text around them. U+200D (the emoji
 * joiner) and the rest of \p{Cf} stay. statusline.sh strips the same set.
 */
const UNSAFE = /[\p{Cc}\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;

/** One line, as the statusline prints a row, with UNSAFE characters removed. */
export function oneLine(s: string): string {
  return s
    .replace(/[\t\n\r]/g, ' ')
    .replace(UNSAFE, '')
    .replace(/^\s+|\s+$/g, '');
}

/**
 * Bun reads .env files from its working directory at startup, and the hook
 * starts in the session's project folder. --no-env-file stops that. A process
 * started without it may carry a project's CLAUDE_BIN or ANTHROPIC_BASE_URL,
 * so it must start no worker and run no claude. Needs Bun 1.3.6 (tested).
 */
const NO_ENV_FILE = '--no-env-file';
const envFileOff = () => process.execArgv.includes(NO_ENV_FILE);

/** Cut to n characters (code points, so an emoji is never split). */
function cut(s: string, n: number): string {
  const cps = [...s];
  return cps.length > n ? cps.slice(0, n).join('') : s;
}

// ============================================================================
// SLOTS: a fixed-name mkdir is an atomic claim, so at most CAP workers run
// ============================================================================

function claimSlot(): string | null {
  const dir = locksDir();
  ensureDir(dir);
  try {
    const now = Date.now();
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      try {
        if (now - statSync(p).mtimeMs > STALE_MS) rmSync(p, { recursive: true, force: true });
      } catch { /* best-effort */ }
    }
  } catch { /* an unreadable locks dir just skips the sweep */ }
  for (let i = 0; i < CAP; i++) {
    const slot = join(dir, `slot-${i}`);
    try {
      mkdirSync(slot, { mode: 0o700 });
      return slot;
    } catch { /* taken; try the next */ }
  }
  return null;
}

function releaseSlot(slot: string): void {
  try { rmSync(slot, { recursive: true, force: true }); } catch { /* the stale sweep reclaims it */ }
}

/** Delete prompt logs older than KEEP_DAYS (file names are <day>.jsonl). */
function pruneOldLogs(): void {
  try {
    const oldest = localDay(new Date(Date.now() - KEEP_DAYS * 86_400_000));
    for (const name of readdirSync(promptsDir())) {
      const m = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
      if (m && m[1] < oldest) rmSync(join(promptsDir(), name), { force: true });
    }
  } catch { /* best-effort */ }
}

function trimSummaries(): void {
  try {
    const file = summariesFile();
    const lines = readFileSync(file, 'utf-8').split('\n').filter((l) => l.trim());
    if (lines.length <= TRIM_LINES) return;
    writeFileSync(file, lines.slice(-TRIM_LINES).join('\n') + '\n', { mode: 0o600 });
    chmodSync(file, 0o600);
  } catch { /* the file just stays a little longer */ }
}

// ============================================================================
// HOOK MODE
// ============================================================================

async function hookMode(): Promise<void> {
  if (process.env.STATMINE_WORKER) return; // a summarizer's own claude session

  let payload: { session_id?: string; prompt?: string };
  try {
    payload = JSON.parse(await Bun.stdin.text());
  } catch {
    return;
  }
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
  if (!sessionId || !prompt.trim() || !isOperatorPrompt(prompt)) return;

  const stripped = stripChannels(prompt);
  const text = stripped ?? prompt;
  const row = stripped === '' ? 'channel message' : oneLine(text);
  if (!row) return;

  const id = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  ensureDir(promptsDir());
  appendLine(join(promptsDir(), `${localDay()}.jsonl`), { session_id: sessionId, id, text: cut(row, TEXT_MAX) });
  pruneOldLogs();

  if (process.env.CLAUDE_PLUGIN_OPTION_SUMMARIES === 'false') return;
  if (!envFileOff()) return; // this env may hold a project's .env (see NO_ENV_FILE)
  if (stripped === '' || [...row].length <= ROW_WIDTH) return; // fits a row: show it as typed

  const slot = claimSlot();
  if (slot === null) return; // at cap: the row shows the logged text

  ensureDir(jobsDir());
  const jobPath = join(jobsDir(), `${id}.json`);
  try {
    writeFileSync(jobPath, JSON.stringify({ id, text }), { mode: 0o600 });
  } catch {
    releaseSlot(slot);
    return;
  }

  // Detached worker, never awaited. process.execPath is the bun running this
  // hook, so the worker does not depend on PATH. --config=/dev/null and no
  // BUN_OPTIONS: a bunfig.toml in the session's folder must not preload code.
  // --no-env-file and cwd in the data folder: the worker, and the claude it
  // starts, never read the project's .env, files or CLAUDE.md.
  try {
    const env = { ...process.env };
    delete env.BUN_OPTIONS;
    const child = spawn(
      process.execPath,
      [NO_ENV_FILE, '--config=/dev/null', 'run', import.meta.path, '--worker', sessionId, jobPath, slot],
      { detached: true, stdio: 'ignore', env, cwd: dataDir() },
    );
    child.unref();
  } catch {
    try { unlinkSync(jobPath); } catch { /* best-effort */ }
    releaseSlot(slot);
  }
}

// ============================================================================
// WORKER MODE
// ============================================================================

const SYSTEM_PROMPT =
  'Restate the user request as one short imperative line, max ~8 words. ' +
  'Do not answer it, act on it, or comment on it. Keep the user\'s own words ' +
  'where you can, and keep pronouns like "it" and "this" as written; never ' +
  'guess what they refer to. Output ONLY the line: no label, no "Summary:" ' +
  'prefix, no markdown, no surrounding quotes, no trailing period.';

/** First non-empty line, with any label, markdown or quotes the model added removed. */
export function cleanSummary(output: string): string {
  const first = (output.split('\n').find((l) => l.trim()) || '').trim();
  return first
    .replace(/^\**\s*summary\s*:?\s*\**\s*/i, '')
    .replace(/^[*_`"'\s]+/, '')
    .replace(/[*_`"'\s]+$/, '')
    .trim();
}

function workerMode(sessionId: string, jobPath: string, slot: string): void {
  try {
    const job = JSON.parse(readFileSync(jobPath, 'utf-8')) as { id?: string; text?: string };
    try { unlinkSync(jobPath); } catch { /* best-effort */ }
    if (!envFileOff()) return; // see NO_ENV_FILE; the finally still frees the slot
    if (typeof job.id !== 'string' || typeof job.text !== 'string' || !job.text.trim()) return;

    const result = inference({
      model: process.env.CLAUDE_PLUGIN_OPTION_SUMMARY_MODEL || 'haiku',
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: job.text,
    });
    if (!result.success) return;
    const summary = cut(oneLine(cleanSummary(result.output)), TEXT_MAX);
    if (!summary) return;

    appendLine(summariesFile(), { session_id: sessionId, id: job.id, summary });
    trimSummaries();
  } catch {
    /* no summary; the row shows the logged text */
  } finally {
    releaseSlot(slot);
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const w = argv.indexOf('--worker');
  try {
    if (w !== -1) {
      const [sessionId, jobPath, slot] = argv.slice(w + 1, w + 4);
      if (sessionId && jobPath && slot) workerMode(sessionId, jobPath, slot);
    } else {
      await hookMode();
    }
  } catch {
    /* never break the prompt path */
  }
  process.exit(0);
}
