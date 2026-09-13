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
it: W1-W7 and W11 fan out immediately, W8/W9/W10 follow their prerequisites, W12 is a serial
integration pass. Roughly 12 agents. Use worktree isolation for packages that touch shared
directories.

Before spawning anything, run `pytest tests/test_contracts.py`. If it does not pass, stop and
tell me — the serial spine is the thing every agent depends on and the ground has moved.

The five data source packages (W1-W5) each do investigate -> implement -> validate in ONE
agent context. Do not split investigation from implementation. Three of the five already have
verified findings recorded in docs/DATA_SOURCES.md — treat those as a head start to confirm,
not as gospel to trust blindly, and note in the source's README.md anything that turns out
differently.

Non-negotiables, all of which are in CLAUDE.md but which I want stated here too:

- Never raise --max-spend. The ceiling for this build is 25 USD, enforced in
  pipeline/spend.py. Expected actual spend is about 7 USD. If a build hits the ceiling,
  stop and report; do not work around it, do not retry in a loop.
- Do not modify anything in pipeline/shapes.py, pipeline/models.py, pipeline/graph.py,
  pipeline/spend.py, or web/src/types/. Agents import these. If one genuinely blocks a
  package, stop and report it as a proposed ADR rather than editing it — a local workaround
  becomes an incompatibility with five other agents.
- Each package owns its own directory and writes nowhere else.
- Every test must run offline against a committed fixture. No test may download a large file
  or hit a live API.
- No provider name may appear outside pipeline/generators/.
- If a data source turns out to be unusable — licence, rot, volume, whatever — stop and
  report. Do not silently substitute a different dataset.

Two traps that are already known and documented in ONESHOT_SCOPE.md. Make sure the agents
working on them have read that section:
- The NOAA CO2 file's second column is RCO2, a dimensionless ratio, NOT ppm. The conversion
  is co2_ppm = RCO2 * 280. Getting this wrong is off by 280x and still looks plausible.
- The PaleoDEM Zenodo record is 414 MB across six files but only the 9.3 MB 1-degree netCDF
  is needed. Do not download the rest.

When the fan-out completes, work through the Definition of Done checklist in
ONESHOT_SCOPE.md yourself and report which lines pass and which do not. Be honest about
partial results — I would much rather have eight of fourteen boxes ticked and know which
six are missing than a claim that it is all working.

Commit as you go, one commit per work package, so I can review the history.
```

---

## Notes for Finn

**Before you launch:**

1. `pip install -e ".[dev,data]"` and confirm `pytest` passes on your machine — the contracts
   were written and tested in a Linux container, not on macOS.
2. Set whichever image provider API key you intend to use. The `Generator` protocol is
   provider-agnostic, but W6 has to pick one; if you have a preference, add a line saying so.
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
