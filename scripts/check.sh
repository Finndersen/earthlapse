#!/usr/bin/env bash
# The single definition of "checks pass" (CLAUDE.md's own four-command list, plus shellcheck).
# The Python and web groups share no state, so they run in parallel; within a group, steps run in
# order and stop at the first failure. Each group's output is buffered and printed whole, so the
# two never interleave, and the failure names exactly which step broke.
#
# Usage: scripts/check.sh [--quick] [--changed[=REF]]
#   --quick          skip `pnpm -C web build` (the slowest web step).
#   --changed[=REF]  scope to what this branch changed since its merge-base with REF (default
#                    origin/main): a group whose files are untouched is skipped, and vitest runs
#                    only the test files that import something changed. A fast inner loop only —
#                    CI/preflight and handing work back always run the full list.
set -euo pipefail

QUICK=0
CHANGED_REF=""
for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=1 ;;
    --changed) CHANGED_REF="origin/main" ;;
    --changed=*) CHANGED_REF="${arg#--changed=}" ;;
    *)
      echo "check.sh: unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PYTHON="${PYTHON:-$REPO_ROOT/.venv/bin/python}"
RUFF="${RUFF:-$REPO_ROOT/.venv/bin/ruff}"

# Presence checks only (scripts/setup.sh does the installing): a fresh container fails here,
# naming the fix, rather than midway through a group.
missing() {
  echo "check.sh: missing $1 — run scripts/setup.sh $2" >&2
  exit 2
}
stale() {
  if [ -e "$1" ] && [ "$2" -nt "$1" ]; then
    echo "check.sh: warning: $2 changed since the last scripts/setup.sh $3" >&2
  fi
}
if ! { [ -x "$PYTHON" ] && [ -x "$RUFF" ] && [ -x "$REPO_ROOT/.venv/bin/pytest" ]; }; then
  missing "the Python venv (.venv)" python
fi
stale .venv/.earthlapse-setup-stamp pyproject.toml python

LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/earthlapse-check.XXXXXX")"
trap 'rm -rf "$LOG_DIR"' EXIT

RUN_PYTHON=1
RUN_WEB=1
VITEST_SCOPE=()
if [ -n "$CHANGED_REF" ]; then
  BASE="$(git merge-base HEAD "$CHANGED_REF")"
  # Committed, staged, unstaged and untracked changes alike.
  CHANGED_FILES="$( (git diff --name-only "$BASE"; git ls-files --others --exclude-standard) | sort -u)"
  grep -qE '\.py$|^pyproject\.toml$|^sources/|^tests/|^data/' <<<"$CHANGED_FILES" || RUN_PYTHON=0
  grep -qE '^web/' <<<"$CHANGED_FILES" || RUN_WEB=0
  VITEST_SCOPE=(--changed "$BASE" --passWithNoTests)
  echo "check.sh: scoped to changes since $(git rev-parse --short "$BASE") ($CHANGED_REF)"
fi

if [ "$RUN_WEB" -eq 1 ]; then
  if ! { [ -x web/node_modules/.bin/tsc ] && [ -x web/node_modules/.bin/vitest ]; }; then
    missing "web dependencies (web/node_modules)" web
  fi
  stale web/node_modules/.earthlapse-setup-stamp web/pnpm-lock.yaml web
fi

# `step <name> <command...>` — runs one check inside a group, recording its name for the failure
# message. A group is a function run in a background subshell with its output sent to a log.
step() {
  local name="$1"
  shift
  echo ""
  echo "==> $name"
  if ! "$@"; then
    echo "$name" >"$FAILED_STEP_FILE"
    return 1
  fi
}

python_group() {
  step "pytest" "$PYTHON" -m pytest -q tests
}

# `pnpm -C web vitest run` (no `exec`) fails with ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL and STILL
# exits 0 (CLAUDE.md's own documented trap), so this both requires `exec` and independently
# checks vitest's own summary line actually printed — a run that silently ran no tests must fail
# even if some wrapper's exit code lies. A `--changed` run that selects no files is the one
# legitimate exception.
vitest_checked() {
  local out="$LOG_DIR/vitest.out"
  pnpm -C web exec vitest run "${VITEST_SCOPE[@]}" 2>&1 | tee "$out"
  # vitest colours its summary when it detects CI, which would hide the line from the greps below.
  sed -i 's/\x1b\[[0-9;]*m//g' "$out"
  if grep -qE '^\s*Test Files\s+[0-9]+\s+failed' "$out"; then
    return 1
  fi
  if grep -qE '^\s*Test Files\s+[0-9]+' "$out"; then
    return 0
  fi
  if [ "${#VITEST_SCOPE[@]}" -gt 0 ] && grep -q 'No test files found' "$out"; then
    return 0
  fi
  echo "web vitest: no 'Test Files' summary line in the output — vitest did not actually run (see CLAUDE.md's exec/exit-0 trap)" >&2
  return 1
}

web_group() {
  step "web typecheck" pnpm -C web typecheck
  step "web vitest" vitest_checked
  if [ "$QUICK" -eq 0 ]; then
    step "web build" pnpm -C web build
  else
    echo ""
    echo "==> web build (skipped: --quick)"
  fi
}

# Ruff is near-instant and covers every Python file, so it runs up front rather than in a group.
echo "==> ruff check"
"$RUFF" check . || { echo "FAILED: ruff check" >&2; exit 1; }
echo "==> ruff format --check"
"$RUFF" format --check . || { echo "FAILED: ruff format --check" >&2; exit 1; }

PIDS=()
GROUPS_RUN=()
start_group() {
  local group="$1"
  FAILED_STEP_FILE="$LOG_DIR/$group.failed"
  ("$group" >"$LOG_DIR/$group.log" 2>&1) &
  PIDS+=("$!")
  GROUPS_RUN+=("$group")
}
if [ "$RUN_PYTHON" -eq 1 ]; then
  start_group python_group
else
  echo "==> python group (skipped: no Python changes)"
fi
if [ "$RUN_WEB" -eq 1 ]; then
  start_group web_group
else
  echo "==> web group (skipped: no web changes)"
fi

FAILED=()
for i in "${!PIDS[@]}"; do
  group="${GROUPS_RUN[$i]}"
  status=0
  wait "${PIDS[$i]}" || status=$?
  cat "$LOG_DIR/$group.log"
  if [ "$status" -ne 0 ]; then
    FAILED+=("$(cat "$LOG_DIR/$group.failed" 2>/dev/null || echo "$group")")
  fi
done

if command -v shellcheck >/dev/null 2>&1; then
  echo ""
  echo "==> shellcheck"
  # Globs can legitimately match nothing (e.g. a fresh scripts/ with no .sh files yet); nullglob
  # keeps that from passing a literal unmatched pattern to shellcheck as a fake filename.
  shopt -s nullglob
  SH_FILES=(deploy/*.sh scripts/*.sh)
  shopt -u nullglob
  if [ "${#SH_FILES[@]}" -gt 0 ] && ! shellcheck "${SH_FILES[@]}"; then
    FAILED+=("shellcheck")
  fi
else
  echo ""
  echo "==> shellcheck (skipped: not installed)"
fi

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "" >&2
  for name in "${FAILED[@]}"; do
    echo "FAILED: $name" >&2
  done
  exit 1
fi

echo ""
echo "All checks passed."
