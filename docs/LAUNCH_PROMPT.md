# Launch prompt

Paste the block below into a Claude Code session opened at the repo root. It assumes the
repo is at its current commit with the contracts already built and passing.

It deliberately does **not** restate the design — restating invites reinterpretation. It
points at the documents and names the non-negotiables.

---

```
ultracode

Build the one-shot MVP of this project. Read docs/ONESHOT_SCOPE.md first — it is the
complete specification, including the work package table, the execution graph and the
definition of done. Then read CLAUDE.md for the hard rules, and docs/DESIGN.md for the
architecture behind them.

Orchestrate this as a workflow. The scope document's work package table maps directly onto
it: W1-W5, W7 and W11 fan out immediately, W8/W9/W10 follow their prerequisites, W12 is a
serial integration pass. Roughly 12 agents. Use worktree isolation for packages that touch
shared directories.

W6a is an early gate and blocks W6 only — do not let it block the rest of the fan-out. It
generates one era anchor plus three scenes conditioned on it, on Pro (~0.52 USD), then STOPS
and reports so I can look at the four images. Do not proceed into W6's full pipeline, and do
not generate any final scenes, until I have said go. This is the cheapest risk retirement in
the plan: the entire visual approach depends on anchor conditioning holding style, and
nothing else tests it.

Before spawning anything, run `pytest tests/test_contracts.py`. If it does not pass, stop and
tell me — the serial spine is the thing every agent depends on and the ground has moved.

The five data source packages (W1-W5) each do investigate -> implement -> validate in ONE
agent context. Do not split investigation from implementation. Three of the five already have
verified findings recorded in docs/DATA_SOURCES.md — treat those as a head start to confirm,
not as gospel to trust blindly, and note in the source's README.md anything that turns out
differently.

Non-negotiables, all of which are in CLAUDE.md but which I want stated here too:

- Never raise --max-spend. The ceiling for this build is 18 USD, enforced in
  pipeline/spend.py. Expected actual spend is about 14.50 USD. The ceiling sits BELOW the
  funded balance on the billing account, so raising it does not buy more budget — it just
  swaps a clean stop for an opaque billing failure. If a build hits the ceiling, stop and
  report; do not work around it, do not retry in a loop.
- Ancestor portraits are a STRETCH, not baseline. Generate them only if the ledger shows
  headroom after the final scenes are done. The ancestor layer works as text-only in v1.
- Do not modify anything in pipeline/shapes.py, pipeline/models.py, pipeline/graph.py,
  pipeline/spend.py, or web/src/types/. Agents import these. If one genuinely blocks a
  package, stop and report it as a proposed ADR rather than editing it — a local workaround
  becomes an incompatibility with five other agents.
- Each package owns its own directory and writes nowhere else.
- Every test must run offline against a committed fixture. No test may download a large file
  or hit a live API.
- No provider name may appear outside pipeline/generators/.
- ALL image generation uses gemini-3-pro-image-preview. Do not use the free-tier
  gemini-2.5-flash-image anywhere in this build, including for drafts or the anchor gate —
  prompts tuned on one model do not transfer to the other, and the gate is invalid if it
  runs on a different model from the finals. Treat HTTP 429 as backoff-and-retry, never as
  a failure or a reason to switch models.
- If a data source turns out to be unusable — licence, rot, volume, whatever — stop and
  report. Do not silently substitute a different dataset.

Two traps that are already known and documented in ONESHOT_SCOPE.md. Make sure the agents
working on them have read that section:
- The NOAA CO2 file's second column is RCO2, a dimensionless ratio, NOT ppm. The conversion
  is co2_ppm = RCO2 * 280. Getting this wrong is off by 280x and still looks plausible.
- The PaleoDEM Zenodo record is 414 MB across six files but only the 9.3 MB 1-degree netCDF
  is needed. Do not download the rest.

The MVP runs locally only — `pnpm dev`. Do not set up Cloudflare, R2, wrangler or any
deployment. `earthlapse publish` writes a manifest and media directory on disk, nothing more.

When the fan-out completes, work through the Definition of Done checklist in
ONESHOT_SCOPE.md yourself and report which lines pass and which do not. Be honest about
partial results — I would much rather have eight of fourteen boxes ticked and know which
six are missing than a claim that it is all working.

Commit as you go, one commit per work package, so I can review the history.
```

---

## Notes for Finn

**Before you launch — run this preflight:**

```sh
python3 --version          # must be 3.12+ (code needs 3.11+ for StrEnum / typing.Self)
node --version             # 20+
pnpm --version || corepack enable   # or: npm i -g pnpm
pip install -e ".[dev,data]"
pytest tests/test_contracts.py      # must be 18 passed
grep -q GOOGLE_API_KEY .env && echo "key present"
```

If `python3` is older than 3.11 the install will fail on `requires-python`. Either install a
newer Python or say so and the contracts can be back-ported — it is a small change to two
files.

1. Confirm `pytest` passes **on the Mac** — the contracts were written and tested in a Linux
   container, not on macOS.
2. Put `GOOGLE_API_KEY=...` in `.env` — get it at aistudio.google.com -> Get API key ->
   Create API key. No credit card for the free tier, but **enable billing on the linked Cloud
   project** or Nano Banana Pro finals will fail with a quota error. The model choice is
   already made in `VISUAL_SPEC.md` §8 — `gemini-2.5-flash-image` for drafts (free tier),
   `gemini-3-pro-image-preview` for finals — so W6 has nothing to decide.
3. Confirm you can reach `zenodo.org` and `ncei.noaa.gov`. My container could not, which is
   why W1's and W2's downloads are unverified against real bytes.

**What I would expect to go wrong,** so you know what a normal failure looks like rather than
a broken build:

- **W4 `events-core` is the least deterministic package.** Curating 30 events with defensible
  dates and citations is judgement work. Expect to want to edit `data/events.yaml` by hand
  afterwards. That's fine and expected — it's source data, not derived.
- **W2's netCDF parsing** rests on a variable name and dimension order I have from a
  documentation read, not from opening the file. If the agent finds something different,
  it should trust the file.
- **W6 prompt templates** are where quality lives and where a one-shot is weakest. Expect the
  first images to be mediocre. That's Phase 3 work (human taste loop), not a build failure.
- **W8/W9 timing.** If W2 is slow, W8 stalls. Not a problem, just slower than the graph
  suggests.

**Fast-follows once this lands,** roughly in value order: layered ambience audio (cheapest
impact in the whole project), ancestor portraits, the 2.5D parallax upgrade, then HYDE for
the population layer and spreading-civilisation globe overlay.
