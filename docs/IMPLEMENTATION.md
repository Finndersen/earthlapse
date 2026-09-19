# Implementation Plan

> ## ▶ The active plan is [`ONESHOT_SCOPE.md`](./ONESHOT_SCOPE.md)
>
> The first build round is a single multi-agent fan-out, not the incremental phasing below.
> **Phase 0 is already complete** — the contracts are written, tested and committed. Phase 1's
> unknowns were resolved by research agents (see `DECISIONS.md` and `DATA_SOURCES.md`), so the
> build starts directly at fan-out.
>
> This document remains the reference for *why* the work is decomposed the way it is, and for
> what happens after the MVP lands. Read it for the reasoning; read `ONESHOT_SCOPE.md` for
> what to actually build.

How this gets built, and how work is decomposed for parallel agents.

**Guiding principle:** decompose by *verification boundary*, not by feature. Every work
package must have a check the agent can run to know it is done. Packages without one are not
ready to dispatch.

---

## Why not "one agent, end to end"

The risk in this project is **integration and external reality**, not code volume. Does
`gplately` install cleanly? What is actually inside the PaleoDEM netCDF? Does the image model
hold style across 200 prompts? Does depth displacement survive a wide vista?

Agents are excellent where the spec is tight and poor where reality pushes back. A single
coordinator agent will confidently paper over all four of those and produce a large,
plausible, non-working codebase.

Hence: contracts first, one slice, then fan out.

---

## Phase 0 — Contracts ✅ COMPLETE

Committed and passing (`pytest tests/test_contracts.py`, 18 tests, offline). This is the
thing every downstream agent must agree on; if parallel agents each invent it, the merge is a
disaster — so it exists before any fan-out.

Deliverables:

- `pipeline/models.py` — `WorldState` and its component models (DESIGN §4)
- `pipeline/shapes.py` — the five curated shapes (DATA_SOURCES § Contract)
- `pipeline/graph.py` — asset-graph node protocol, hashing, staleness, pinning
- `pipeline/spend.py` — the ledger and ceiling
- `web/src/types/layer.ts` — the `Layer` interface (DESIGN §10)
- `web/src/types/manifest.ts` — published manifest schema
- `sources/_template/` — the per-source skeleton

**Exit criteria — met.** Types compile, 18 contract tests pass offline, and the behaviours
agents would otherwise diverge on are pinned: out-of-domain returns `None` rather than
extrapolating; an upstream prompt edit propagates to the image digest; a pinned asset
survives a rebuild while its dependency goes stale; the ledger refuses a call that would
breach the ceiling.

---

## Phase 1 — Vertical slice (one agent, no fan-out)

Three events in one era, end to end, deployed and clickable.

- one data source wired through `WorldState` (`co2-o2` — smallest, fastest)
- `gplately` installed and one PaleoDEM epoch loaded
- one generated scene image with a depth map, displaced and breathing in a viewport
- one cross-dissolve between two scenes
- the CO₂ sparkline
- the timeline with symlog scale and working scrub
- deployed to Cloudflare Pages

**This phase exists to surface unknowns, not to produce features.** Its real deliverables
are answers:

| Unknown | Status |
|---|---|
| Does `gplately` install cleanly? | ✅ **Resolved** — 33 s, wheels only, no conda. And moot for the MVP: gplately is out of scope, PaleoDEM rasters are already reconstructed. |
| What is in the PaleoDEM netCDF? | ✅ **Mostly resolved** — 1° product, 9.3 MB, variable `z`, 181×361 float32, EPSG:4326, CC BY 4.0. Variable name from a documentation read, not from opening the file — the implementing agent confirms. |
| Does depth displacement survive `WIDE_RIDGE`? | ⏸ **Deferred** out of v1 by ADR-009. |
| Does the image model hold style across a handful? | ⏳ **Open** — first real question the one-shot answers (W6). |

If any answer is bad, we change the design *before* spending money or parallelism. Write the
answers into `DECISIONS.md` as they land.

**Do not parallelise before this exists.** Agents fanning out ahead of it will make mutually
incompatible guesses about things nobody has discovered yet.

---

## Phase 2 — Parallel fan-out

Separate git worktrees, merged on green. Each package has its verification listed.

### Data sources — genuinely parallel-safe, run concurrently

Independent, single-shape output, individually validated against committed fixtures. One
agent each. Brief template is at the end of
[`DATA_SOURCES.md`](./DATA_SOURCES.md#agent-brief-template).

| Agent | Source | Verification |
|---|---|---|
| D1 | `paleodem` | validator against fixture; texture renders |
| D2 | `hyde` | global total matches published figures at checkpoints |
| D3 | `paleoclimate` | splice policy documented; no discontinuities at boundaries |
| D4 | `pbdb` | diversity curve matches published Sepkoski-style shape |
| D5 | `timetree` | 50-node lineage resolves; dates monotonic |
| D6 | `events-core` | every event has citation and uncertainty interval |
| D7 | `astronomy` | formulae match known values at checkpoints (day length at 600 Ma etc.) |

### Application packages

| Agent | Package | Verification |
|---|---|---|
| A1 | `pipeline/` asset graph + generators | unit tests: hashing, staleness, pinning, spend ceiling refuses |
| A2 | `web/timeline` | property tests on the warp; round-trip `t → x → t`; scrub test |
| A3 | `web/globe` | renders known epochs; compared to reference frames |
| A4 | `web/scene` | displacement + dissolve holds target framerate |
| A5 | `web/layers` | each layer samples correctly across its declared domain |
| A6 | `audio/` | stem gains match expected curves at checkpoints |

### Dependencies

```
Phase 0 ──► Phase 1 ──┬──► D1..D7  (parallel)
                      ├──► A1
                      ├──► A2, A3, A4  (parallel)
                      ├──► A5  (after A2 and D-any)
                      └──► A6  (independent)
```

---

## Phase 3 — Art direction (human, no agent)

Prompt and style iteration is a taste loop. Agents build the harness; Finn turns the dials.

- generate and approve the ~12 era anchors
- tune the invariant style spec
- run the full scene generation with review
- choose the LUT

This is where the budget gets spent and where the project either looks good or doesn't.

---

## Agent working agreement

- `docs/DESIGN.md` is the reference. `docs/DECISIONS.md` is the ADR log.
- `CLAUDE.md` stays short and points here.
- Anything marked **NORMATIVE** requires an ADR to change. Propose, don't unilaterally edit.
- **Committed fixtures, not mocks.** No test may download a large file or hit a live API.
- **No agent may raise `--max-spend`.** If a build hits the ceiling: stop and report.
- One package per worktree. Do not edit another package's files; open an issue instead.
- If a source or approach turns out to be unusable, **stop and report** rather than
  substituting something else. A silent substitution is worse than a blocked task.

---

## What agents should not be given

- **Art direction.** Taste loop. Phase 3 is human.
- **The curated event list.** An LLM drafts; a human decides what the ~200 events are.
- **Dataset substitution decisions.** If HYDE is unusable, that is a design conversation.
- **Anything touching the spend ceiling.**

---

## Backlog — data layers deferred until the foundation is settled (2026-09-13)

The human chose to note these after the first browser reviews, not to build them yet. Scene
coverage, globe motion and ancestor portraits come first.

- **Layer picker.** Day length is already off the HUD (2026-09-14: it reaches ~24 h early and
  then barely moves, and the event feed took its space); a picker could offer it as opt-in.
  Moon distance and solar luminosity move behind the same picker.
- **Global mean surface temperature.** The strongest candidate. Scotese et al. 2021 for the
  Phanerozoic, CENOGRID (Westerhold 2020) for the Cenozoic, EPICA/Vostok for the last 800 kyr.
  See DATA_SOURCES `paleoclimate`.
- **Atmospheric O₂.** Explains the giant Carboniferous insects. Source it next to `co2-o2`.
- **Marine biodiversity.** PBDB genus counts, with the Big Five extinctions as visible dips.
  See DATA_SOURCES `pbdb`.
- **Sea level.** See DATA_SOURCES `paleoclimate`.
- **Land fraction.** Already curated as `land_fraction`, but not yet published as a HUD layer.
- **Human population.** The HYDE global total, for the last 12 kyr.
- **Tree-of-life ribbon.** A phylogeny band sharing the timeline's axis. Our lineage runs as the
  spine, and sister clades branch off at their divergence times. Needs sister-clade curation
  (plus extinction ends) and a branch layout. Still under discussion.

## Backlog — onboarding (2026-09-19)

- **First-visit tour.** A short step-through on a viewer's first load, highlighting the four
  things that aren't self-evident: the play button runs the timeline through the scenes, the
  timeline scrubs, the era shortcuts jump, and the globe expands. Deliberately light — a handful
  of steps, not a walkthrough, with a skip control visible from the very first step rather than
  only at the end. Must not block the scene behind it, and must never reappear once dismissed or
  completed.

  Settled: **`localStorage` holds the "seen it" flag.** It is per-browser and unavailable in a
  private window, so a viewer can see the tour more than once — accepted, since the cost of that
  is one dismissable overlay rather than anything lost. Read it in a `try`/`catch` and treat a
  throw or a miss as "not seen"; never let a storage failure block the app from rendering.

  Also settled: **it does not touch playback.** The tour only runs on a first visit, and the app
  opens paused (`store/time.ts`'s initial `playback.playing: false`), so nothing is moving
  underneath it and there is no state to save and restore. It follows that the tour must not
  *start* playback either — a viewer who skips at step one should land on exactly the still,
  paused view they would have got without it.

  Also settled: **design it for the phone first.** Most visitors are expected to arrive on one,
  so the phone is the case to get right and the desktop is the adaptation — not the other way
  round, which is how a tour ends up pointing at controls that are somewhere else.

  That matters because three of the four things it points at genuinely move: on a phone the
  Globe/Map toggle is a top-left corner control, the era shortcuts sit under the title, and the
  zoom rocker is in the bottom band (see the 760px blocks in `ShellLayout.module.css` and
  `Globe.module.css`). Anchor each step to the target's *measured* position rather than fixed
  coordinates, and let the copy differ per breakpoint — "tap" against "click", and a phone has no
  hover affordances to describe.

  Two phone-specific constraints fall out of that. The viewport is short, so a step's callout
  cannot assume room beside its target the way it can on a desktop — it will often have to sit
  above or below. And the skip control has to meet the same touch-target floor as the rest of the
  phone transport (44px, `Timeline.module.css`'s own `--edge-button-size` at that breakpoint),
  since a tour a viewer cannot reliably dismiss is worse than no tour.
