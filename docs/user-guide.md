# statmine user guide

statmine replaces the Claude Code statusline with one that answers three questions at a glance:

1. If I commit from here, where does it land?
2. How full is my context window?
3. What did I just ask for?

This guide covers installing it, reading it, changing it, and fixing it when something looks wrong. For how it works inside, see [how-it-works.md](how-it-works.md).

## Contents

- [Install](#install)
- [Reading the full view](#reading-the-full-view)
- [The compact view](#the-compact-view)
- [Options](#options)
- [Your data](#your-data)
- [Troubleshooting](#troubleshooting)
- [Update and uninstall](#update-and-uninstall)
- [Questions](#questions)

## Install

### What you need

| Tool | Needed for | Check with |
|---|---|---|
| Claude Code with plugin support | everything | `claude --version` |
| `bash` | the statusline | `bash --version` |
| `jq` | the statusline | `jq --version` |
| `git` 2.31 or later | the git row | `git --version` |
| [Bun](https://bun.sh) | the request rows | `bun --version` |
| `claude` CLI on your `PATH` | summaries (optional) | `command -v claude` |

Without `jq` the statusline shows only the time and a reminder to install it. Without Bun the request rows stay empty; everything else works.

### Steps

Run each line as its own prompt in a Claude Code session:

```
/plugin marketplace add eStudio37/statmine
```

```
/plugin install statmine@statmine
```

Choose the user scope when asked, so statmine works in every project. To install from a local copy instead, pass its folder: `/plugin marketplace add ~/path/to/statmine`.

Then load it, with `/reload-plugins` or by restarting Claude Code, and run:

```
/statmine:setup
```

Setup does four things:

1. Checks the tools above and tells you what is missing.
2. Copies the statusline script into statmine's data folder.
3. Backs up `~/.claude/settings.json` to `settings.json.statmine-backup-<time>`.
4. Points `statusLine` at the statmine script, with a 10 second refresh.

If you already have a statusline, setup shows it and asks before replacing it. The new statusline appears within 10 seconds.

Setup is needed once because a Claude Code plugin cannot set the statusline by itself.

## Reading the full view

```
米Claude Code  v0.1.0  Thursday, October 22, 2026  21:44
↑0 ↓3  myapp--search → myapp ⎇ search-filters*  ⏱ 1h30m
▰▰▱▱▱▱▱▱▱▱▱▱▱▱ 12%  120k/1000k  Opus 5.5  effort high
3. Add a date filter to the search page
2. now the tests
1. Fix the flaky search test
```

### Line 1: header

The label (yours to set, see [Options](#options)), statmine's version, the date and the time.

### Line 2: where a commit lands

`myapp--search → myapp ⎇ search-filters*` reads as: you are in the folder `myapp--search`, which commits into the repository `myapp`, on the branch `search-filters`.

The color is the point of this cell:

| Color | Meaning | What to do |
|---|---|---|
| green | A commit lands in this session's repo, on the branch the folder name suggests. | Nothing. |
| amber | Same repo, but something does not match: a `<repo>--<name>` worktree folder has another branch checked out, or HEAD is detached (`detached@a1b2c3d`). | Check the branch before you commit. |
| red | A commit from here lands in a different repository than the one this session started in. | Check you are where you mean to be. |

How the folder and branch are compared: for a folder named `<repo>--<name>`, the branch matches when one of its `/`-separated parts equals `<name>` or starts with `<name>-`. So `myapp--search` matches `search`, `feature/search` and `search-filters`, but not `fix-search`. Folders without `--` (a main checkout, for example) are only checked for the repo.

A `*` after the branch means you have uncommitted changes.

**The two slots before it** count commits, each replaced by an amber `⊘` when its thing does not exist yet:

| Slot | Shows | `⊘` means |
|---|---|---|
| left, remote | `↑N`: commits on this branch that are not on any remote yet | the repo has no remote |
| right, local | `↓N`: commits on this branch that `main` (or `master`) does not have; on `main` itself, all commits | there are none |

So `⊘ ⊘` is a new repo with nothing committed and nowhere to push, `⊘ ↓4` is local work with no remote yet, and `↑0 ↓3` is a branch with three commits of its own, all pushed.

statmine never fetches. `↑N` is as of your last `git fetch`, `git pull` or `git push`.

**`⏱ 1h30m`** is how long this session has been running.

Outside a git repository the cell shows only the folder name, in gray.

### Line 3: context

The bar and percent show how much of the context window is in use. They share one number, so they always agree. The percent changes color as the window fills:

| Percent | Color |
|---|---|
| under 70 | green |
| 70 to 85 | amber |
| over 85 | red |

Then the tokens in use out of the window size (`120k/1000k`), the model, and the reasoning effort, colored by level: low green, medium blue, high amber, xhigh or max red.

### Lines 4 to 6: your last three requests

The last three prompts you typed in this session, oldest first, numbered so the newest one, at the bottom, is `1.`.

- **Only what you typed counts.** Task notifications, agent messages and other text Claude Code sends on its own are left out, and so are bare slash commands such as `/login` or `/clear`. Commands with arguments, such as `/plan fix the build`, stay.
- **Short prompts show as typed.** Long ones show their first 49 characters and `...`, and a few seconds later a one-line summary replaces them, if summaries are on.
- **Pasted text and messages from channel plugins** (Telegram, for example) count as yours. The channel's wrapper, which carries chat ids, is removed before anything is saved.
- The rows carry over midnight, then reset for a new session.

## The compact view

```
米Claude Code 21:44 │ ↑0 ↓3 myapp--search ⎇ search-filters* │ ▰▱▱▱▱▱▱▱▱▱ 120k/1000k │ Opus 5.5 high
```

The same information on one line, minus the repo name, the version, the date, the session time, the percent and the request rows. The commit cell keeps its color.

Switch views at any time:

```
/statmine:mode compact
/statmine:mode full
/statmine:mode
```

The last one prints the current view. A switch shows within 10 seconds.

## Options

Open them with `/plugin configure statmine@statmine`, or find statmine in `/config`.

| Option | Default | What it does |
|---|---|---|
| Header label | `米Claude Code` | Text at the start of both views. Leave it empty for none. |
| Summarize long requests | on | Asks a small model for a one-line summary of prompts too long for a row. |
| Summary model | `haiku` | Any value `claude --model` accepts, such as `sonnet` or a full model id. |

A new label shows from the next session, when statmine copies your options for the statusline. The two summary options are read by the prompt hook on each prompt; if a change does not seem to apply, run `/reload-plugins` or start a new session.

**About summaries.** Each long prompt costs one call to the summary model, made through your own `claude` CLI and account. At most three run at once; a long prompt that arrives while three are running keeps its cut-off text. With summaries off, statmine itself sends nothing anywhere. Your prompts still go to Claude as they always do.

## Your data

Everything statmine keeps is on your machine, in its data folder:

```
~/.claude/plugins/data/statmine-statmine/
```

The folder is `0700` and its files `0600`, so only your user account can read them.

| File | Holds | Kept for |
|---|---|---|
| `prompts/<day>.jsonl` | Each prompt you typed, as one line, cut to 200 characters | 7 days |
| `summaries.jsonl` | The summaries | the last 200 |
| `statusline.sh` | The statusline script | refreshed each session |
| `config.json` | Your label and statmine's version | refreshed each session |
| `mode` | `full` or `compact` | until you change it |

Uninstalling the plugin deletes this folder, unless you uninstall with `claude plugin uninstall statmine@statmine --keep-data`.

## Troubleshooting

**The statusline did not change after install.** Run `/statmine:setup`; installing the plugin alone does not change the statusline. Then check what Claude Code runs:

```
jq .statusLine ~/.claude/settings.json
```

The command must point at `.../plugins/data/statmine-statmine/statusline.sh`.

**The statusline says "install jq".** Install `jq` with your package manager.

**There are no request rows.** Check that Bun is on your `PATH` (`command -v bun`): Claude Code starts the prompt hook as `bun`, and without it the hook cannot run (Claude Code may also show a hook error on each prompt). Rows appear for prompts typed after the plugin loaded, in the current session only. A new session starts with none.

**Long prompts never get a summary.**
- Check that summaries are on in the options.
- Check that `claude` is on your `PATH` (`command -v claude`), or set `CLAUDE_BIN` to its absolute path.
- Check that your summary model name works: `echo hi | claude --print --model haiku`.

**The git cell is amber but I am on the right branch.** The folder is named `<repo>--<name>` and the branch does not contain `<name>`, as explained in [Line 2](#line-2-where-a-commit-lands). Rename the folder or the branch, or ignore the color for that worktree.

**`↑N` looks wrong.** It counts against what your last fetch saw. Run `git fetch`.

**`↓N` is too high on a `develop` trunk.** The local slot compares against `main`, or `master` when there is no `main`. In a repo with neither, it counts every commit on the branch.

**The rows did not carry over midnight on macOS.** statmine reads yesterday's prompts with GNU `date -d` and falls back to BSD `date -v`. If neither works on your system, only today's prompts show.

**Something else.** Run the script by hand and read any error:

```
printf '{"session_id":"test","workspace":{"current_dir":"%s"}}' "$PWD" \
  | bash ~/.claude/plugins/data/statmine-statmine/statusline.sh
```

## Update and uninstall

**Update** from a terminal with `claude plugin update statmine@statmine`, or through the `/plugin` menu. The new statusline script takes over at the next session start.

**Uninstall:**

1. `/plugin uninstall statmine@statmine`
2. Remove the `statusLine` entry from `~/.claude/settings.json`, or restore the backup setup made (`~/.claude/settings.json.statmine-backup-<time>`).

Skip step 2 and Claude Code keeps trying to run a script that no longer exists.

## Questions

**Does statmine send anything over the network?** The statusline itself never does. The prompt hook does only when summaries are on, and only through your own `claude` CLI.

**Does it slow Claude Code down?** The prompt hook writes one line and summarizes in the background. The statusline takes about 50 to 70 ms per redraw on a typical Linux machine; the 10 second refresh keeps the clock and git cell current while Claude Code is idle.

**Does it read my code?** It asks git for the folder you are in: the branch, commit counts, and whether any file has uncommitted changes. It does not store or send anything about your code.

**Can I keep my old statusline as well?** Claude Code runs one statusline command. Restore your backup to go back.

**Can I change the colors or layout?** Not through options. The script is plain bash in `scripts/statusline.sh`; see [how-it-works.md](how-it-works.md) before changing it.
