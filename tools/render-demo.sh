#!/usr/bin/env bash
# Render the README images of both views from a sample session:
#   docs/images/statusline-full.svg and docs/images/statusline-compact.svg
#
# Builds a throwaway repo with a worktree (3 commits on a branch, one
# uncommitted file), pins the clock with a date shim, writes three sample
# requests, and sets context use to 50% so the bar shows its color gradient.
# Then it runs the real scripts/statusline.sh in each mode and turns its ANSI
# output into SVG with tools/ansi-to-svg.ts. Run from anywhere:
#   bash tools/render-demo.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/docs/images"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAKE_NOW="2026-10-22 21:44"
export FAKE_NOW

# A date shim, as tests/helpers.ts uses, so the header shows a fixed time.
mkdir -p "$WORK/bin"
cat > "$WORK/bin/date" <<'EOF'
#!/usr/bin/env bash
d="$FAKE_NOW"; args=()
while [ $# -gt 0 ]; do
  case "$1" in
    -d) shift; if [ "$1" = yesterday ]; then d="$FAKE_NOW yesterday"; else d="$1"; fi ;;
    *) args+=("$1") ;;
  esac
  shift
done
exec /usr/bin/date -d "$d" "${args[@]}"
EOF
chmod +x "$WORK/bin/date"

# The sample repo: main on the remote, a worktree on search-filters with
# 3 pushed commits and one uncommitted file.
git() { command git -c user.name=demo -c user.email=demo@example.com -c init.defaultBranch=main "$@"; }
git init -q --bare "$WORK/origin.git"
git clone -q "$WORK/origin.git" "$WORK/myapp" 2>/dev/null
git -C "$WORK/myapp" commit -q --allow-empty -m init
git -C "$WORK/myapp" push -q origin main
git -C "$WORK/myapp" worktree add -q -b search-filters "$WORK/myapp--search"
for i in 1 2 3; do
  echo "$i" > "$WORK/myapp--search/f$i"
  git -C "$WORK/myapp--search" add "f$i"
  git -C "$WORK/myapp--search" commit -q -m "c$i"
done
git -C "$WORK/myapp--search" push -q -u origin search-filters
echo x > "$WORK/myapp--search/dirty.txt"

# The data folder: label, version and three requests from this session.
DATA="$WORK/data"
mkdir -p "$DATA/prompts"
printf '{"label":"米Claude Code","version":"2.0.0"}\n' > "$DATA/config.json"
{
  echo '{"session_id":"demo","id":"a1","text":"Add a date filter to the search page"}'
  echo '{"session_id":"demo","id":"a2","text":"now the tests"}'
  echo '{"session_id":"demo","id":"a3","text":"Fix the flaky search test"}'
} > "$DATA/prompts/2026-10-22.jsonl"

PAYLOAD="$(printf '{"session_id":"demo","workspace":{"current_dir":"%s","project_dir":"%s"},"model":{"display_name":"Opus 5.5"},"effort":{"level":"high"},"cost":{"total_duration_ms":5400000},"context_window":{"context_window_size":1000000,"used_percentage":50,"current_usage":{"input_tokens":2000,"cache_read_input_tokens":490000,"cache_creation_input_tokens":7000,"output_tokens":1000}}}' \
  "$WORK/myapp--search" "$WORK/myapp")"

mkdir -p "$OUT"
for view in full compact; do
  printf '%s\n' "$view" > "$DATA/mode"
  printf '%s' "$PAYLOAD" \
    | (cd "$WORK/myapp--search" && PATH="$WORK/bin:$PATH" STATMINE_DATA="$DATA" bash "$ROOT/scripts/statusline.sh") \
    > "$WORK/$view.ansi"
  bun "$ROOT/tools/ansi-to-svg.ts" "statmine statusline, $view view" < "$WORK/$view.ansi" > "$OUT/statusline-$view.svg"
  # The same view as plain text, for the README's text copy.
  echo "wrote docs/images/statusline-$view.svg:"
  sed 's/\x1b\[[0-9;]*m//g' "$WORK/$view.ansi"
done
