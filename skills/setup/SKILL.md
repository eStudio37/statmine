---
name: setup
description: Point Claude Code's statusLine at the statmine statusline. USE WHEN the user types /statmine:setup or asks to set up, install, enable or repair the statmine statusline.
disable-model-invocation: true
allowed-tools: Bash, Read
---

# /statmine:setup

A plugin cannot set `statusLine` itself, so this skill writes it into the
user's `~/.claude/settings.json`, after a backup. The command points at the copy
of the script in the plugin's data folder, which survives plugin updates; the
plugin's SessionStart hook refreshes that copy each session.

Plugin folder: `${CLAUDE_PLUGIN_ROOT}`
Data folder: `${CLAUDE_PLUGIN_DATA}`

## Steps

1. **Name the data folder.** Call the data folder above D.
2. **Check the tools.** Run `command -v bash jq git bun claude`. Report any that
   are missing: bash, jq and git are needed for the statusline, bun for the
   request rows, claude for summaries. Continue unless jq is missing.
3. **Make sure the script is in D.** If `D/statusline.sh` is missing, run:
   `CLAUDE_PLUGIN_ROOT="<plugin folder>" CLAUDE_PLUGIN_DATA="D" bash "<plugin folder>/hooks/sync.sh"`
   and confirm `D/statusline.sh` now exists.
4. **Look before replacing.** Show the current value with
   `jq '.statusLine // "none"' ~/.claude/settings.json` (a missing file means
   none). If there is a statusLine that does not already point at
   `D/statusline.sh`, show it and ask the user before replacing it.
5. **Back up, then write.** Copy `~/.claude/settings.json` to
   `~/.claude/settings.json.statmine-backup-<YYYYmmddHHMMSS>` when it exists.
   Then set the key with jq into a temp file and move it into place, keeping
   every other key:
   ```bash
   jq --arg cmd "bash \"D/statusline.sh\"" \
      '.statusLine = {type: "command", command: $cmd, refreshInterval: 10}' \
      ~/.claude/settings.json > ~/.claude/settings.json.statmine-tmp \
   && mv ~/.claude/settings.json.statmine-tmp ~/.claude/settings.json
   ```
   With no settings file, start from `{}` instead of the file.
6. **Check it.** `jq .statusLine ~/.claude/settings.json`, then render once:
   `printf '{"session_id":"setup","workspace":{"current_dir":"%s"}}' "$PWD" | bash "D/statusline.sh"`.
   It must exit 0 and print the rows.
7. **Report** in three lines: the statusline is set (it shows on the next
   redraw, within 10 seconds), where the backup is, and how to switch views
   (`/statmine:mode compact` or `/statmine:mode full`).

To undo: restore the backup, or delete the `statusLine` key.
