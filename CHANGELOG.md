# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-10-23

This is the first tagged release. Version 0.1.0 was never tagged, and there was no 1.x release.

### Added

- A user guide (`docs/user-guide.md`): install, every part of both views, options, stored data, troubleshooting and uninstall.
- A how-it-works document (`docs/how-it-works.md`): design, data flow, file formats, the prompt rule, summaries, the commit cell, security properties, limits, development and releases.
- This changelog, `CONTRIBUTING.md`, `.editorconfig`, and a bug report form that links Claude Code's own tracker.
- CI checks: shellcheck 0.11.0 on every `.sh` file (checksum-verified download) and a TypeScript check with `typescript` 6.0.3 and `@types/bun` 1.3.6, both pinned as dev dependencies. They are dev tools only; the plugin loads no package.
- A security review, `docs/security-review-2.0.0.md`, and 11 security tests in `tests/security.test.ts`.

### Changed

- The README is now a front page: badges, a render of both views, features, and what statmine can access.
- Supported platforms: Linux and WSL. macOS has not been tested.
- Bun 1.3.6 or later is required: the prompt hook runs with `--no-env-file`.
- CI actions are pinned to commit SHAs, and checkout keeps no credentials.
- `/statmine:mode` writes its file with `umask 077`, so it is private like the rest of the data folder.
- `/statmine:setup` and `/statmine:mode` no longer search `~/.claude/plugins/data/` for the data folder. They use the folder Claude Code fills in.

### Security

Found in the 2.0.0 security review (`docs/security-review-2.0.0.md`) and fixed, each with tests:

- A project's `.env` file could set the `claude` binary or the API host used for summaries. The hook and the summary worker now run with `--no-env-file`, and the worker runs in the data folder.
- Git config in the session folder (`core.fsmonitor`, filter drivers, submodules) could run commands on every statusline redraw. Every git call now turns them off.
- Terminal control characters and bidi overrides in prompts, summaries and folder names reached the output. They are now removed when written and when read.

## [0.1.0] - 2026-10-23

### Added

- A statusline that shows where a commit will land: folder, repo and branch, green when they agree, amber when a worktree folder has another branch checked out, red when a commit would land in a different repo than the session's.
- Unpushed (`↑`) and branch-only (`↓`) commit counts, with `⊘` when there is no remote or nothing committed yet.
- Context window use, tokens, model and effort.
- Your last three requests, with optional one-line summaries of long prompts through your own `claude` CLI.
- A full view and a one-line compact view, switched with `/statmine:mode`.
- `/statmine:setup`, which backs up `~/.claude/settings.json` and points `statusLine` at statmine.
- Prompt logging and summaries as plugin hooks, with their data kept private in the plugin data folder.
- Options for the header label, summaries and the summary model.

[Unreleased]: https://github.com/eStudio37/statmine/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/eStudio37/statmine/releases/tag/v2.0.0
[0.1.0]: https://github.com/eStudio37/statmine/commit/8e09399bdfa2cd186d8a52a5ebbd9e9ba580f968
