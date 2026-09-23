#!/usr/bin/env bash
# On-demand, idempotent environment setup for a fresh checkout or container. Run only the parts a
# task needs, before the first check or QA run; a part that is already in place is skipped in
# well under a second, so re-running is always safe.
#
# Usage: scripts/setup.sh [python|web|media|browser ...]   (no arguments: every part)
#   python   .venv with the project and its dev extras (skipped while .venv's stamp is newer
#            than pyproject.toml)
#   web      web/node_modules from the frozen lockfile (skipped while its stamp is newer than
#            web/pnpm-lock.yaml). Never a symlink: Turbopack crashes on a symlinked node_modules.
#   media    Git LFS content under data/media (installing git-lfs if missing) and the gitignored
#            web/public/media -> data/media symlink the viewer and QA serve it through
#   browser  a Chromium the QA harness can launch (web/scripts/qa/browser.mjs's discovery)
#
# Parts run in parallel, each logging to its own file; the script prints one status line per part
# and exits non-zero naming each failed part and its log.
set -euo pipefail

ALL_PARTS=(python web media browser)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PARTS=()
for arg in "$@"; do
  case "$arg" in
    python | web | media | browser) PARTS+=("$arg") ;;
    -h | --help)
      sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "setup.sh: unknown part: $arg (expected one of: ${ALL_PARTS[*]})" >&2
      exit 2
      ;;
  esac
done
[ "${#PARTS[@]}" -gt 0 ] || PARTS=("${ALL_PARTS[@]}")

LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/earthlapse-setup.XXXXXX")"

# Each part writes a one-line outcome ("up to date", "installed", ...) for its status line; PART is
# set by start_part in the part's own subshell.
note() { echo "$*" >"$LOG_DIR/${PART:?}.note"; }

PYTHON_STAMP=.venv/.earthlapse-setup-stamp
WEB_STAMP=web/node_modules/.earthlapse-setup-stamp

setup_python() {
  if [ -x .venv/bin/python ] && [ "$PYTHON_STAMP" -nt pyproject.toml ]; then
    note "up to date"
    return
  fi
  local py
  py="$(command -v python3.12 || true)"
  if [ -z "$py" ]; then
    echo "python3.12 not found on PATH" >&2
    return 1
  fi
  if command -v uv >/dev/null 2>&1; then
    [ -x .venv/bin/python ] || uv venv .venv --python "$py"
    uv pip install --python .venv/bin/python -e '.[dev]'
  else
    [ -x .venv/bin/python ] || "$py" -m venv .venv
    .venv/bin/python -m pip install -e '.[dev]'
  fi
  touch "$PYTHON_STAMP"
  note "installed"
}

setup_web() {
  if [ -L web/node_modules ]; then
    echo "web/node_modules is a symlink, which crashes Turbopack: remove it and re-run" >&2
    return 1
  fi
  if [ "$WEB_STAMP" -nt web/pnpm-lock.yaml ]; then
    note "up to date"
    return
  fi
  pnpm -C web install --frozen-lockfile --prefer-offline
  touch "$WEB_STAMP"
  note "installed"
}

# The first LFS pointer file left under data/media, if any (`-I` skips real binaries unread).
first_lfs_pointer() {
  grep -rlI -m1 '^version https://git-lfs' data/media 2>/dev/null | head -n1 || true
}

GIT_LFS_VERSION=3.7.1
declare -A GIT_LFS_SHA256=(
  [amd64]=1c0b6ee5200ca708c5cebebb18fdeb0e1c98f1af5c1a9cba205a4c0ab5a5ec08
  [arm64]=73a9c90eeb4312133a63c3eaee0c38c019ea7bfa0953d174809d25b18588dd8d
)

# apt when its package index is already present (a few seconds, no `apt-get update`), otherwise
# the checksum-pinned release binary from GitHub.
ensure_git_lfs() {
  if git lfs version >/dev/null 2>&1; then return; fi
  if [ "$(id -u)" -eq 0 ] && command -v apt-get >/dev/null 2>&1 &&
    apt-cache policy git-lfs 2>/dev/null | grep -qE 'Candidate: [0-9]'; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends git-lfs &&
      git lfs version && return
  fi
  local arch
  case "$(uname -m)" in
    x86_64) arch=amd64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *)
      echo "no pinned git-lfs release for $(uname -m): install git-lfs manually" >&2
      return 1
      ;;
  esac
  local bin_dir=/usr/local/bin
  [ -w "$bin_dir" ] || bin_dir="$HOME/.local/bin"
  mkdir -p "$bin_dir"
  local tmp="$LOG_DIR/git-lfs"
  mkdir -p "$tmp"
  local name="git-lfs-linux-$arch-v$GIT_LFS_VERSION.tar.gz"
  curl -fsSL -o "$tmp/$name" "https://github.com/git-lfs/git-lfs/releases/download/v$GIT_LFS_VERSION/$name"
  echo "${GIT_LFS_SHA256[$arch]}  $tmp/$name" | sha256sum -c -
  tar -xzf "$tmp/$name" -C "$tmp"
  install -m 0755 "$tmp/git-lfs-$GIT_LFS_VERSION/git-lfs" "$bin_dir/git-lfs"
  export PATH="$bin_dir:$PATH"
  git lfs version
}

setup_media() {
  local link=web/public/media
  local pointer
  pointer="$(first_lfs_pointer)"
  local outcome="up to date"
  if [ -n "$pointer" ]; then
    ensure_git_lfs
    # Without the LFS filter, git would see every materialised file as modified.
    if [ -z "$(git config --get filter.lfs.process || true)" ]; then
      if [ -n "$(git config --get core.hooksPath || true)" ]; then
        # A custom hooks directory is committed; keep LFS's hooks out of it.
        git lfs install --local --skip-repo
      else
        git lfs install --local
      fi
    fi
    git lfs pull --include='data/media/**'
    pointer="$(first_lfs_pointer)"
    if [ -n "$pointer" ]; then
      echo "still an LFS pointer after git lfs pull: $pointer" >&2
      return 1
    fi
    outcome="pulled"
  fi
  # deploy/build-site.sh parks the link at web/.media-stashed during a deploy build.
  if [ ! -e "$link" ] && [ ! -e web/.media-stashed ]; then
    [ -L "$link" ] && rm "$link"
    ln -s ../../data/media "$link"
    outcome="$outcome, linked $link"
  fi
  note "$outcome"
}

setup_browser() {
  local found
  if found="$(node web/scripts/qa/browser.mjs)"; then
    note "$found"
    return
  fi
  if [ ! -e web/node_modules/playwright ]; then
    echo "no Chromium found and web/node_modules has no playwright to install one: run scripts/setup.sh web" >&2
    return 1
  fi
  pnpm -C web exec playwright install chromium
  found="$(node web/scripts/qa/browser.mjs)"
  note "installed $found"
}

declare -A PID STARTED
start_part() {
  local part="$1"
  STARTED[$part]="$EPOCHREALTIME"
  (
    # The end time is the part's own, not when the loop below gets round to waiting on it.
    trap 'echo "$EPOCHREALTIME" >"$LOG_DIR/$PART.end"' EXIT
    PART="$part"
    "setup_$part" >"$LOG_DIR/$part.log" 2>&1
  ) &
  PID[$part]=$!
}

FAILED=()
finish_part() {
  local part="$1" status=0
  wait "${PID[$part]}" || status=$?
  local took
  took="$(awk -v s="${STARTED[$part]}" -v e="$(cat "$LOG_DIR/$part.end")" 'BEGIN { printf "%.1fs", e - s }')"
  if [ "$status" -eq 0 ]; then
    printf 'ok    %-8s %6s  %s\n' "$part" "$took" "$(cat "$LOG_DIR/$part.note" 2>/dev/null || echo 'done')"
  else
    printf 'FAIL  %-8s %6s  log: %s\n' "$part" "$took" "$LOG_DIR/$part.log"
    tail -n 5 "$LOG_DIR/$part.log" | sed 's/^/        /'
    FAILED+=("$part")
  fi
}

# The browser part may install through web's playwright, so it starts once web has finished.
BROWSER_REQUESTED=0
FIRST_WAVE=()
for part in "${PARTS[@]}"; do
  if [ "$part" = browser ]; then BROWSER_REQUESTED=1; else FIRST_WAVE+=("$part"); fi
done
for part in "${FIRST_WAVE[@]}"; do start_part "$part"; done
for part in "${FIRST_WAVE[@]}"; do finish_part "$part"; done
if [ "$BROWSER_REQUESTED" -eq 1 ]; then
  start_part browser
  finish_part browser
fi

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "setup.sh: failed: ${FAILED[*]} (logs in $LOG_DIR)" >&2
  exit 1
fi
rm -rf "$LOG_DIR"
