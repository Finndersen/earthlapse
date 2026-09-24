#!/usr/bin/env bash
# Upload data/media/ to the R2 bucket that serves the site's assets.
#
# `wrangler r2` has no bulk or sync verb — it is single-object only — so this uses rclone against
# R2's S3-compatible endpoint, which is the route Cloudflare itself documents
# (https://developers.cloudflare.com/r2/examples/rclone/). The remote is built inline from env
# vars so there is no rclone config file holding credentials.
#
# Three passes, by whether an object's name changes when its bytes do:
#   1. content-hashed media (`wind-077abd6e63.mp3`, `scenes/city-3a91cf02de.webp`) — immutable,
#      cached for a year. Only a name matching HASHED gets this: an unhashed name cached
#      immutable keeps serving its old bytes after a republish.
#   2. every other media file (globe textures, layer JSON, portrait morphs) — cached briefly and
#      revalidated. Always re-uploaded, so an object stored under an older policy is rewritten.
#   3. manifest.json — changes every publish, so it gets the shortest TTL.
#
# Requires: a current rclone (CI pins v1.75.1; Ubuntu's packaged 1.60 gets 501 NotImplemented from
# R2 on upload), and these in the environment (keep them in .env, which is gitignored):
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

COMMON=(--fast-list --transfers 16 --checkers 32 --filter '- .claude/**' --filter '- .gitkeep')
# `<name>-<10 hex>.<ext>`: pipeline.audio.content_hashed_filename, the only hashed naming.
HASHED='*-{{[0-9a-f]{10}}}.*'

echo "==> content-hashed media (immutable, 1 year)"
rclone copy "$MEDIA_DIR" "$REMOTE$R2_BUCKET" \
  "${COMMON[@]}" \
  --filter "+ $HASHED" --filter '- *' \
  --size-only \
  --header-upload 'Cache-Control: public, max-age=31536000, immutable' \
  --progress

echo "==> other media (5 minutes, then revalidate)"
rclone copy "$MEDIA_DIR" "$REMOTE$R2_BUCKET" \
  "${COMMON[@]}" \
  --filter '- manifest.json' --filter "- $HASHED" --filter '+ *' \
  --ignore-times \
  --header-upload 'Cache-Control: public, max-age=300, must-revalidate' \
  --progress

echo "==> manifest.json (short TTL)"
rclone copy "$MEDIA_DIR/manifest.json" "$REMOTE$R2_BUCKET" \
  "${COMMON[@]}" \
  --ignore-times \
  --header-upload 'Cache-Control: public, max-age=60, must-revalidate'

echo "done."
