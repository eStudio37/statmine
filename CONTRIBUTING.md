# Contributing

Issues and pull requests are welcome.

## Reporting a bug

Use the bug report form. The most useful details are:

- statmine's version: shown after the label in the full view's header, or by
  `claude plugin list`.
- Your Claude Code version (`claude --version`), your OS and your terminal.
- The statusline as it appeared, copied from the screen. Replace the text of
  your request rows first: they hold your own prompts.

If the statusline shows nothing or an error, run it by hand as described under
"Something else" in the [user guide](docs/user-guide.md#troubleshooting) and
paste what it prints.

Problems with Claude Code itself belong in the
[Claude Code issues](https://github.com/anthropics/claude-code/issues).

## Making a change

1. Load your checkout in a session: `claude --plugin-dir .` from the repo root.
2. Keep the plugin free of dependencies. The hooks use Bun built-ins only, the
   statusline uses `bash`, `jq` and `git`, and nothing is installed at setup.
   The plugin makes no network calls of its own; summaries go only through the
   user's `claude` CLI. Keep both true.
3. Run every check before opening a pull request. `bun install` fetches the
   pinned TypeScript and Bun types for the check. They are dev tools only; the
   plugin never loads them.

   ```sh
   bun install
   bun test tests
   bash -n scripts/statusline.sh hooks/sync.sh
   shellcheck scripts/*.sh hooks/*.sh
   bunx tsc --noEmit
   ```

   If `bunx` is not on your `PATH`, `bun x tsc --noEmit` does the same. `bun run typecheck` and `bun run lint` run the last two checks too.

   If you changed `.claude-plugin/`, also run `claude plugin validate .`.

4. Add a line to `CHANGELOG.md` under "Unreleased".

The tests run the real scripts with a temporary data folder, a pinned clock and
a stub in place of `claude`. They never call a real model. If a change alters
what the statusline draws or what the hooks write, add a test in `tests/` that
checks the new behavior the same way. [How it works](docs/how-it-works.md)
explains the design and the rules a change must keep.
