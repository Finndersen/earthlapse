# Implementation Plan

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

## Phase 0 — Contracts

**~300 lines. Reviewed by Finn, not written by him.** This is the thing every downstream
agent must agree on; if parallel agents each invent it, the merge is a disaster.

Deliverables:

- `pipeline/models.py` — `WorldState` and its component models (DESIGN §4)
- `pipeline/shapes.py` — the four curated shapes (DATA_SOURCES § Contract)
- `pipeline/graph.py` — asset-graph node protocol, hashing, staleness, pinning
- `pipeline/spend.py` — the ledger and ceiling
- `web/src/types/layer.ts` — the `Layer` interface (DESIGN §10)
- `web/src/types/manifest.ts` — published manifest schema
- `sources/_template/` — the per-source skeleton

**Exit criteria:** types compile, `WorldState.at(t)` has a passing test against a stub, and
Finn has reviewed and signed off. Nothing else starts until then.

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

| Unknown | Why it matters | Cheap test |
|---|---|---|
| Does `gplately` install cleanly? | Heavy geospatial deps; **blocks the globe entirely** | one hour, first thing |
| What is in the PaleoDEM netCDF? | Projection, datum, no-data, spacing all assumed | load one file |
| Does depth displacement survive `WIDE_RIDGE`? | **Main risk in ADR-001** | one image, one depth map |
| Does the image model hold style across a handful? | Determines the whole art pipeline | 6 images, same template |

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
