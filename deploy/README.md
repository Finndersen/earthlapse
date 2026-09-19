# Deployment

Static site on **Cloudflare Workers (static assets)**, media on **Cloudflare R2**, custom domain,
public. No backend, no build step in the cloud — the site is built and the media uploaded from the
same machine that generates them.

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
4. Create an R2 API token and put the credentials in the repo's gitignored `.env`:
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
5. `wrangler deploy --config deploy/wrangler.jsonc` once, then attach `<domain>` to the Worker.

## Publishing a new version

```
git lfs pull                                   # media must be content, not LFS pointers
.venv/bin/earthtime publish --asset-base https://media.<domain>
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

`--asset-base` and `NEXT_PUBLIC_MEDIA_BASE` must name the same origin: the first decides where
every path inside the manifest hangs off, the second only decides where the manifest itself is
fetched from. `build-site.sh` checks the second; nothing but care checks that they agree.

## Still to wire up

- Nothing has measured a cold first load. That is a content-budget question, not a hosting one —
  R2 will happily serve it all while the visitor waits.
- Credits: several sources are CC BY and require attribution. The in-app credits panel exists;
  audit it against every source manifest before the site is public.
