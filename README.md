# statmine

A statusline for Claude Code that answers three questions at a glance: where will a commit land, how full is my context, and what did I just ask for.

```
米Claude Code  v0.1.0  Thursday, October 22, 2026  21:44
↑0 ↓3  myapp--search → myapp ⎇ search-filters*  ⏱ 1h30m
▰▰▱▱▱▱▱▱▱▱▱▱▱▱ 12%  120k/1000k  Opus 5.5  effort high
3. Add a date filter to the search page
2. now the tests
1. Fix the flaky search test
```

A compact view fits it on one line:

```
米Claude Code 21:44 │ ↑0 ↓3 myapp--search ⎇ search-filters* │ ▰▱▱▱▱▱▱▱▱▱ 120k/1000k │ Opus 5.5 high
```

## What it shows

**Where a commit lands.** `folder → repo ⎇ branch`, colored by how well they agree:

| Color | Meaning |
|---|---|
| green | A commit lands in this session's repo, on the branch the folder name suggests. |
| amber | Same repo, but a `<repo>--<name>` worktree folder has a different branch checked out, or HEAD is detached. |
| red | A commit from here lands in a different repo than the one the session started in. |

A `*` after the branch means uncommitted changes.

**Two slots before it.** The left slot is the remote: `↑N` commits not pushed yet, or `⊘` when the repo has no remote. The right slot is local: `↓N` commits on this branch that `main` (or `master`) does not have, or `⊘` when there are none. Both use local refs only, so `↑N` is as of your last `git fetch`.

**Context.** A bar and percent of the context window, tokens used out of the window, the model, and the reasoning effort.

**Your last three requests.** Numbered so the newest, at the bottom, is `1.`. Only what you typed counts: task notifications, agent messages and bare slash commands such as `/login` are left out. Short prompts show as typed. Long ones get a one-line summary from a small model, which replaces the cut-off text a few seconds later.

## Requirements

- Claude Code with plugin support
- `bash`, `jq`, and `git` 2.31 or later
- [Bun](https://bun.sh) on your `PATH`, for the request rows
- The `claude` CLI on your `PATH`, for summaries (optional)

Tested on Linux. macOS should work but has not been tested yet.

## Install

In a Claude Code session:

```
/plugin marketplace add eStudio37/statmine
/plugin install statmine@statmine
```

Restart Claude Code (or run `/reload-plugins`), then run:

```
/statmine:setup
```

A plugin cannot set the statusline on its own, so setup does it: it backs up `~/.claude/settings.json`, then points `statusLine` at the statmine script with a 10 second refresh. It asks first if you already have a statusline.

## Use

| Command | Does |
|---|---|
| `/statmine:mode compact` | One-line view |
| `/statmine:mode full` | Full view (the default) |
| `/statmine:mode` | Shows the current view |

## Options

Change these with `/plugin configure statmine@statmine` or in `/config`. They apply from the next session.

| Option | Default | |
|---|---|---|
| Header label | `米Claude Code` | Text at the start of the statusline. Empty for none. |
| Summarize long requests | on | One model call per long prompt, on your own Claude account. |
| Summary model | `haiku` | Any value `claude --model` accepts. |

## What it stores, and where

Everything stays on your machine, in the plugin's data folder (`~/.claude/plugins/data/statmine-statmine/` for a marketplace install), readable only by you (folders `0700`, files `0600`):

- `prompts/<day>.jsonl`: each prompt you type, as one line cut to 200 characters. Channel wrappers (for example Telegram's chat ids) are removed first. Days older than 7 are deleted.
- `summaries.jsonl`: the last 200 summaries.
- `statusline.sh`, `config.json`, `mode`: the script and your settings, refreshed at each session start.

When summaries are on, the text of a long prompt is sent to the summary model through your own `claude` CLI. Turn them off to keep every prompt local.

## Uninstall

```
/plugin uninstall statmine@statmine
```

Then remove the `statusLine` entry from `~/.claude/settings.json`, or restore the backup setup made (`settings.json.statmine-backup-<time>`).

## Develop

```
bun test tests
claude plugin validate .
claude --plugin-dir .
```

## License

MIT
