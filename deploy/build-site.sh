#!/usr/bin/env bash
# Build the static site for deployment, with media pointed at R2 instead of the local symlink.
#
# `web/public/media` is a symlink to `data/media` so that `pnpm dev` serves published output
# locally. Next copies whatever is in `public/` into the export, which would put 87 MB and ~1,400
# files into every deployment — past the point where deploying is cheap, and duplicating what R2
# already serves. So the symlink is moved aside for the build and restored afterwards, including
# on failure. It must be moved *out* of `public/`: anything left inside is copied into the export
# whatever it is named.
#
# Requires MEDIA_BASE, e.g. https://media.example.org — no trailing slash.
set -euo pipefail

: "${MEDIA_BASE:?set MEDIA_BASE, e.g. https://media.example.org}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MEDIA_LINK="$REPO_ROOT/web/public/media"
STASHED="$REPO_ROOT/web/.media-stashed"

restore() {
  if [ -L "$STASHED" ] || [ -e "$STASHED" ]; then
    mv "$STASHED" "$MEDIA_LINK"
  fi
}
trap restore EXIT

if [ -L "$MEDIA_LINK" ] || [ -e "$MEDIA_LINK" ]; then
  mv "$MEDIA_LINK" "$STASHED"
fi

cd "$REPO_ROOT/web"
NEXT_PUBLIC_MEDIA_BASE="$MEDIA_BASE" pnpm build

# The app must have baked the R2 origin in; otherwise it would ship pointing at /media, which no
# longer exists in the export, and every asset would 404 at runtime with no build-time error.
if ! grep -rqF "$MEDIA_BASE" "$REPO_ROOT/web/out"; then
  echo "error: $MEDIA_BASE is not present in web/out — NEXT_PUBLIC_MEDIA_BASE is not wired up" >&2
  exit 1
fi

# The export is a few MB of HTML/JS. Anything near this ceiling means the media payload leaked in
# — the failure mode the stash above exists to prevent, and one that otherwise ships silently.
MAX_OUT_MB=20
out_mb=$(du -sm "$REPO_ROOT/web/out" | cut -f1)
if [ "$out_mb" -gt "$MAX_OUT_MB" ]; then
  echo "error: web/out is ${out_mb} MB (ceiling ${MAX_OUT_MB} MB) — media is being copied into the export" >&2
  exit 1
fi

echo "built web/out against $MEDIA_BASE (${out_mb} MB)"
