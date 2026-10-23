#!/usr/bin/env bash
# statmine statusline for Claude Code.
#
# Reads the statusLine JSON on stdin and the plugin's data folder (the folder
# this script is copied into by the plugin's SessionStart hook), and prints
# either the full view (several rows) or the compact view (one line).
#
# Principles:
#   - Pure local. No network calls.
#   - Fail-soft. Missing data hides its part; nothing here errors the prompt.
#
# Data folder ($STATMINE_DATA, else this script's own folder):
#   config.json       {"label": string, "version": string}  (SessionStart hook)
#   mode              "full" or "compact"                    (/statmine:mode)
#   prompts/<day>.jsonl  {"session_id","id","text"} per prompt (prompt hook)
#   summaries.jsonl   {"session_id","id","summary"}          (summarizer)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${STATMINE_DATA:-$SCRIPT_DIR}"
input="$(cat)"

# --- palette (truecolor) ---
RESET=$'\033[0m'; BOLD=$'\033[1m'; DIM=$'\033[2m'
EMERALD=$'\033[38;2;52;211;153m'
SLATE=$'\033[38;2;148;163;184m'
AMBER=$'\033[38;2;251;191;36m'
SKY=$'\033[38;2;56;189;248m'
RED=$'\033[38;2;239;68;68m'
GRAYL=$'\033[38;2;100;116;139m'
CTX_EMPTY=$'\033[38;2;51;65;85m'

now_hm="$(date +%H:%M)"
now_date="$(date '+%A, %B %-d, %Y')"

# --- clean: text for the terminal ---
# Removes C0 controls, DEL, C1 controls (as UTF-8) and the bidi marks and
# overrides, so a folder name, branch, label or model name can never carry a
# terminal escape sequence or reorder the row. Byte-wise under LC_ALL=C, so
# it works in any locale and never cuts a UTF-8 character. The jq `row`
# function and on-prompt.ts oneLine() strip the same set.
clean() { # $1 text -> cleaned text on stdout
  local LC_ALL=C v="$1" b
  v="${v//[[:cntrl:]]/}"
  v="${v//$'\xc2'[$'\x80'-$'\x9f']/}"
  for b in $'\xe2\x80\x8e' $'\xe2\x80\x8f' $'\xe2\x80\xaa' $'\xe2\x80\xab' \
           $'\xe2\x80\xac' $'\xe2\x80\xad' $'\xe2\x80\xae' $'\xe2\x81\xa6' \
           $'\xe2\x81\xa7' $'\xe2\x81\xa8' $'\xe2\x81\xa9'; do
    v="${v//"$b"/}"
  done
  printf '%s' "$v"
}

# --- jq guard: degrade to a single minimal line if jq is unavailable ---
if ! command -v jq >/dev/null 2>&1; then
  printf '%s%s%s  (install jq for the full statusline)\n' "$SLATE" "$now_hm" "$RESET"
  exit 0
fi

# --- config written by the SessionStart hook (label, version) ---
label="米Claude Code"
ver=""
if [ -r "$DATA_DIR/config.json" ]; then
  eval "$(jq -r '
    "label=" + ((if has("label") then .label else "米Claude Code" end) | tostring | @sh) + "\n" +
    "ver=" + ((.version // "") | tostring | @sh)
  ' "$DATA_DIR/config.json" 2>/dev/null)"
fi
label="$(clean "$label")"
ver="$(clean "$ver")"

# --- parse the stdin JSON in one jq call ---
# pct_field carries .context_window.used_percentage verbatim when present; it
# is empty when absent, which selects the current_usage sum instead.
eval "$(printf '%s' "$input" | jq -r '
  "cur_dir=" + (.workspace.current_dir // .cwd // "" | @sh) + "\n" +
  "proj_dir=" + (.workspace.project_dir // "" | @sh) + "\n" +
  "session_id=" + (.session_id // "" | @sh) + "\n" +
  "model=" + (.model.display_name // "model" | @sh) + "\n" +
  "effort_in=" + ((.effort.level // "") | tostring | @sh) + "\n" +
  "dur_ms=" + ((.cost.total_duration_ms // 0) | tostring) + "\n" +
  "t_in=" + ((.context_window.current_usage.input_tokens // 0) | tostring) + "\n" +
  "t_cr=" + ((.context_window.current_usage.cache_read_input_tokens // 0) | tostring) + "\n" +
  "t_cc=" + ((.context_window.current_usage.cache_creation_input_tokens // 0) | tostring) + "\n" +
  "t_out=" + ((.context_window.current_usage.output_tokens // 0) | tostring) + "\n" +
  "ctx_max=" + ((.context_window.context_window_size // 200000) | tostring) + "\n" +
  "pct_field=" + ((.context_window.used_percentage // "") | tostring | @sh)
' 2>/dev/null)"

# fail-soft defaults (a malformed payload leaves these unset)
: "${cur_dir:=$PWD}"; : "${proj_dir:=}"; : "${session_id:=}"; : "${model:=model}"
: "${effort_in:=}"; : "${dur_ms:=0}"; : "${ctx_max:=200000}"; : "${pct_field:=}"
: "${t_in:=0}"; : "${t_cr:=0}"; : "${t_cc:=0}"; : "${t_out:=0}"

model="$(clean "$model")"
effort_in="$(clean "$effort_in")"

# --- derived values ---
used=$(( t_in + t_cr + t_cc + t_out ))
[ "$ctx_max" -le 0 ] && ctx_max=200000
used_k=$(( used / 1000 ))
max_k=$(( ctx_max / 1000 ))

# Prefer the first-party used_percentage; fall back to the usage sum. One
# number drives both the bar and the printed percent.
pct=""
case "$pct_field" in
  ''|*[!0-9.]*) ;;
  *) pct="${pct_field%%.*}"; [ -z "$pct" ] && pct=0 ;;
esac
[ -z "$pct" ] && pct=$(( used * 100 / ctx_max ))
[ "$pct" -lt 0 ] && pct=0
[ "$pct" -gt 100 ] && pct=100

dur_s=$(( dur_ms / 1000 ))
if   [ "$dur_s" -lt 60 ];   then dur="${dur_s}s"
elif [ "$dur_s" -lt 3600 ]; then dur="$(( dur_s / 60 ))m"
else dur="$(( dur_s / 3600 ))h$(( (dur_s % 3600) / 60 ))m"; fi

# Reasoning effort: the stdin field, else the session environment.
effort="$(clean "${effort_in:-${CLAUDE_EFFORT:-${CLAUDE_CODE_EFFORT_LEVEL:-?}}}")"
case "$(printf '%s' "$effort" | tr '[:upper:]' '[:lower:]')" in
  low|minimal|min)            effort_c="$EMERALD" ;;
  medium|med|standard|std)    effort_c="$SKY" ;;
  high)                       effort_c="$AMBER" ;;
  xhigh|max|maximum|ultra)    effort_c="$RED" ;;
  *)                          effort_c="$SLATE" ;;
esac

# Context percent color: calm <70, warning 70-85, critical >85.
if   [ "$pct" -lt 70 ]; then pct_c="$EMERALD"
elif [ "$pct" -le 85 ]; then pct_c="$AMBER"
else pct_c="$RED"; fi

# --- context bar: green -> yellow -> orange -> red gradient ---
bucket_color() { # $1 pos, $2 width -> ANSI truecolor
  local p=$(( $1 * 100 / $2 )) r g b t
  if   [ "$p" -le 33 ]; then r=$(( 74 + (250 - 74) * p / 33 )); g=$(( 222 + (204 - 222) * p / 33 )); b=$(( 128 + (21 - 128) * p / 33 ))
  elif [ "$p" -le 66 ]; then t=$(( p - 33 )); r=$(( 250 + (251 - 250) * t / 33 )); g=$(( 204 + (146 - 204) * t / 33 )); b=$(( 21 + (60 - 21) * t / 33 ))
  else t=$(( p - 66 )); r=$(( 251 + (239 - 251) * t / 34 )); g=$(( 146 + (68 - 146) * t / 34 )); b=$(( 60 + (68 - 60) * t / 34 )); fi
  printf '\033[38;2;%d;%d;%dm' "$r" "$g" "$b"
}
render_bar() { # $1 width, $2 pct
  local width=$1 p=$2 filled i out=""
  [ "$p" -gt 100 ] && p=100
  filled=$(( p * width / 100 ))
  for i in $(seq 1 "$width"); do
    if [ "$i" -le "$filled" ]; then out="${out}$(bucket_color "$i" "$width")▰${RESET}"
    else out="${out}${CTX_EMPTY}▱${RESET}"; fi
  done
  printf '%s' "$out"
}

# --- mode: full (default) or compact ---
mode="full"
[ -r "$DATA_DIR/mode" ] && mode="$(LC_ALL=C tr -cd '[:lower:]' < "$DATA_DIR/mode" 2>/dev/null)"
case "$mode" in full|compact) ;; *) mode="full" ;; esac

# --- Commit-landing cell: where a plain `git commit` from cur_dir lands ------
#   <folder> → <repo> ⎇ <branch>[*]
# folder = cur_dir's name (a worktree or a main checkout); repo = the repository
# it commits into (from git's common dir); branch = what is checked out there;
# "*" = uncommitted changes. One color for the cell:
#   red    commits land in a different repo than the session's project_dir
#   amber  same repo, but a "<repo>--<slug>" folder name does not match the
#          branch (some /-segment of the branch must equal <slug> or start with
#          "<slug>-"), or HEAD is detached
#   green  commits land in the session's repo, on the branch the folder names
# Not a git repo: just the folder name, muted.
#
# Git safety: the folder's own git config must never run a command. Every call
# goes through g(), which turns core.fsmonitor off (the -c value also reaches
# submodules). The dirty check also skips submodule work trees and blanks every
# filter clean/process driver that is not from the global or system config.
folder="$(clean "$(basename "$cur_dir" 2>/dev/null)")"
[ -z "$folder" ] && folder="-"
g() { # $1 dir, then git args
  local d="$1"; shift
  git -c core.fsmonitor=false -C "$d" "$@"
}
repo_name() { # $1 dir -> name of the repository that dir commits into
  local c
  c="$(g "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  [ -n "$c" ] || return 1
  basename "$(dirname "$c")"
}
repo="$(clean "$(repo_name "$cur_dir")")"
git_tok=""
git_tok_c=""
slots_tok=""
if [ -n "$repo" ]; then
  proj_repo="$(repo_name "${proj_dir:-$cur_dir}")"
  [ -z "$proj_repo" ] && proj_repo="$repo"
  branch="$(clean "$(g "$cur_dir" branch --show-current 2>/dev/null)")"
  land_c="$EMERALD"
  if [ -z "$branch" ]; then
    branch="detached@$(clean "$(g "$cur_dir" rev-parse --short HEAD 2>/dev/null)")"
    land_c="$AMBER"
  fi
  if [ "$repo" != "$proj_repo" ]; then
    land_c="$RED"
  elif [ "$land_c" = "$EMERALD" ] && [[ "$folder" == *--* ]]; then
    slug="$(printf '%s' "${folder#*--}" | tr '[:upper:]' '[:lower:]')"
    slug_match=no
    IFS='/' read -ra br_segs <<< "$(printf '%s' "$branch" | tr '[:upper:]' '[:lower:]')"
    for s in "${br_segs[@]}"; do
      { [ "$s" = "$slug" ] || [[ "$s" == "$slug"-* ]]; } && slug_match=yes
    done
    [ "$slug_match" = no ] && land_c="$AMBER"
  fi
  dirty=""
  # Blank each filter driver the repository (or a file it includes) defines.
  # A name git -c cannot carry (it holds "=") skips the dirty marker instead.
  filter_off=()
  filter_ok=yes
  while IFS= read -r -d '' f_scope && IFS= read -r -d '' f_key; do
    case "$f_scope" in global|system) continue ;; esac
    f_name="${f_key#filter.}"; f_name="${f_name%.*}"
    case "$f_name" in *=*) filter_ok=no; break ;; esac
    filter_off+=(-c "filter.$f_name.clean=" -c "filter.$f_name.process=")
  done < <(g "$cur_dir" config --show-scope -z --name-only --get-regexp '^filter\..*\.(clean|process)$' 2>/dev/null)
  # --no-optional-locks: a redraw must never take the index lock other git
  # commands need.
  if [ "$filter_ok" = yes ]; then
    g "$cur_dir" "${filter_off[@]}" --no-optional-locks status --porcelain --ignore-submodules=dirty 2>/dev/null \
      | grep -q . && dirty="*"
  fi
  git_tok="$(printf '%s%s → %s ⎇ %s%s%s' "$land_c" "$folder" "$repo" "$branch" "$dirty" "$RESET")"
  git_tok_c="$(printf '%s%s ⎇ %s%s%s' "$land_c" "$folder" "$branch" "$dirty" "$RESET")"

  # Two slots lead the cell. Local refs only, no fetch; an amber ⊘ fills a
  # slot whose thing does not exist yet.
  #   remote slot  ↑N = commits on this branch on no remote (unpushed, as of
  #                the last fetch); ⊘ = no remote configured
  #   local slot   ↓N = this branch's own commits: those the trunk (main, else
  #                master) lacks; on the trunk itself, or with no trunk, all
  #                commits on the branch; ⊘ = none
  nr_tok="$(printf '%s⊘%s' "$AMBER" "$RESET")"
  has_head=""
  g "$cur_dir" rev-parse --verify --quiet HEAD >/dev/null 2>&1 && has_head=yes
  if [ -z "$(g "$cur_dir" remote 2>/dev/null)" ]; then
    remote_slot="$nr_tok"
  else
    unpushed=0
    [ -n "$has_head" ] && unpushed="$(g "$cur_dir" rev-list --count HEAD --not --remotes 2>/dev/null)"
    case "$unpushed" in ''|*[!0-9]*) unpushed=0 ;; esac
    remote_slot="$(printf '%s↑%d%s' "$SLATE" "$unpushed" "$RESET")"
  fi
  trunk=""
  for t in main master; do
    g "$cur_dir" show-ref --verify --quiet "refs/heads/$t" 2>/dev/null && { trunk="$t"; break; }
  done
  own=0
  if [ -n "$has_head" ]; then
    if [ -n "$trunk" ] && [ "$branch" != "$trunk" ]; then
      own="$(g "$cur_dir" rev-list --count "$trunk..HEAD" 2>/dev/null)"
    else
      own="$(g "$cur_dir" rev-list --count HEAD 2>/dev/null)"
    fi
  fi
  case "$own" in ''|*[!0-9]*) own=0 ;; esac
  if [ "$own" -gt 0 ]; then
    local_slot="$(printf '%s↓%d%s' "$SLATE" "$own" "$RESET")"
  else
    local_slot="$nr_tok"
  fi
  slots_tok="$remote_slot $local_slot"
else
  git_tok="$(printf '%s%s%s' "$SLATE" "$folder" "$RESET")"
  git_tok_c="$git_tok"
fi

label_tok=""
[ -n "$label" ] && label_tok="$(printf '%s%s%s%s' "$BOLD" "$EMERALD" "$label" "$RESET")"
time_tok="$(printf '%s%s%s%s' "$BOLD" "$EMERALD" "$now_hm" "$RESET")"

# --- compact: one line, cells split by │ ---
#   <label> <time> │ <slots> <folder> ⎇ <branch> │ <bar> used/window │ <model> <effort>
if [ "$mode" = compact ]; then
  sep="$(printf ' %s│%s ' "$GRAYL" "$RESET")"
  line="${label_tok:+$label_tok }$time_tok"
  line="$line$sep${slots_tok:+$slots_tok }$git_tok_c"
  line="$line$sep$(render_bar 10 "$pct") $(printf '%s%dk%s%s/%dk%s' "$EMERALD" "$used_k" "$RESET" "$SLATE" "$max_k" "$RESET")"
  line="$line$sep$(printf '%s%s%s %s%s%s' "$SLATE" "${model%% (*}" "$RESET" "$effort_c" "$effort" "$RESET")"
  printf '%s\n' "$line"
  exit 0
fi

# --- full: request rows (last 3 prompts of this session) ---
# The prompt hook logs one line per prompt you typed (system input is never
# logged) and the summarizer files a short summary for long ones under the same
# id. A row shows the summary when there is one, else the logged text.
# Yesterday's log is read too, so the rows survive midnight. Both files are read
# line by line (fromjson?), so a damaged line is skipped, not fatal.
trunc() { local s="$1" n="${2:-52}"; if [ "${#s}" -gt "$n" ]; then printf '%s...' "${s:0:$((n-3))}"; else printf '%s' "$s"; fi; }
reqs=()
ev_files=()
# GNU date takes -d yesterday; BSD/macOS date takes -v-1d.
yesterday="$(date -d yesterday +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d 2>/dev/null)"
for d in "$yesterday" "$(date +%Y-%m-%d)"; do
  [ -n "$d" ] && [ -f "$DATA_DIR/prompts/$d.jsonl" ] && ev_files+=("$DATA_DIR/prompts/$d.jsonl")
done
# No session id means no rows: an empty id must never widen the filter.
if [ -n "$session_id" ] && [ "${#ev_files[@]}" -gt 0 ]; then
  idx_src="/dev/null"
  [ -r "$DATA_DIR/summaries.jsonl" ] && idx_src="$DATA_DIR/summaries.jsonl"
  while IFS= read -r line; do
    [ -n "$line" ] && reqs+=("$line")
  done < <(
    # awk 1 ends every file with a newline, so a partial last line in
    # yesterday's file cannot glue onto today's first one.
    awk 1 "${ev_files[@]}" 2>/dev/null \
      | grep -F "\"session_id\":$(jq -n --arg s "$session_id" '$s')" \
      | jq -n -R -r --arg sid "$session_id" --rawfile idxraw "$idx_src" '
          def row: gsub("[\t\n\r]"; " ")
            | gsub("[\\p{Cc}\\x{200E}\\x{200F}\\x{202A}-\\x{202E}\\x{2066}-\\x{2069}]"; "")
            | sub("^\\s+"; "") | sub("\\s+$"; "");
          ( [ $idxraw | split("\n")[] | fromjson?
              | select(type == "object" and .session_id == $sid
                       and (.id | type) == "string" and (.summary | type) == "string"
                       and (.summary | row | length) > 0) ]
            | reduce .[] as $l ({}; .[$l.id] = $l.summary) ) as $idx
          | inputs
          | fromjson?
          | select(type == "object" and .session_id == $sid
                   and (.id | type) == "string" and (.text | type) == "string")
          | ($idx[.id] // .text)
          | row
          | select(length > 0)
        ' 2>/dev/null | tail -3)
fi

# Top row: label, version, date, time.
top="${label_tok:+$label_tok  }"
[ -n "$ver" ] && top="$top$(printf '%sv%s%s  ' "$DIM" "$ver" "$RESET")"
top="$top$(printf '%s%s%s  ' "$SLATE" "$now_date" "$RESET")$time_tok"
printf '%s\n' "$top"

# Git row: slots, where a commit lands, session duration.
printf '%s%s  %s⏱%s %s\n' "${slots_tok:+$slots_tok  }" "$git_tok" "$SLATE" "$RESET" "$dur"

# Context row: bar, percent, tokens, model, effort.
printf '%s %s%s%d%%%s  %s%dk%s%s/%dk%s  %s%s%s  %seffort%s %s%s%s\n' \
  "$(render_bar 14 "$pct")" "$BOLD" "$pct_c" "$pct" "$RESET" \
  "$EMERALD" "$used_k" "$RESET" "$SLATE" "$max_k" "$RESET" \
  "$SLATE" "$model" "$RESET" \
  "$SLATE" "$RESET" "$effort_c" "$effort" "$RESET"

# Request rows, oldest first, counting down so the newest (bottom) row is 1.
req_n=${#reqs[@]}
for r in "${reqs[@]}"; do
  printf '%s%d.%s %s%s%s\n' "$GRAYL" "$req_n" "$RESET" "$DIM" "$(trunc "$r")" "$RESET"
  req_n=$(( req_n - 1 ))
done

exit 0
