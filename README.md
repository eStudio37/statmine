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

Or on one line, with `/statmine:mode compact`:

```
米Claude Code 21:44 │ ↑0 ↓3 myapp--search ⎇ search-filters* │ ▰▱▱▱▱▱▱▱▱▱ 120k/1000k │ Opus 5.5 high
```

- **Where a commit lands:** folder, repo and branch, green when they agree, amber when a worktree folder has another branch checked out, red when a commit would land in a different repo than the session's.
- **Commit counts:** unpushed (`↑`) and branch-only (`↓`), with `⊘` when there is no remote or nothing committed yet.
- **Context:** window use, tokens, model and effort.
- **Your last three requests:** only what you typed, with one-line summaries of long prompts.

Everything stays on your machine, readable only by you. Summaries, which you can turn off, go through your own `claude` CLI.

## Requirements

`bash`, `jq`, `git` 2.31+, and [Bun](https://bun.sh) on your `PATH`; the `claude` CLI for summaries. Tested on Linux.

## Install

Run each line as its own prompt in Claude Code:

```
/plugin marketplace add eStudio37/statmine
```

```
/plugin install statmine@statmine
```

Then `/reload-plugins` (or restart) and:

```
/statmine:setup
```

Setup backs up `~/.claude/settings.json` and points your statusline at statmine. It asks before replacing an existing one.

## Documentation

- [User guide](docs/user-guide.md): reading every part of the statusline, options, your data, troubleshooting, uninstall.
- [How it works](docs/how-it-works.md): design, data flow, file formats, rules, security properties, limits, development and releases.

## License

MIT
