# Deployment

Static site on **Cloudflare Workers (static assets)**, media on **Cloudflare R2**, custom domain,
public. No backend. `make deploy` ships the committed state of `main` — from a workstation, or from
the `deploy` GitHub Actions workflow (ADR-052). Neither generates anything: media is generated and
published locally, committed, and deployed as committed.

## Why this shape

R2 has no egress charge and no bandwidth cap; every alternative meters it (Netlify and Vercel bill
transfer, CloudFront's free plan stops at 100 GB/month). The site itself is a few MB and fits
comfortably inside the free 25 MiB/file and 20,000-file limits, while the ~87 MB of media never
touches the deployment at all. Media is already content-hashed, so it caches for a year and a
publish only moves what changed. Running cost is the domain.

Cloudflare now recommends Workers over Pages for new static projects; the limits are identical, so
this uses Workers.

## One-time setup

1. Put the domain's zone on Cloudflare.
2. Create the R2 bucket and attach a custom domain to it (`media.<domain>`) — dashboard, or
   `wrangler r2 bucket domain add <bucket> --domain media.<domain>`.
3. Set the bucket's CORS policy: edit `cors.json` (replace `SITE_DOMAIN`), then
   `wrangler r2 bucket cors set <bucket> --file deploy/cors.json`. The texture, audio and manifest
   fetches are cross-origin, so without this the site loads and then silently renders nothing.
4. Create an R2 API token and put the credentials in the repo's gitignored `.env`, as plain
   `KEY=value` lines (the Makefile includes it): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and `MEDIA_BASE` (`https://media.<domain>`, no trailing
   slash).
5. `wrangler deploy --config deploy/wrangler.jsonc` once, then attach `<domain>` to the Worker.
6. For CI: in the GitHub repo's Settings → Environments, create `production` and add the four R2
   values plus `CLOUDFLARE_API_TOKEN` (a token from the "Edit Cloudflare Workers" template) and
   `CLOUDFLARE_ACCOUNT_ID`. The two keys and the token must be secrets; `R2_ACCOUNT_ID`,
   `R2_BUCKET` and `CLOUDFLARE_ACCOUNT_ID` may be either; `MEDIA_BASE` is an environment
   variable.

## Publishing a new version

Publish and commit first — a deploy ships only what is on `origin/main`:

```
git lfs pull                                   # media must be content, not LFS pointers
.venv/bin/earthtime publish
git commit … && git push origin main
```

Then deploy, by any one of:

```
git commit --allow-empty -m "… [deploy]"       # or put [deploy] in the commit that changes things
git tag v2026.09.23 && git push origin v2026.09.23
make deploy                                    # from a workstation with .env
```

The `deploy` workflow (`.github/workflows/deploy.yml`) runs on a push to `main` whose head commit
message contains `[deploy]`, on a pushed `v*` tag, and on `workflow_dispatch` — the Actions tab's
"Run workflow". A Claude Code cloud session deploys with a `[deploy]` commit, holding no Cloudflare
credential; the Claude GitHub App cannot dispatch workflows. Runs never overlap. A tag is the way to name a release you may want to
roll back to: running the workflow on an older tag redeploys it, and R2 still
holds that version's media because `sync-media.sh` only ever adds objects.

`make deploy` runs `deploy/preflight.sh` first and stops before anything uploads if it fails: a
commit not on `origin/main`, a dirty working tree, an LFS pointer under `data/media` instead of
real content, a `manifest.json` path that doesn't exist on disk, a missing deploy var (the R2 vars
and `MEDIA_BASE`; in CI also the Cloudflare pair), `scripts/check.sh` (full), or the QA smoke run
(`pnpm -C web qa -- --smoke --no-screenshots`). The individual targets
still exist for when you want just one step:

```
make preflight                                 # the checks above, nothing uploaded
make deploy-media                              # rclone → R2, changed objects only
make deploy-site                               # build against the R2 origin, then wrangler deploy
```

`deploy/sync-media.sh` uploads in two passes because the cache policies differ: hashed media gets
`max-age=31536000, immutable`, and `manifest.json` — the one unhashed file — gets 60 seconds.
There is no `wrangler r2 sync`; `wrangler r2 object` is single-object only, so this uses rclone
against R2's S3 endpoint, the route Cloudflare documents.

`deploy/build-site.sh` moves `web/public/media` aside for the build so the export stays small, and
fails if the R2 origin was not baked into the output rather than shipping a site whose assets all
404.

`NEXT_PUBLIC_MEDIA_BASE` is the only origin setting. It decides where the manifest is fetched
from, and the viewer hangs every path inside the manifest off that same base rather than off the
`assetBase` string the publish step wrote (`web/src/shell/manifest.ts`). So one published
`data/media/` tree serves both a local dev server and the deployment, and `earthtime publish
--asset-base` is not part of this flow — passing the R2 origin there used to be required, and
left a dev server fetching every asset from the CDN.

## Still to wire up

- Nothing has measured a cold first load. That is a content-budget question, not a hosting one —
  R2 will happily serve it all while the visitor waits.
- Credits: several sources are CC BY and require attribution. The in-app credits panel exists;
  audit it against every source manifest before the site is public.
