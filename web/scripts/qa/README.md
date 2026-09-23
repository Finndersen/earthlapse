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
pnpm qa -- --no-build            # reuse the last out/ export instead of rebuilding
pnpm qa -- --dev                 # attach to an already-running `pnpm dev` on :3000 instead
pnpm qa:serve                    # build (unless --no-build) + serve out/, print the URL, idle
```

### Which shots to run

A full run is minutes of wall clock and hundreds of MB of PNGs. For a change, run only the shots
covering the area it touches, without images:

```
node scripts/qa/run.mjs --no-build --grep 'phone|globe-expanded' --no-screenshots --out iter
```

Capture screenshots (a second, narrower `--grep` without `--no-screenshots`) only for the few
shots someone will actually look at. `--no-screenshots` still captures one for any shot that
*throws*, since that image is the only record of what the page looked like when it failed.

Run the full list only before a deploy or when asked for.

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

## Known flakes

**Batch-order sensitivity.** Two shots pass alone and fail inside a larger batch:
`globe-click-on-backdrop-still-closes` (passes in every batch of ≤11 shots, fails in every batch
of ≥22) and `timeline-pip-thumbnail-hover` (44×44 alone, 43×32 in a 14-shot batch). Both point at
the same thing: something one shot leaves behind that the next inherits, despite `applyState`
resolving every field it covers. Undiagnosed — do not read either failure as a regression in
whatever you just changed, and reproduce with a single-shot `--grep` before believing it.

`breadcrumb-trimmed` is the same family with a known mechanism: it assumes it starts at a shallow
section, so a preceding shot that navigates deep makes its `getByRole` wait time out.

**Env inlining.** On a small fraction of otherwise-identical clean builds, this repo's Next 16 + Turbopack has
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
console/page error — safe for an agent to run unattended and check the exit code. A shot whose own
code throws (not an `expect` mismatch) is recorded as a failure with an `error` field rather than
aborting the rest of the run.
