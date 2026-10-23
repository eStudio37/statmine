# How statmine works

This document is for anyone who wants to understand, audit or change statmine. For using it, see the [user guide](user-guide.md).

## Contents

- [The parts](#the-parts)
- [Why it is built this way](#why-it-is-built-this-way)
- [Data flow](#data-flow)
- [File formats](#file-formats)
- [What counts as your prompt](#what-counts-as-your-prompt)
- [Summaries](#summaries)
- [The commit cell](#the-commit-cell)
- [Security and privacy](#security-and-privacy)
- [Limits](#limits)
- [Developing](#developing)
- [Releasing](#releasing)

## The parts

```
.claude-plugin/
  plugin.json         manifest and the three user options
  marketplace.json    makes the repo installable as a one-plugin marketplace
hooks/
  hooks.json          wires the two hooks below
  sync.sh             SessionStart: copies the script and options into the data folder
  on-prompt.ts        UserPromptSubmit: logs prompts, starts summaries
  lib/inference.ts    one-shot call to the claude CLI
scripts/
  statusline.sh       the statusline Claude Code runs
skills/
  setup/SKILL.md      /statmine:setup
  mode/SKILL.md       /statmine:mode
tests/                bun tests for all of the above
```

## Why it is built this way

**A plugin cannot set `statusLine`.** Claude Code applies only `agent` and `subagentStatusLine` from a plugin's settings. So `/statmine:setup` writes the user's `statusLine` once, and everything else is done by the plugin's hooks.

**The statusline runs a copy, not the plugin's own script.** The plugin's folder (`$CLAUDE_PLUGIN_ROOT`) changes with every update, so a `statusLine` command pointing into it would break. The plugin data folder (`$CLAUDE_PLUGIN_DATA`) survives updates, so `sync.sh` copies the script there at every session start and `statusLine` points at the copy.

**The statusline reads a config file, not plugin variables.** Claude Code passes `CLAUDE_PLUGIN_OPTION_*` to hook processes; whether the statusline process gets them is not documented. So `sync.sh` writes the options the statusline needs (`label`, `version`) to `config.json`.

**One prompt hook does both jobs.** Hooks in the same event run in parallel. An earlier design had one hook log prompts and another summarize them, joined by the prompt's first 100 characters, and summaries sometimes landed on the wrong row. Now a single hook writes the log line and starts the summary under the same random id, so a summary can only ever attach to its own prompt.

## Data flow

```
 you type a prompt
        │
        ▼
 on-prompt.ts (UserPromptSubmit, returns at once)
   ├─ not yours? (system tag, bare /command) ─────────► nothing written
   ├─ append {session_id, id, text} ──────────────────► prompts/<day>.jsonl
   └─ longer than a row and summaries on?
        └─ claim a slot, stage {id, text} in .jobs/, spawn a detached worker
                │
                ▼
          worker: claude --print (prompt on stdin)
                └─ append {session_id, id, summary} ──► summaries.jsonl

 session starts ──► sync.sh ──► statusline.sh, config.json

 every event and every 10 s ──► statusline.sh
   reads: stdin JSON (session, model, context), config.json, mode,
          prompts/<yesterday>.jsonl + prompts/<today>.jsonl, summaries.jsonl,
          git state of the current folder
   prints: full view or compact view
```

## File formats

All files live in the plugin data folder, `~/.claude/plugins/data/statmine-statmine/` for a marketplace install (`statmine-inline` under `claude --plugin-dir`). The folder is `0700` and every file `0600`. JSONL files hold one JSON object per line, written by an append so concurrent writers never interleave lines.

**`prompts/<YYYY-MM-DD>.jsonl`**, one line per prompt you typed, named by local date:

```json
{"session_id":"0f1e…","id":"mgx3k2a1-9c4e1f20","text":"Fix the flaky search test"}
```

- `id`: base-36 milliseconds plus 8 random hex characters.
- `text`: the prompt as one line (tabs and newlines turned into spaces, ends trimmed), channel wrappers removed, cut to 200 code points. A channel wrapper of a shape the hook does not recognise is replaced by `channel message`, never kept.

**`summaries.jsonl`**, one line per summary, the last 200 kept:

```json
{"session_id":"0f1e…","id":"mgx3k2a1-9c4e1f20","summary":"Fix the flaky search test"}
```

**`config.json`**, written by `sync.sh`:

```json
{"label":"米Claude Code","version":"2.0.0"}
```

An unset label option becomes the default label. A label option set to an empty string becomes `""` and the statusline shows no label.

**`mode`**: the word `full` or `compact`. Anything else, or no file, means `full`.

**`.locks/slot-0` to `slot-2`, `.jobs/<id>.json`**: summarizer working state, normally empty.

## What counts as your prompt

`isOperatorPrompt()` in `on-prompt.ts` decides. After leading whitespace:

| Prompt starts with | Counted |
|---|---|
| `<pasted_content` | yes |
| `<channel` followed by attributes (a channel plugin message) | yes |
| any other `<tag` (task notifications, agent messages, future system tags) | no |
| `/command` with nothing after it | no |
| `/command` with arguments | yes |
| anything else | yes |

Prompts that are not counted are never written to disk. The statusline shows only what the log holds, so this one function is the whole rule.

## Summaries

A prompt gets a summary when summaries are on and its one-line text is longer than 52 code points, the width of a row. The hook then:

1. Claims one of 3 fixed slots by creating its folder (`mkdir` is atomic, so two hooks cannot claim the same slot). A slot older than 2 minutes is from a dead worker and is reclaimed. With all 3 taken, the prompt is not summarized.
2. Writes the full text to `.jobs/<id>.json`, so it never appears in a process's arguments.
3. Starts a detached worker with the same Bun binary (`process.execPath`), `--no-env-file`, `--config=/dev/null`, and `BUN_OPTIONS` removed, in the data folder (`cwd`). So a `bunfig.toml` or `.env` in your project cannot load code or settings into it. The hook itself also runs with `--no-env-file` (see `hooks/hooks.json`), and it starts no worker if it was started without that flag.
4. Returns. The prompt is never delayed or changed.

The worker deletes the job file, then runs:

```
claude --print --model <summary_model> --output-format text \
  --system-prompt <restate, do not answer> --tools '' --setting-sources ''
```

with the text on stdin and `STATMINE_WORKER=1` in its environment. `--tools ''` gives the child no tools. `--setting-sources ''` is meant to load no settings, and so no hooks or plugins; this has not been verified on every Claude Code version, so `STATMINE_WORKER=1` guards the case where the prompt hook runs anyway: it exits at once. The worker keeps the first line of the answer, strips any `Summary:` label, markdown or quotes, and appends it. Any failure (no `claude`, a non-zero exit, a 30 second timeout) leaves no summary, and the row keeps showing the logged text.

The `claude` binary is `$CLAUDE_BIN` when that is an absolute path, else `claude` from `PATH`.

## The commit cell

All values come from git commands run in the session's current folder (`workspace.current_dir` in the statusline input):

| Value | Command |
|---|---|
| repo | `basename` of the parent of `git rev-parse --path-format=absolute --git-common-dir`, so a worktree reports its main repository |
| session repo | the same, for `workspace.project_dir` |
| branch | `git branch --show-current`, else `detached@<short hash>` |
| dirty `*` | `git --no-optional-locks status --porcelain` prints anything |
| `↑N` | `git rev-list --count HEAD --not --remotes` |
| `↓N` | `git rev-list --count <trunk>..HEAD`, where the trunk is `main`, else `master`; on the trunk or with no trunk, `git rev-list --count HEAD` |

Color rules, in order: red when repo differs from the session repo; amber when HEAD is detached, or when the folder is named `<x>--<slug>` and no `/`-separated part of the branch equals `<slug>` or starts with `<slug>-` (compared lowercase); green otherwise.

`--no-optional-locks` keeps a redraw from taking the index lock that your own git commands need.

## Security and privacy

- **Local only.** The statusline makes no network calls. The only network use is the optional summary, through the user's own `claude` CLI and account.
- **Private files.** The data folder is created `0700` and files `0600`, because prompt text is private.
- **No chat ids on disk.** Channel wrappers are stripped before anything is written or sent to a model.
- **No prompt text in arguments.** Prompt text reaches the worker through a `0600` job file and `claude` through stdin, never argv, which other accounts on a shared machine can read with `ps`.
- **No recursion.** The summarizer's `claude` session runs with no tools and no setting sources, and is marked with `STATMINE_WORKER=1`, which stops statmine's own hook in it.
- **No project `.env`.** Bun reads `.env` files from its working directory, and the hook starts in the project folder. The hook and the worker run with `--no-env-file`, so a project's `.env` cannot set `CLAUDE_BIN` or `ANTHROPIC_BASE_URL`. The worker and its `claude` start in the data folder. A hook or worker started without the flag makes no summary. This needs Bun 1.3.6 (tested); an older Bun was not checked.
- **No commands from git config.** The statusline runs git in the session's folder at every redraw. Every call passes `-c core.fsmonitor=false`. `git status` also passes `--ignore-submodules=dirty` and blanks each filter `clean` and `process` command that is not from your global or system config. Remaining risk: git still reads the folder's config, and a later git may add a config key that runs a command during these calls.
- **No terminal escapes.** Control characters (C0, DEL, C1) and the bidi marks and overrides are removed from prompt rows, summaries, folder, repo and branch names, the label, the model and the effort, both when the hook writes and when the statusline reads. Only the statusline's own colour codes reach the terminal.
- **Bounded growth.** Prompt logs older than 7 days are deleted; summaries keep the last 200.
- **Session isolation.** The statusline shows rows only for its own session id, and shows none when the id is missing.
- **Fail-soft.** Every part exits 0 on bad input or missing data. A broken statmine leaves Claude Code running, with fewer rows.

## Limits

- `↑N` is only as fresh as the last fetch: statmine never fetches.
- The local slot knows only `main` and `master` as trunks.
- Request rows come from yesterday's and today's logs only. A prompt typed before yesterday no longer shows, even in a session still running.
- A long prompt that arrives while 3 summaries are running keeps its cut text.
- Trimming `summaries.jsonl` rewrites the file, so a summary appended at the same instant can be lost (rare; that row keeps its logged text).
- A changed label takes effect at the next session start, when `sync.sh` runs.
- The date line uses GNU `date` flags with a BSD fallback for yesterday's date; macOS has not been tested.
- A plugin update reaches the statusline at the next session start.

## Developing

```
bun test tests            # black-box tests
claude plugin validate .  # manifest, marketplace and directory checks
claude --plugin-dir .     # a session with this checkout loaded
bash tools/render-demo.sh # redraw the README images in docs/images/
```

Run `tools/render-demo.sh` after a change to what the statusline prints, so the README images stay true. It builds a throwaway sample repo, pins the clock, runs the real script in both views, and turns the colored output into SVG with `tools/ansi-to-svg.ts`.

The tests run the real scripts as child processes, with a temporary data folder, a `date` shim that pins the clock, temporary git repositories, and a stub in place of `claude` that records its arguments and stdin. They never call a real model.

`bun test` runs in UTC while the hook and the statusline use local time, so tests that depend on the day ask `date` for it rather than using JavaScript's clock.

When changing the row width, change it in both places: `ROW_WIDTH` in `on-prompt.ts` and the `trunc` default in `statusline.sh`.

## Releasing

1. Bump `version` in `.claude-plugin/plugin.json`. Users see it in the header after updating.
2. Update `CHANGELOG.md`: move the `[Unreleased]` entries under a new version heading with the date, and update the compare links at the bottom.
3. Run the tests and `claude plugin validate .`.
4. Commit, tag (`v2.0.0`) and push. Users get it with `claude plugin update statmine@statmine`.
