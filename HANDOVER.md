# Handover: `integration` branch

Temporary file for the session picking this up. **Delete it before merging into `main`.**

## State

`integration` = `main` @ `181e7b8` + five feature branches (merged, verified, pushed). Nothing here
is on `main` yet; merging into `main` needs the user's approval.

| Area | What landed |
|---|---|
| Events | Nuna/Columbia, Rodinia, Gondwana-assembly periods; Vredefort, Sudbury, Manicouagan, Acraman, Popigai, Chesapeake Bay craters (170 events) |
| Globe | New `sources/lr04` (LR04 δ¹⁸O, CC-BY-3.0 via PANGAEA) → `ice_volume`, `sea_level`; soft Cenozoic ice caps (Antarctica from 33.7 Ma, northern sheets from 2.7 Ma) and glacial lowstand. `tests/test_palette.py` guards `globe/ice/shelf.ts` against `pipeline/palette.py` |
| Web perf | Retain-aware LRU for scene/portrait textures (`lib/retainedTextureCache.ts`); first paint after the manifest only, layers join as they load; prerendered CSS/SVG loading screen with real progress |
| Web UI | "All events" browser from the event card (or `/` on desktop): search, tag chips, sticky section headers, contacts-style section rail, two-way sync with the timeline (only row selection sets `t`); population readout hidden before its domain; desktop-only onboarding step pointing at shortcuts in About |
| Tooling | `make check` (`scripts/check.sh`, the single definition of "checks pass"), `make hooks` (`.githooks/pre-commit`, not yet enabled — the user runs it), `make deploy` now runs `deploy/preflight.sh` first; QA `--smoke` preset; `applyState` state-leak fixes |
| Media | `data/media/manifest.json` + two new layer JSONs republished for the above |

Verified at `bf736a1`: `make check` green (pytest 700, vitest 2000, build, shellcheck); QA smoke 12/14 —
`globe-click-on-backdrop-still-closes` and `viewport-390x844-phone-portrait` fail identically on
plain `main`.

## Next steps, in order

1. **Wait for the layout work to land on `main`.** Another agent is finishing the phone-landscape
   layout (ADR-048) in the main checkout. A trial merge against its uncommitted snapshot gave two
   conflicts, both "keep both sides":
   - `web/src/app/Experience.tsx`: main's `captionDetailScene` `<Panel>` and our `<EventBrowser>`
     are adjacent additions — keep both (mind the `)}` closing the caption panel).
   - `web/scripts/qa/shots.mjs`: both append to the end of the shot list — keep both lists.
   With both kept, typecheck and all 2002 unit tests passed.
2. **Merge updated `main` into `integration`**, resolve as above, re-run `make check` and
   `pnpm -C web qa -- --smoke --no-screenshots`.
3. **Event browser in phone landscape.** ADR-048 widens "compact" to landscape under 500px tall.
   The browser docks above the timeline, so at 844×390 it may be very short. Add an
   `event-browser` shot at 844×390; if the list is unusable, let it cover the scene area while
   keeping the slim timeline visible.
4. **ADR for the ice caps** as the next free number after ADR-048 (text below).
5. Push, then ask the user to approve merging into `main`. Delete this file in that merge.

### Proposed ADR text (ice caps)

> Rough Cenozoic ice age from LR04. A new source, `lr04`, publishes `ice_volume` and `sea_level`
> as globe-surface scalar layers, from one straight-line δ¹⁸O calibration (0 m today, −134 m at the
> 19–23 ka LGM, Lambeck et al. 2014), explicitly rough: it overstates warm-period highstands (up to
> +46 m in the Pliocene). The globe draws soft schematic caps on present-day centres, sized by ice
> volume and gated by the Antarctic (33.7 Ma) and northern (2.7 Ma) onsets, and the lowstand from
> depth read back out of the PaleoDEM palette colours. Not a reconstruction. If ICE-6G_C's licence
> is confirmed, its last 26 kyr would replace this. Rejected: publishing an elevation raster (a
> new `paleodem` output) for a rough look.

## Wave 2 (agreed with the user, not started)

Start after the above merges into `main`:

- Split `Globe()` (`web/src/globe/Globe.tsx`, ~580-line component) into named hooks
  (`useBasemapTier`, `useWebglContextRecovery`, …).
- Split `Experience()` and stop it subscribing to `t`: push `t` reads down to the leaves. Perf
  measurement found memoisation alone barely helps (83 → 81 renders/frame), because what remains is `t`-driven.
- Split `pipeline/publish.py` (~1000 lines) into a `publish/` package by concern.
- Docs: mark `docs/ONESHOT_SCOPE.md` superseded (`IMPLEMENTATION.md` still calls it "the active
  plan"); split `docs/DECISIONS.md` into `docs/decisions/ADR-NNN-*.md`, keeping `DECISIONS.md` as
  an index so references still resolve. Do this last: other sessions keep adding ADRs.

Dropped by the user: remote CI (local checks + hooks instead), spend-ceiling guard, audio
re-encode (sources are already lossy; re-encoding shifts loop points), magnetic reversal stripes,
scale-anchor presets.

## Environment gotchas

- `data/media` is Git LFS: run `git lfs pull` or scenes are pointer files and QA measures garbage.
- `sources/plates-neoproterozoic/fixture` uses gitignored `*.rot`/`*.gpml`, so
  `tests/sources/test_plates_neoproterozoic.py` fails on a fresh clone. It passes where the fixture
  exists. Everything else in `make check` should pass.
- QA needs `web/public/media -> ../../data/media` (gitignored symlink); Playwright may need the
  sandbox disabled to launch Chromium.
- Publish from the checkout you mean: an editable-installed `.venv/bin/earthtime` imports whichever
  `pipeline/` it was installed from.

## User working preferences

- Keep replies to a few lines: what changed, what's running, what needs input.
- Subagents: pass `model: 'sonnet'` explicitly; Opus only for large or judgement-heavy work. Every
  brief forbids spawning further subagents and lists the paths the agent owns.
- Lean QA: scoped `--grep` + `--no-screenshots`; screenshots only for shots someone will view; no
  full ~100-shot runs by default.
- Code comments per CLAUDE.md → Comments: no history, dates, quotes or work-item labels.
- Nothing fades on inactivity; CO₂ stays off the HUD; ask before committing, pushing or merging.
