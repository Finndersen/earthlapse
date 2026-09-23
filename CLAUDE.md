# Earthlapse

Interactive visualisation of Earth's history. Photoreal stills evolving across 4.6 Gyr,
surrounded by data layers, fully scrubbable. Fully static frontend, offline Python pipeline.

## Before writing any code

Read [`docs/DESIGN.md`](docs/DESIGN.md). Then the doc for your area:

- data source work → [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md)
- generation / prompts → [`docs/VISUAL_SPEC.md`](docs/VISUAL_SPEC.md)
- globe, projection and overlays → [`docs/GLOBE.md`](docs/GLOBE.md)
- what to build when → [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md)
- why something is the way it is → [`docs/DECISIONS.md`](docs/DECISIONS.md)

Sections marked **NORMATIVE** are contracts: `WorldState` (DESIGN §4), the five curated
shapes (DATA_SOURCES § Contract), the pipeline semantics (DESIGN §9), the `Layer` interface
(DESIGN §10), the style split (VISUAL_SPEC §2). Changing one requires a new ADR — propose
it, do not unilaterally edit.

## Hard rules

- **Never raise `--max-spend`.** Total generation budget is $100, enforced in
  `pipeline/spend.py`. If a build hits the ceiling, stop and report — do not work around it.
  Note the footgun: `--max-spend` **overwrites** the ledger's stored ceiling with an absolute
  value, it does not add to it (`Ledger.load`: "CLI flag wins over whatever was stored"). It is a
  **required** option on `earthlapse build` — it cannot be left off — so every build retypes the
  ceiling, and a typo silently rewrites it rather than erroring. Always pass exactly
  `--max-spend 100`. Check `spend.json`'s `ceiling_usd` afterwards if you are unsure.
  This is a known design wart: a safety rail you must re-state correctly on every use is one you
  will eventually state wrongly. Making the flag optional and defaulting to the stored ceiling
  needs an ADR, since `pipeline/spend.py` is NORMATIVE.
- **A cloud session is ephemeral: commit what generation produced before it ends.** `spend.json`
  is the ledger; spend a session never pushes is spend the ceiling forgets. Unpinned candidates
  (`data/candidates/`, gitignored) die with the container, so review, pin and publish in the same
  session, then commit and push the pins, `data/media/` and `spend.json`.
- **Deploy from a cloud session with a `[deploy]` commit on `main`**, never with credentials in the
  session. The `deploy` workflow ships the committed state of `main` (ADR-052); see
  `deploy/README.md` for the other triggers.
- **No live API calls or large downloads in tests.** Every source ships a committed fixture
  at `sources/<name>/fixture/`. Use it.
- **Nothing reads `data/curated/` directly.** Go through `WorldState.at(t)`. (ADR-002)
- **`Layer.sample()` must be pure in `t`.** A layer reading anything else breaks scrubbing.
- **Never regenerate a pinned asset.** Pins live in scene records and survive rebuilds. (ADR-005)
- **No generated video for connective transitions.** (ADR-001) Motion is 2.5D displacement
  rendered live in the browser.
- **Never chain image generation off the previous image.** Final scenes render from text
  only: style spec, shot, composition, conditions, subject. (ADR-004, ADR-010)
- **No provider names outside `pipeline/generators/`.** Vendors must stay swappable.
- **If something is unusable, stop and report.** Do not silently substitute a different
  dataset, model or approach.

## Layout

```
sources/<name>/     manifest.toml, fetch.py, normalise.py, fixture/, README.md
pipeline/           models, shapes, asset graph, generators, review CLI, spend ledger
data/raw/           gitignored — reproducible via fetch.py + sha256
data/curated/       parquet, one of five shapes
data/media/         published manifest + media — Git LFS
web/                Next.js static export
  scene/            2.5D displaced stills + dissolve
  globe/            independent three.js sphere
  timeline/         warped scale, LOD, scrubbing
  layers/           HUD, sparklines, charts
audio/              stems + Tone.js score
docs/               DESIGN, VISUAL_SPEC, DATA_SOURCES, IMPLEMENTATION, DECISIONS
```

## Commands

The Python CLI lives in the project venv — always call it as `.venv/bin/earthlapse`.

```
python -m pipeline.databuild --only <source> [--force]   # rebuild ONE source into data/curated/
make data                       # re-run every stale source (see "Working in parallel")
earthlapse plan                  # what is stale, what it will cost
earthlapse build --only images   # generate, respecting pins and ceiling
earthlapse review                # candidate picker; review clear <id>, review pick <id> <n>
earthlapse publish               # write data/media/manifest.json + media (local; no upload)
make deploy                     # preflight, then R2 media + Worker site (deploy/README.md)
```

In a fresh container, run `scripts/setup.sh [python|web|media|browser]` before the first check or
QA run, naming only the parts you need (checks: `python web`; QA: `web media browser`). It is
idempotent and ~0.1 s when warm; `make check` and `pnpm qa` fail fast naming a missing part.

Checks — all must pass before handing work back. `make check` (`scripts/check.sh`) runs every one,
the Python and web groups in parallel:

```
.venv/bin/python -m pytest -q tests
.venv/bin/ruff check . && .venv/bin/ruff format --check .
pnpm -C web typecheck && pnpm -C web exec vitest run
pnpm -C web build
```

For the inner loop, `scripts/check.sh --quick --changed` skips the build and any group the branch
has not touched, and runs only the vitest files affected by the change; `pytest -m "not content"`
skips the committed-data checks. Hand work back only on a full `make check`.

Two traps in that third line, both of which have already produced falsely-green reports:

- **`exec` is required.** `pnpm -C web vitest run` fails with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL: Command "web" not found` — and **still exits 0**, so the `&&` chain succeeds having run no tests at all. Only `pnpm -C web exec vitest run` (or the `test` script) actually runs the suite.
- **Read the console summary, not a file.** `web/vitest.config.ts` configures no JSON reporter, so `pnpm -C web exec vitest run` writes no machine-readable report — `web/.vitest/json/output.json` is never created. An earlier version of this note told you to `rm -f` that path and treat its absence as a failure, which marks every correct run as failed. The pass/fail counts printed to stdout are the only signal; a run that prints no summary at all crashed.

## Verifying UI work

Screenshots are evidence, not verification. **Assert on drawn pixels, never on CSS boxes** — an
element's layout box routinely differs from what is painted inside it, and a check that measures
the box will pass while the thing on screen is wrong.

**But pixel-diffing has its own trap: it needs something to diff against.** `drawnBounds` decides
what is "drawn" by comparing against sampled corner background, which is sound over a flat panel and
worthless over a busy photographic scene with no opaque backing — the photo's own texture registers
as content. It measured 173px of "width" for a completely empty SVG and passed a check that should
have failed. For an SVG trace (sparklines, charts), measure the real element geometry instead —
`polylineTraceBounds` unions the actual `<polyline>` rects and cannot be fooled by the backdrop.
Pick the measurement that matches what is underneath the thing you are measuring.

Make sure an assertion measures the thing that would actually be wrong: a range a broken render
would violate, read from what is drawn rather than from a box or backdrop that stays put when it
breaks. That needs no second build; the QA README's CSS-injection trick covers the unclear cases.

Use the harness at `web/scripts/qa/` (see its README) rather than writing a throwaway Playwright
script: it loads the page once, drives it through `window.__earthlapse` without reloading, measures
rendered bounds, fails on console errors, and writes a screenshot contact sheet. Extend an existing
shot rather than adding a new script — see "Testing policy" for when a shot is justified at all.

**Working loop.** Iterate with `pnpm -C web qa -- --dev --grep <area>` (hot reload against `next
dev`, no build) and `scripts/check.sh --quick --changed`. At the end, one static build with
`pnpm -C web qa -- --smoke`, or the full `pnpm -C web qa` when layout or WebGL/canvas output
changed; then hand back on a full `make check`.

## Testing policy

The suites are kept small on purpose: every test is paid for on every run and on every change that
breaks it without breaking the product. Before adding a test, pick the cheapest layer that can see
the behaviour, and prefer extending an existing test over adding one.

| Layer | Owns | Not for |
|---|---|---|
| pytest | NORMATIVE contracts, hard rules (spend ceiling, pins, no provider names, text-only generation), pipeline semantics, each source's own parsing rules | pydantic built-ins (`Field` bounds, `Literal`, required fields), CLI copy, tuning constants |
| vitest | pure logic with real invariants; one wiring test per critical interaction (jsdom sees DOM state, not layout) | copy text, CSS class names, inline styles, snapshot tables of tuned numbers |
| QA shots | only what needs a real browser: layout geometry at the key viewports, WebGL/canvas output, pointer hit-testing against real geometry, the one real page load | anything jsdom can assert; per-scene or per-content sweeps; one-off diagnostics |

- **A new feature adds at most one test per layer it genuinely needs**, asserting the behaviour a
  user would notice if it broke. A layout change extends the existing viewport shot's measurements;
  it does not add a shot.
- **A bug fix adds a regression test only when the bug could plausibly recur** through ordinary
  edits, and then as an assertion in the existing test for that area, titled by the behaviour it
  guards, never by the incident.
- **Content is not code.** Committed data (captions, scene books, rosters) is checked only where a
  hard rule depends on it, marked `@pytest.mark.content`. Editorial choices are not tested.
- **Delete as you go.** When a change makes a test redundant, weaker than another, or asserting a
  removed feature, delete it in the same change. Diagnostic shots and probes never get committed.
- **Budgets.** Full QA run ≤ 3 min, `--smoke` ≤ 60 s, vitest ≤ 40 s, pytest ≤ 15 s on a 4-core
  machine. A change that pushes a suite past its budget pays for itself by removing or merging
  tests elsewhere, not by raising the budget.

## Working in parallel

Several agents often run at once. The failures that actually happen here are shared-state ones,
not merge conflicts:

- **One writer per file.** Every agent brief lists the paths it owns; nobody edits outside them.
- **Only the coordinator runs `make data`, `earthlapse publish` and `git` writes.** A subagent that
  needs curated data rebuilds exactly its own source with `python -m pipeline.databuild --only
  <source>`; `make data` can delete another agent's outputs, and a mid-run `publish` breaks any
  browser check in flight. Publish once, at the end, from one place.
- **Shared-edit files are serialised**, not parallelised: `docs/DECISIONS.md`, `data/scenes.yaml`,
  `data/events.yaml`, `pipeline/publish.py`.
- **Ask before committing or pushing.** Nothing is committed on the user's behalf unasked.
- **Never symlink `node_modules` into a worktree**: Turbopack crashes on it. Run
  `scripts/setup.sh web` there instead; pnpm's store makes it a few seconds.
- **QA belongs to its checkout.** The export, run output and `--dev` port are per checkout and the
  static server takes a free port, so worktrees run QA concurrently; two runs in one checkout
  collide on `out-qa/`. A `--dev` run leaves `next dev` up: `pnpm -C web qa -- --stop-dev` when done.

## Style

Python 3.12, pydantic v2, Typer, ruff, full type hints. TypeScript strict,
react-three-fiber, zustand. Prefer small pure functions and explicit protocols over
frameworks — the codebase should be readable end to end without learning a DSL.

### Comments

Comments explain the code **as it exists now**, as briefly as the point allows, and only where
the code cannot say it itself. A constant whose value is non-obvious gets the reason for *that
value* — not who asked for it, or when.

Do not write: verbatim user-report quotes, dates, "user report:"/"user ask:" preambles,
narratives of what the code used to do, accounts of which bug a line fixed, internal work-item
labels ("W12a", "item 7", "re-review fix", "follow-up pass"), or a restatement of an ADR that
already records the decision. **History belongs in git commit messages and
`docs/DECISIONS.md`.** A work-item label is the worst of these: it is meaningless to anyone
outside the session that coined it, and it never becomes meaningful again.

This applies to **test titles and `it.each` row labels** too, not just comments. A test title
says what behaviour is asserted, in the present tense. A comment duplicating them goes stale and actively misleads the next
reader; an inline narrative buries the logic it sits on top of.

Length is itself a smell. A doc comment running past ~8 lines is usually recording a decision
(→ ADR), re-deriving something a reader can see (→ delete), or describing a past state
(→ delete). Module-level docs explaining a genuinely non-obvious *mechanism* — `fisheye.ts`'s
mass-conservation invariant, `paleogeography.py`'s reconstruction model — are the legitimate
exception, and they stay because they describe the design, not its history.

Exempt: `README.md`, `docs/**`, and source-provenance comments carrying real citations in
`sources/**` and `data/*.yaml` — history and citations legitimately live in those.
