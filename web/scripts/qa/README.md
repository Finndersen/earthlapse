# Visual QA harness

A pixel-measuring regression check for the app's shell, globe and scene rendering — built after
an agent shrank the globe from ~395px to ~226px by measuring a CSS box instead of drawn pixels.
This tool makes the correct check (measure what's actually drawn) the easy one.

## Commands

```
pnpm qa                          # build (NEXT_PUBLIC_EARTHTIME_QA=1 next build) + serve + run every shot
pnpm qa -- --shots globe-*       # filtered to shots whose name matches a glob
pnpm qa -- --no-build            # reuse the last out/ export instead of rebuilding
pnpm qa -- --dev                 # attach to an already-running `pnpm dev` on :3000 instead
pnpm qa:serve                    # build (unless --no-build) + serve out/, print the URL, idle
```

Full flag reference: `node scripts/qa/run.mjs --help`. One `next build`, one static server
(`server.mjs`, no dependency), one browser, one page load — every shot drives the already-loaded
page through `window.__earthtime` (`src/store/devHook.ts`); nothing ever reloads.

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

## Known flake

On a small fraction of otherwise-identical clean builds, this repo's Next 16 + Turbopack has
failed to inline `NEXT_PUBLIC_EARTHTIME_QA`, so the export never carries the hook. `run.mjs`
checks for `window.__earthtime` right after load and fails fast, naming this, if it never
appears — the fix is to rebuild (drop `--no-build`) and re-run.

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
  <shot-name>.png       one screenshot per shot
  contact-sheet.png     every screenshot in a labelled grid (built in-browser, no image lib)
  report.json           every measurement + assertion + timing + console/page errors
scripts/qa/out/latest -> <run>/
```

`report.json.pass` is `false` (process exits non-zero) if any assertion failed or the run saw a
console/page error — safe for an agent to run unattended and check the exit code.
