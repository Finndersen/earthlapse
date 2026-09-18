#!/usr/bin/env bash
# Build the static site for deployment, with media pointed at R2 instead of the local symlink.
#
# `web/public/media` is a symlink to `data/media` so that `pnpm dev` serves published output
# locally. Next copies whatever is in `public/` into the export, which would put 308 MB and ~500
# files into every deployment — past the point where deploying is cheap, and duplicating what R2
# already serves. So the symlink is moved aside for the build and restored afterwards, including
# on failure.
#
# Requires MEDIA_BASE, e.g. https://media.example.org — no trailing slash.
set -euo pipefail

: "${MEDIA_BASE:?set MEDIA_BASE, e.g. https://media.example.org}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MEDIA_LINK="$REPO_ROOT/web/public/media"
STASHED="$REPO_ROOT/web/public/.media-stashed"

restore() {
  [ -e "$STASHED" ] && mv "$STASHED" "$MEDIA_LINK"
}
trap restore EXIT

[ -e "$MEDIA_LINK" ] && mv "$MEDIA_LINK" "$STASHED"

cd "$REPO_ROOT/web"
NEXT_PUBLIC_MEDIA_BASE="$MEDIA_BASE" pnpm build

# The app must have baked the R2 origin in; otherwise it would ship pointing at /media, which no
# longer exists in the export, and every asset would 404 at runtime with no build-time error.
if ! grep -rqF "$MEDIA_BASE" "$REPO_ROOT/web/out"; then
  echo "error: $MEDIA_BASE is not present in web/out — NEXT_PUBLIC_MEDIA_BASE is not wired up" >&2
  exit 1
fi

echo "built web/out against $MEDIA_BASE"
