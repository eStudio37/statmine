---
name: mode
description: Switch the statmine statusline between the full and compact view. USE WHEN the user types /statmine:mode full, /statmine:mode compact, or /statmine:mode with no argument.
argument-hint: full | compact
disable-model-invocation: true
allowed-tools: Bash
---

# /statmine:mode

Requested view: `$ARGUMENTS`

- **full:** header (label, version, date, time), git row, context row, and
  your last three requests.
- **compact:** one line: label and time, git, context bar with tokens, model
  and effort.

Data folder: `${CLAUDE_PLUGIN_DATA}`

## Steps

1. **No argument:** print the current view: the word in `<data folder>/mode`,
   or `full` when the file is missing. Stop.
2. Lowercase and trim the argument. Accept `full` or `compact` only; anything
   else, name the two values and stop.
3. Write it, private like the rest of the folder:
   `umask 077; printf '%s\n' <view> > "<data folder>/mode"`.
4. Report in one line: the new view, shown within 10 seconds.
