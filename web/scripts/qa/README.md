# Visual QA harness

A pixel-measuring check of what only a real browser can see: layout geometry at the key viewports,
WebGL/canvas output, pointer hit-testing against real geometry, and the one real page load
(CLAUDE.md, "Testing policy"). Everything jsdom can assert belongs in vitest instead.

## Commands

```
pnpm qa                          # build the QA export into out-qa/ + serve + run every shot
pnpm qa -- --smoke               # smokeShots.mjs's subset only
pnpm qa -- --no-build            # reuse the existing out-qa/ export instead of rebuilding
pnpm qa -- --shots layout-*      # shots whose name matches a glob (comma-separated)
pnpm qa -- --grep 390            # shots whose name matches a regex anywhere
pnpm qa -- --no-screenshots      # assertions only: no PNGs, no contact sheet
pnpm qa -- --extra-shots f.mjs   # append another shot module's default export to the list
pnpm qa -- --no-sort             # run in file order instead of grouped by viewport
pnpm qa -- --shards 2            # split the shots across 2 pages loaded in parallel
pnpm qa -- --dev                 # attach to an already-running `pnpm dev` on :3000 instead
pnpm qa:serve                    # build (unless --no-build) + serve out-qa/, print the URL, idle
```

Full flag reference: `node scripts/qa/run.mjs --help`.

- **The QA export lives in `web/out-qa/`**, not `web/out/`: `next.config.ts` switches `distDir` when
  `NEXT_PUBLIC_EARTHTIME_QA=1`, so an ordinary `pnpm build` (or `scripts/check.sh`) can never
  replace it with an export that lacks the QA hook.
- **`QA_CHROMIUM_PATH`** points the runner at a Chromium binary when the preinstalled one does not
  match this Playwright version (`QA_CHROMIUM_PATH=/opt/pw-browsers/chromium` in the cloud
  container).
- **Budgets:** full run ≤ 3 min, `--smoke` ≤ 60 s on a 4-core machine. The run prints its wall
  time and its ten slowest shots; a change that pushes past a budget pays for itself by removing
  or merging measurements elsewhere.

`--smoke --no-screenshots` is what `deploy/preflight.sh` runs before a deploy, and exits non-zero
on a real failure the same way the full run does. For a change, run only the shots covering the
area it touches (`--grep 390`), without screenshots; capture them only for the few shots someone
will look at. `--no-screenshots` still captures one for any shot that throws.

Sorting groups shots by viewport (one resize per group instead of per shot). `--shards N` loads N
pages in their own contexts and runs contiguous slices of the list on each; rendering here is
CPU-bound software WebGL, so on a 4-core machine two shards cut the full run only ~10% and the
smoke run not at all.

## The shots

One shot per key viewport and state, each measuring everything about that layout at once, plus
the page load and the globe's pointer interactions:

| Shot | Guards |
|---|---|
| `loading-screen` | the loader is in the static HTML, animates only with motion allowed, steps its progress, and is gone once the shell mounts |
| `layout-1440x900-resting` | no chrome region overlaps another or leaves the viewport (root and three sections deep); the drawn orb, its hover ring against the drawn limb, scene and timeline; the transport row's geometry, rate picker and (playing) rate readout included; the event browser, population sparkline and chart against the timeline |
| `layout-1000x810-resting` | the same at narrow desktop, with the rate readout under the transport and the secondary controls on one row |
| `layout-390x844-resting` | phone portrait: chrome regions, drawn orb vs portrait size, stacked controls rows and the rate picker inside its row, the feed's "All events" tap target and the sheet it opens, the tour's first step |
| `phone-orb-touch-tap` | a finger tap on the phone's minimised orb expands it with `t` and the section unchanged (touch page) |
| `layout-844x390-resting` | short landscape (ADR-048): drawn orb and portrait sizes, chrome regions at the root and in a section, the caption on the feed row, the controls rows |
| `layout-1440x900-expanded` | desktop expanded globe, sphere then map: drawn body size, corner and controls-row alignment, no overlaps |
| `layout-1000x810-expanded` | the same at narrow desktop, sphere only |
| `layout-390x844-expanded` | phone expanded: drawn sphere size and the rows around it; row 2 clear of the drawn map |
| `layout-844x390-expanded` | short-landscape expanded: the column beside the drawn sphere and map, the crumb trail over the transport |
| `globe-interactions` | clicks on the orb, sphere, "Map" button, map and backdrop hit what they should; one zoom press grows the drawn sphere; a click on a drawn arrival opens its detail panel's Route section |

`shots.scene-framing.mjs` is a separate, opt-in module — one phone-portrait shot per published
scene, for judging crops by eye on the contact sheet:

```
node scripts/qa/run.mjs --extra-shots scripts/qa/shots.scene-framing.mjs --grep scene-framing --out scene-framing
```

## Adding a measurement

Read CLAUDE.md's "Testing policy" first: a QA shot is justified only by needing a real browser.
**The default is to extend an existing shot's `measure`/`expect`** — a layout change adds its
regions or numbers to the shot for that viewport and state; a new region joins `RESTING_REGIONS`
or a shot's `boxesOf` map and so gets the pairwise no-overlap and in-viewport checks for free. A
new shot is for a viewport or state no existing shot sets up, and never for a single check.
Diagnostic shots and probes are run from a scratch file through `--extra-shots` and never
committed.

A shot is data (`shots.mjs`); `run.mjs` never changes for one:

```js
{
  name: 'layout-1440x900-resting',          // becomes <name>.png
  description: 'What it asserts, present tense.',
  viewport: { width: 1440, height: 900 },   // optional, default 1440x900
  t: 0,                                     // optional: years before present
  state: { globeExpanded: true, globeViewMode: 'map', layerToggles: { 'human-civilisation': false } },
  reducedMotion: 'no-preference',           // optional, overrides --reduced-motion
  touch: true,                              // optional: run on the touch page (below)
  actions: async ({ page, hook }) => { /* anything `state` can't express */ },
  measure: async ({ page, hook }) => ({ sphere: await globeBodyBounds(page, FIT_FRAME) }),
  expect: { 'sphere.width': [470, 515] },   // dot-path into measure()'s result -> [min, max]
}
```

`state` always resolves every field it covers (`applyState` in `run.mjs`), never a partial diff
from the previous shot. Pure `(page, …) -> numbers` measurements belong in `measure.mjs` or the
helpers at the top of `shots.mjs`; assertions belong in `expect`.

**A check that cannot fail proves nothing.** Before trusting a new assertion, break what it guards
and watch it fail: a scratch `--extra-shots` module that wraps the shot's `actions` to inject CSS
(move a region onto another, scale the canvas down) is enough.

## Measuring what is drawn

**Never assert on a CSS box when you mean "what got drawn."** A `<canvas>` can have any CSS size
while drawing something much smaller inside it. And pick the measurement that matches what is
underneath:

- `drawnBounds(page, selector)` (`measure.mjs`) screenshots an element and returns the bounds of
  pixels that differ from its sampled corners. Sound over a flat panel; worthless over the
  photographic scene, whose texture reads as content.
- `polylineTraceBounds` measures an SVG trace (sparklines, charts) by its real `<polyline>` geometry.
- `opacityMatteBounds` (`shots.mjs`) screenshots against a black and then a white backdrop with the
  scene hidden: the pair differs by exactly the pixel's transparency, so content colour cancels
  out. `globeBodyBounds` uses it to find the expanded globe's opaque body: the atmosphere glow is
  translucent and drops out, where a brightness threshold cannot tell its bright inner edge from
  the sphere. A drawn-size scan clipped to the globe's fit frame with the photo showing is not a
  measurement at all — a shrunken sphere leaves backdrop texture that reads as drawn to the
  clip's edges.
- `boxOf`/`boxesOf` read layout boxes: right for opaque DOM chrome, where the box is what is painted.

## A shot that needs a touchscreen

Playwright fixes `hasTouch` per browser context, and the main page's context has none, so
`(pointer: coarse)` stays false for every other shot. A shot that needs real touch input sets
`touch: true`: after the rest, `run.mjs` loads one more page, in a `hasTouch` context, and runs
every touch shot on it the same way the main page is shared. `applyState` and the hook work there
unchanged. `touchTap` in `shots.mjs` taps through CDP touch events with a 1px move before lift, as a
real finger does.

## A shot that needs the harness's one page load

The runner loads its page once, before any shot, so an ordinary shot never sees the app mid-load.
The one shot that must (`loading-screen`) declares `bootstrapsPage({ page, baseUrl, run })` instead
of `actions`/`measure`: `run.mjs` calls it in place of its own `page.goto`, before
`window.__earthtime` exists, and writes its returned `screenshot` buffer to `<name>.png`. Waiting
for the hook, `hook.ready()` and the tour dismissal then run as for any other load. At most one
shot in a run may declare it; with `--shards` it runs on the first page.

## Known flakes

**Env inlining.** On a small fraction of otherwise-identical clean builds, this repo's Next 16 +
Turbopack has failed to inline `NEXT_PUBLIC_EARTHTIME_QA`, so the export never carries the hook.
`run.mjs` checks for `window.__earthtime` right after load and fails fast naming this — rebuild
(drop `--no-build`) and re-run.

**State leaks.** Shots share one page load, so any state a shot can change and `applyState` does
not reset leaks into the next. If a shot passes alone and fails in a batch, reproduce with
`--no-sort --shots <predecessor>,<shot>` and add the leaked field to `applyState`.

## Determinism and speed

- `prefers-reduced-motion` defaults to `reduce` (`--reduced-motion no-preference` to disable), so
  auto-rotation cannot make two identical runs differ; under it the sphere<->map unfold snaps.
- Every shot awaits `hook.ready()` plus a couple of `requestAnimationFrame` ticks, and the expanded
  globe's layout is settled by polling its fit frames (`waitForGlobeFitFramesStable`). The blind
  waits that remain live in `timeouts.mjs`, each for animation state with nothing to poll: the
  scene crossfade after a `t` jump (skipped when `t` is unchanged), the unfold tween with motion
  allowed, and the scrub track's section-window animation.
- With the globe expanded, every page round trip waits out a software-rendered frame (~150-300 ms),
  so measurements read many boxes per `page.evaluate` (`boxesOf`) rather than one per call.

## Output

```
scripts/qa/out/<run>/
  <shot-name>.png       one screenshot per shot (skipped under --no-screenshots)
  contact-sheet.png     every screenshot in a labelled grid (skipped under --no-screenshots)
  report.json           every measurement + assertion + timing + console/page errors
scripts/qa/out/latest -> <run>/
```

`report.json.pass` is `false` (and the process exits non-zero) if any assertion failed or the run
saw a console/page error. A shot whose own code throws is recorded as a failure with an `error`
field rather than aborting the run.
