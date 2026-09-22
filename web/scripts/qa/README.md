# Visual QA harness

A pixel-measuring regression check for the app's shell, globe and scene rendering — built after
an agent shrank the globe from ~395px to ~226px by measuring a CSS box instead of drawn pixels.
This tool makes the correct check (measure what's actually drawn) the easy one.

## Commands

```
pnpm qa                          # build (NEXT_PUBLIC_EARTHTIME_QA=1 next build) + serve + run every shot
pnpm qa -- --shots globe-*       # filtered to shots whose name matches a glob
pnpm qa -- --grep phone          # filtered to shots whose name matches a regex anywhere
pnpm qa -- --no-screenshots      # assertions only: no PNGs, no contact sheet
pnpm qa -- --extra-shots f.mjs   # append another shot module's default export to the list
pnpm qa -- --smoke               # run only smokeShots.mjs's named subset (~10-15 shots)
pnpm qa -- --no-build            # reuse the last out/ export instead of rebuilding
pnpm qa -- --dev                 # attach to an already-running `pnpm dev` on :3000 instead
pnpm qa:serve                    # build (unless --no-build) + serve out/, print the URL, idle
```

### Iterating quickly

The full list is ~90 shots and every one writes a full-page PNG, so a whole run is minutes and
hundreds of MB. While iterating on one area, run that area only and skip the images:

```
node scripts/qa/run.mjs --no-build --grep 'phone|globe-expanded' --no-screenshots --out iter
```

`--no-screenshots` still captures one for any shot that *throws*, since that image is the only
record of what the page looked like when it failed. Run the full list with images once at the
end — an assertion subset cannot tell you that something elsewhere now looks wrong.

`--smoke --no-screenshots` is what `deploy/preflight.sh` runs before a deploy: fast, and exits
non-zero on a real failure the same way the full run does.

Full flag reference: `node scripts/qa/run.mjs --help`. One `next build`, one static server
(`server.mjs`, no dependency), one browser, one page load — every shot drives the already-loaded
page through `window.__earthtime` (`src/store/devHook.ts`); nothing ever reloads.

### Scene framing review

`shots.scene-framing.mjs` is a separate module, one phone-portrait shot per published scene, for
judging each scene's crop by eye on the contact sheet:

```
node scripts/qa/run.mjs --extra-shots scripts/qa/shots.scene-framing.mjs --grep scene-framing --out scene-framing
```

## The pixel-vs-CSS-box rule

**Never assert on a CSS box when you mean "what got drawn."** A `<canvas>` can have any CSS size
while drawing something much smaller inside it — that's the bug this harness exists to catch.
Two primitives (`measure.mjs`), deliberately named so they can't be confused:

- `drawnBounds(page, selector)` — screenshots the element, scans for pixels that differ from the
  sampled background, returns the bounding box of what's actually drawn, in CSS pixels (the
  context always runs at `deviceScaleFactor: 1`).
- `boxOf(page, selector)` — the plain CSS box (`getBoundingClientRect`). Reach for this only when
  you genuinely want layout, not paint.

`gapBetween(page, a, b)` is the vertical free space between two elements' *drawn* content.

## Adding a shot

Shots are data (`shots.mjs`), not code — add one object, never touch `run.mjs`:

```js
{
  name: 'my-new-check',                     // becomes <name>.png
  description: 'One line: what this guards.',
  viewport: { width: 1440, height: 900 },   // optional, default 1440x900
  t: 12345,                                 // optional: years before present
  state: { globeExpanded: true, globeViewMode: 'map', layerToggles: { 'human-civilisation': false } },
  reducedMotion: 'no-preference',           // optional, overrides --reduced-motion
  actions: async ({ page, hook }) => { /* anything `state` can't express */ },
  measure: async ({ page }) => ({ sphere: await drawnBounds(page, '...') }),
  expect: { 'sphere.width': [480, 560] },   // dot-path into measure()'s result -> [min, max]
}
```

`state` always resolves every field it covers, never a partial diff from the previous shot (see
`applyState` in `run.mjs`) — a shot with no `state` used to silently inherit whatever the
*previous* shot left the globe in. To add a measurement, add a pure
`(page, selector, options) -> numbers` function to `measure.mjs`; assertions belong in `expect`,
not the measurement itself.

`smokeShots.mjs` lists a representative subset by name for `--smoke` — add a shot to `shots.mjs`
as above, and separately decide whether it belongs in the smoke list too (most don't; the smoke
run is meant to stay small).

### A shot that needs the harness's one page load

The runner loads its one page once, before any shot's turn, so an ordinary shot never sees the app
mid-load — by the time it runs, the loading screen is long gone. A shot that genuinely needs to
observe that one load (the `loading-screen` shot: it has to catch the loader still on screen)
declares `bootstrapsPage` instead of `actions`/`measure`, and owns that one navigation itself:

```js
{
  name: 'loading-screen',
  bootstrapsPage: async ({ page, baseUrl, run }) => {
    // Set up any `page.route` hold *before* navigating, then `await page.goto(baseUrl, ...)` —
    // this *is* the harness's one real load, not a side page. Screenshot with `page.screenshot()`
    // (no `path`, so it returns a `Buffer`) while whatever you're holding back is still held.
    return { screenshot: run.screenshots ? await page.screenshot() : null, measurements: { ... } }
  },
  expect: { ... },
}
```

`run.mjs` calls `bootstrapsPage` in place of the generic `page.goto`, before `hook` (and
`window.__earthtime`) exist — raw Playwright only, no `hook` argument. Everything after it returns
(waiting for the QA hook, `hook.ready()`, dismissing the first-visit tour) runs exactly as it does
for every other shot. At most one shot in a given run may declare `bootstrapsPage`; run.mjs finds
it before navigating and writes its returned `screenshot` buffer to `<name>.png` itself, the same
place an ordinary shot's `page.screenshot({ path })` would have. A shot that needs to check
something *independent* of that one load's own timing (`loading-screen`'s own scripts-blocked
static-HTML checks) can still open an ordinary side page inside `bootstrapsPage`, exactly as any
other shot's `measure` would.

## Known flakes

**Env inlining.** On a small fraction of otherwise-identical clean builds, this repo's Next 16 +
Turbopack has failed to inline `NEXT_PUBLIC_EARTHTIME_QA`, so the export never carries the hook.
`run.mjs` checks for `window.__earthtime` right after load and fails fast, naming this, if it
never appears — the fix is to rebuild (drop `--no-build`) and re-run.

**Batch-order state leaks.** Shots share one page load, so any state a shot can change and
`applyState` does not reset leaks into the next. `applyState` resets the selected section, the
event browser, the expanded HUD chart and the globe camera (a real collapse before every expand),
and waits out the sphere<->map unfold. If a shot passes alone and fails in a batch, reproduce
with `pnpm qa -- --shots <predecessor>,<shot>` and add the leaked field to `applyState`.

## Determinism

- `prefers-reduced-motion` defaults to `reduce` (`--reduced-motion no-preference` to disable) so
  the globe's auto-rotate can't make two identical shots differ by whatever angle it drifted to.
- Every shot awaits `hook.ready()` (manifest loaded, every image/texture load this run has seen
  settled) plus a couple of real `requestAnimationFrame` ticks — never a blind sleep.
- Two genuinely-unavoidable timeouts live in `timeouts.mjs`, reasoning attached: the scene
  crossfade's own rate limit (no signal to poll for), and the globe's sphere<->map tween, which
  has no DOM or store reflection of its progress at all.

## Output

```
scripts/qa/out/<run>/
  <shot-name>.png       one screenshot per shot (skipped under --no-screenshots)
  contact-sheet.png     every screenshot in a labelled grid (skipped under --no-screenshots)
  report.json           every measurement + assertion + timing + console/page errors
scripts/qa/out/latest -> <run>/
```

`report.json.pass` is `false` (process exits non-zero) if any assertion failed or the run saw a
console/page error — safe for an agent to run unattended and check the exit code. A shot whose own
code throws (not an `expect` mismatch) is recorded as a failure with an `error` field rather than
aborting the rest of the run.
