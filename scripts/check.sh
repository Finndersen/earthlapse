#!/usr/bin/env bash
# The single definition of "checks pass" (CLAUDE.md's own four-command list, plus shellcheck).
# Runs every check in order and stops at the first failure, naming exactly which one broke.
#
# Usage: scripts/check.sh [--quick]
#   --quick   skip `pnpm -C web build` (the slowest step) for a fast local loop; CI/preflight
#             always run the full list.
set -euo pipefail

QUICK=0
for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=1 ;;
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

CURRENT_STEP=""
VITEST_OUTPUT=""
step() {
  CURRENT_STEP="$1"
  echo ""
  echo "==> $CURRENT_STEP"
}

fail() {
  echo "" >&2
  echo "FAILED: $CURRENT_STEP" >&2
  [ -n "$VITEST_OUTPUT" ] && rm -f "$VITEST_OUTPUT"
  exit 1
}
trap fail ERR

step "pytest"
"$PYTHON" -m pytest -q tests

step "ruff check"
"$RUFF" check .

step "ruff format --check"
"$RUFF" format --check .

step "web typecheck"
pnpm -C web typecheck

# `pnpm -C web vitest run` (no `exec`) fails with ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL and STILL
# exits 0 (CLAUDE.md's own documented trap), so this both requires `exec` and independently
# checks vitest's own summary line actually printed — a run that silently ran no tests must fail
# this script even if some wrapper's exit code lies.
step "web vitest"
VITEST_OUTPUT="$(mktemp "${TMPDIR:-/tmp}/earthtime-vitest.XXXXXX")"
pnpm -C web exec vitest run 2>&1 | tee "$VITEST_OUTPUT"
if ! grep -qE '^\s*Test Files\s+[0-9]+' "$VITEST_OUTPUT"; then
  echo "web vitest: no 'Test Files' summary line in the output — vitest did not actually run (see CLAUDE.md's exec/exit-0 trap)" >&2
  fail
fi
if grep -qE '^\s*Test Files\s+[0-9]+\s+failed' "$VITEST_OUTPUT"; then
  fail
fi
rm -f "$VITEST_OUTPUT"
VITEST_OUTPUT=""

if [ "$QUICK" -eq 0 ]; then
  step "web build"
  pnpm -C web build
else
  echo ""
  echo "==> web build (skipped: --quick)"
fi

if command -v shellcheck >/dev/null 2>&1; then
  step "shellcheck"
  # Globs can legitimately match nothing (e.g. a fresh scripts/ with no .sh files yet); nullglob
  # keeps that from passing a literal unmatched pattern to shellcheck as a fake filename.
  shopt -s nullglob
  SH_FILES=(deploy/*.sh scripts/*.sh)
  shopt -u nullglob
  if [ "${#SH_FILES[@]}" -gt 0 ]; then
    shellcheck "${SH_FILES[@]}"
  fi
else
  echo ""
  echo "==> shellcheck (skipped: not installed)"
fi

echo ""
echo "All checks passed."
