#!/usr/bin/env bash
# Gate for `make deploy`, run before anything touches R2 or the Worker. Cheap, local-only checks
# first (git state, media content, manifest, deploy vars), then the full test suite, then a QA smoke run
# against a real build — each one fails fast with a specific reason rather than letting a bad
# publish reach production.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PYTHON="${PYTHON:-$REPO_ROOT/.venv/bin/python}"

echo "==> commit is on origin/main"
# Ancestry rather than the branch name: CI checks out a tag or SHA as a detached HEAD, and an
# older main commit is a valid rollback target. An unpushed local commit is not deployable.
git fetch --quiet origin main
if ! git merge-base --is-ancestor HEAD origin/main; then
  echo "error: HEAD ($(git rev-parse --short HEAD)) is not on origin/main — deploy only ships pushed main commits" >&2
  exit 1
fi

echo "==> working tree"
DIRTY="$(git status --porcelain)"
if [ -n "$DIRTY" ]; then
  echo "error: working tree is not clean:" >&2
  echo "$DIRTY" >&2
  exit 1
fi

echo "==> media is real content, not LFS pointers"
# LFS pointer files are small plain-text; `grep -I` skips real binary media outright, so this
# only ever matches an actual pointer, never a false hit on a webp/mp3's own bytes.
POINTER_FILES="$(grep -rlI '^version https://git-lfs' "$REPO_ROOT/data/media" || true)"
if [ -n "$POINTER_FILES" ]; then
  echo "error: these data/media files are LFS pointers, not content — run: git lfs pull" >&2
  echo "$POINTER_FILES" >&2
  exit 1
fi

echo "==> manifest.json"
MANIFEST="$REPO_ROOT/data/media/manifest.json"
if [ ! -f "$MANIFEST" ]; then
  echo "error: $MANIFEST does not exist — run: earthlapse publish" >&2
  exit 1
fi
"$PYTHON" - "$MANIFEST" "$REPO_ROOT/data/media" <<'PYEOF'
"""Every relative media path the manifest names must exist on disk. Walks the whole JSON tree
rather than a hard-coded field list, since the manifest's own schema (`web/src/types/manifest.ts`)
grows scene/portrait/texture/audio fields independently of this script -- any string shaped like
a relative asset path (a known media extension, no scheme, no leading slash) is checked, so a new
field is covered automatically instead of silently skipped."""

import json
import sys
from pathlib import Path

manifest_path, media_dir = Path(sys.argv[1]), Path(sys.argv[2])
manifest = json.loads(manifest_path.read_text())

MEDIA_EXTENSIONS = (".webp", ".png", ".jpg", ".jpeg", ".mp3", ".ogg", ".m4a", ".wav")


def looks_like_relative_asset_path(value: str) -> bool:
    return (
        value.endswith(MEDIA_EXTENSIONS)
        and "://" not in value
        and not value.startswith("/")
    )


def walk(node):
    if isinstance(node, str):
        if looks_like_relative_asset_path(node):
            yield node
    elif isinstance(node, dict):
        for v in node.values():
            yield from walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk(v)


missing = sorted({path for path in walk(manifest) if not (media_dir / path).is_file()})
if missing:
    print(f"error: {len(missing)} manifest path(s) do not exist under {media_dir}:", file=sys.stderr)
    for path in missing:
        print(f"  {path}", file=sys.stderr)
    sys.exit(1)
PYEOF

echo "==> deploy vars are set"
# Locally the Makefile loads them from .env; in CI they come from the workflow's secrets. Wrangler
# authenticates by `wrangler login` on a workstation, so its token is required only in CI.
REQUIRED_VARS=(R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET MEDIA_BASE)
if [ -n "${CI:-}" ]; then
  REQUIRED_VARS+=(CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID)
fi
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "error: $var is not set — see deploy/README.md's one-time setup" >&2
    exit 1
  fi
done

echo "==> full checks (scripts/check.sh)"
"$REPO_ROOT/scripts/check.sh"

echo "==> QA smoke"
pnpm -C web qa -- --smoke --no-screenshots

echo ""
echo "Preflight passed."
