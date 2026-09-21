#!/usr/bin/env bash
# Upload data/media/ to the R2 bucket that serves the site's assets.
#
# `wrangler r2` has no bulk or sync verb — it is single-object only — so this uses rclone against
# R2's S3-compatible endpoint, which is the route Cloudflare itself documents
# (https://developers.cloudflare.com/r2/examples/rclone/). The remote is built inline from env
# vars so there is no rclone config file holding credentials.
#
# Two passes, because the two kinds of object want opposite cache policies:
#   1. media — filenames already carry a content hash (`wind-077abd6e63.mp3`), so they are
#      immutable and can be cached for a year.
#   2. manifest.json — one unhashed file that changes every publish, so it gets a short TTL.
#      Cloudflare does not edge-cache JSON by default, so this is mostly a browser-side policy.
#
# Requires: rclone, and these in the environment (keep them in .env, which is gitignored):
#   R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET
set -euo pipefail

: "${R2_ACCOUNT_ID:?set R2_ACCOUNT_ID}"
: "${R2_ACCESS_KEY_ID:?set R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?set R2_SECRET_ACCESS_KEY}"
: "${R2_BUCKET:?set R2_BUCKET}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MEDIA_DIR="$REPO_ROOT/data/media"

# `endpoint` must be quoted inside the connection string: rclone splits a remote from its path on
# the first `:`, so a bare `https://…` value is read as the endpoint `https` followed by a path.
REMOTE=":s3,provider=Cloudflare,access_key_id=$R2_ACCESS_KEY_ID,secret_access_key=$R2_SECRET_ACCESS_KEY,endpoint=\"https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com\",no_check_bucket=true:"

# Media is stored in Git LFS; uploading pointer files would publish a broken site silently.
if head -c 40 "$MEDIA_DIR/manifest.json" | grep -q 'git-lfs'; then
  echo "error: data/media holds LFS pointers, not content. Run: git lfs pull" >&2
  exit 1
fi

COMMON=(--fast-list --transfers 16 --checkers 32 --exclude '.claude/**' --exclude '.gitkeep')

echo "==> media (immutable, 1 year)"
rclone copy "$MEDIA_DIR" "$REMOTE$R2_BUCKET" \
  "${COMMON[@]}" \
  --exclude 'manifest.json' \
  --size-only \
  --header-upload 'Cache-Control: public, max-age=31536000, immutable' \
  --progress

echo "==> manifest.json (short TTL)"
rclone copy "$MEDIA_DIR/manifest.json" "$REMOTE$R2_BUCKET" \
  "${COMMON[@]}" \
  --ignore-times \
  --header-upload 'Cache-Control: public, max-age=60, must-revalidate'

echo "done."
