# Release check: statmine 2.0.0

Branch `release/2.0.0`, checked on 2026-10-23. Each success criterion has its evidence below. Nothing is pushed.

## Success criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Security review filed, 0 open Musts | Pass | `docs/security-review-2.0.0.md`: Musts M1, M2 and M3 are all "Fixed", each with tests in `tests/security.test.ts`. A fresh review of the fixes found 2 more Musts (both part of M1: the `hooks.json` flag and the Bun minimum in the docs), and both are fixed |
| 2 | bun test, bash -n, shellcheck and the TypeScript check pass | Pass | See "Check output" below: 43 pass, 0 fail; `bash -n` exit 0; shellcheck 0.11.0 exit 0; `tsc --noEmit` exit 0 |
| 3 | `claude plugin validate` passes | Pass | "Validation passed" |
| 4 | A sample payload renders both views and exits 0 | Pass | See "Render" below |
| 5 | `0.1.0` appears only in CHANGELOG history | Pass | 3 hits, all in `CHANGELOG.md` |
| 6 | WHAT 4-6 files and sections exist | Pass | README: CI and licence badges, both views, Features, What statmine can access, Troubleshooting, Development. `CONTRIBUTING.md`, `.editorconfig`, `.github/ISSUE_TEMPLATE/bug_report.yml` and `config.yml`. Platform: "Linux and WSL. macOS has not been tested." in the README, with the reason in `test.yml` |
| 7 | Clean tree on `release/2.0.0`; tag `v2.0.0` on its last commit | Pass | `git status` is clean after the last commit; `git tag --points-at HEAD` shows `v2.0.0` |

## Check output

```
$ bun install --frozen-lockfile
Checked 5 installs across 6 packages (no changes)
$ bun test tests
 43 pass
 0 fail
 181 expect() calls
Ran 43 tests across 4 files.
$ git ls-files -z '*.sh' | xargs -0 -n1 bash -n
exit=0
$ shellcheck (version 0.11.0) on every tracked .sh file
exit=0
$ bun x tsc --noEmit
exit=0
$ claude plugin validate .
✔ Validation passed
```

## Render

A sample payload (session `release-check`, Opus 5.5, medium effort, 120k of 1000k tokens) in this repo, with ANSI codes removed:

```
$ render full
米Claude Code  v2.0.0  Friday, October 23, 2026  15:10
↑1 ↓1  statmine → statmine ⎇ release/2.0.0*  ⏱ 0s
▰▱▱▱▱▱▱▱▱▱▱▱▱▱ 12%  120k/1000k  Opus 5.5  effort medium
exit=0
$ render compact
米Claude Code 15:10 │ ↑1 ↓1 statmine ⎇ release/2.0.0* │ ▰▱▱▱▱▱▱▱▱▱ 120k/1000k │ Opus 5.5 medium
exit=0
```

## Decisions

Each decision gate was settled with quack at medium effort, or by the orchestrator, and was not taken to Manos.

| Question | Decision | Why |
|---|---|---|
| Budget (the goal text left `<TOKENS>` unset) | A provisional 5M tokens | It is the orchestrator's working cap. Manos can change it |
| macOS CI job, or Linux and WSL only | Linux and WSL only | The test harness needs GNU `date`, and macOS was never tested. Adding macOS needs a BSD `date` shim and a bash 3.2 check |
| TypeScript version | `typescript` 6.0.3, exact | A stable release, not the latest (7.0.2 on the registry today). It passes with no `skipLibCheck` |
| Bun types version | `@types/bun` 1.3.6, exact | Matches the tested Bun |
| shellcheck in CI | v0.11.0 tarball, sha256-checked against a fixed digest | An exact, verified version, with no package manager |
| GitHub actions | Pinned to commit SHAs, with the version in a comment; checkout keeps no credentials | Fixes S7 of the security review |
| Bash and shellcheck file list | Every tracked `.sh` file, through `git ls-files` | A new script cannot skip the checks |
| M1 fix, part in `hooks.json` | The flag in `hooks.json`, plus a code guard: no worker and no `claude` unless `--no-env-file` is set | Either half alone was shown to be insufficient |
| M2, which filter drivers to blank | Every filter outside the global and system config | Keeps git-lfs and other user filters, so no false `*` |
| Minimum Bun | "1.3.6 or later" | Only 1.3.6 was tested |
| Changelog links for 0.1.0 | A commit link; 0.1.0 is described as never tagged | No v0.1.0 tag exists. Tagging it later is Manos's choice |
| README render | Real output, with the clock pinned | The old sample's bar did not match the script; the user guide now matches too |

## Not fixed in 2.0.0 (backlog)

From `docs/security-review-2.0.0.md`. None of these is a Must.

- **S1.** The summary `claude` may still load MCP servers and save a session. The worker now runs in the data folder. Remaining fix: `--strict-mcp-config --no-session-persistence --disable-slash-commands`.
- **S2.** A relative `PATH` entry can find a project's `./claude`. Fix: accept only an absolute path. The data-folder `cwd` already limits this.
- **S3.** Numeric statusline fields are used in arithmetic without a numeric check. The input comes from Claude Code itself.
- **S4.** `stripChannels` is quadratic. A paste of about 800 KB can stall the prompt.
- **S5.** `/statmine:setup` can widen the mode of `settings.json` and replace a symlink.
- **S6.** Orphaned job files keep prompt text if a worker dies.
- Notes N1-N8 in the review.

## For Manos

**Push (when you choose):**

```
git -C ~/code/statmine push -u origin release/2.0.0
git -C ~/code/statmine push origin v2.0.0
```

Then open a pull request from `release/2.0.0` to `main`, and merge it after CI passes on GitHub. CI has run only locally so far.

**GitHub topics to set:** `claude-code`, `claude-code-plugin`, `statusline`, `git`, `worktree`, `terminal`, `bun`.

**Draft release notes for v2.0.0:**

> statmine 2.0.0 is the first tagged release. It is a statusline for Claude Code that shows where a commit will land, how full your context is, and your last three requests.
>
> - Security: a project's `.env`, git config in the session folder, and control characters in prompts or folder names can no longer run code, redirect summaries or act on your terminal. See `docs/security-review-2.0.0.md`.
> - Needs Bun 1.3.6 or later (the hook runs with `--no-env-file`), `jq` and `git`. Tested on Linux and WSL.
> - New: CHANGELOG, CONTRIBUTING, a bug report form, and CI with shellcheck and a TypeScript check.
>
> Update with `claude plugin update statmine@statmine`. Full list in CHANGELOG.md.

**Scratch to remove:** `rm -rf /tmp/claude-1000/statmine-release` (the agents' scratch copies, the herdr-snip clone and tool downloads).

**Cost:** the workflow's 15 agents used 1.21M tokens (from the workflow report). The orchestrator's own spend is not counted here.
