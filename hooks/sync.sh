#!/usr/bin/env bash
# statmine SessionStart hook: copy the statusline script and the user's
# options into the plugin data folder, where the statusLine command runs it.
#
# The statusLine command cannot point into the plugin itself
# ($CLAUDE_PLUGIN_ROOT changes with every plugin update), so it points at the
# data folder, which survives updates. Running this at every session start
# keeps that copy current. It prints nothing: SessionStart output would be
# added to the conversation.

set -u
root="${CLAUDE_PLUGIN_ROOT:-}"
data="${CLAUDE_PLUGIN_DATA:-}"
[ -n "$root" ] && [ -n "$data" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

umask 077
mkdir -p "$data" 2>/dev/null || exit 0
chmod 700 "$data" 2>/dev/null

tmp="$data/.statusline.sh.$$"
if cp "$root/scripts/statusline.sh" "$tmp" 2>/dev/null; then
  chmod 700 "$tmp" && mv -f "$tmp" "$data/statusline.sh"
fi
rm -f "$tmp" 2>/dev/null

# An unset label option means the default; a label set to "" means none.
if [ "${CLAUDE_PLUGIN_OPTION_LABEL+set}" = set ]; then
  label="$CLAUDE_PLUGIN_OPTION_LABEL"
else
  label="米Claude Code"
fi
ver="$(jq -r '.version // empty' "$root/.claude-plugin/plugin.json" 2>/dev/null)"
tmp="$data/.config.json.$$"
if jq -n --arg label "$label" --arg version "$ver" '{label: $label, version: $version}' > "$tmp" 2>/dev/null; then
  mv -f "$tmp" "$data/config.json"
fi
rm -f "$tmp" 2>/dev/null
exit 0
