# Source: lineage

The ancestor lineage behind the "your ancestor at this moment" layer. 42 nodes, `Tree` id
`"lineage"`. **Hand-curated — `data/lineage.yaml` is the source of truth, not derived
data.** See its header comment for the full time and dating conventions.

## Status: implemented, dated from primary literature (not TimeTree)

A previous attempt at this package stopped at a licence check: TimeTree's terms forbid
redistributing TimeTree data or its transformations, which rules it out as the source of
any committed date here (see "Licensing note" below, carried forward from that finding).
**The task owner reviewed that finding and decided: date every node from the primary
literature instead, with a per-node citation** — a heavier research task than a TimeTree
lookup, but one with no licence blocker. That is what this package does. TimeTree was not
consulted at any point in producing `data/lineage.yaml`, not even privately as a sanity
check — the primary-literature route made that unnecessary, and every number here traces
to a citation that can be independently checked without touching TimeTree.

## Schema

`data/lineage.yaml` is a YAML document with one top-level key, `nodes`, a list of records:

| Field | Type | Meaning |
|---|---|---|
| `id` | str | stable slug, unique |
| `parent` | str \| null | the previous node's `id` on this same path; `null` only for `luca` (the root) |
| `label` | str | clade name, as it should read in the UI |
| `representative` | str | a representative organism — a specific fossil taxon where the node is defined or evidenced by one, or a named extant proxy / "(hypothetical)" placeholder for deep nodes with no informative fossil of their own |
| `t_divergence` | float | years BP (`GeoTime`, see `pipeline/shapes.py`) when this lineage node originated — see "Dating convention" below |
| `note` | str | 1-2 sentences, including the uncertainty range and "contested" where applicable |
| `citation` | str | a specific primary paper or named peer-reviewed synthesis, with authors, year, journal and DOI (or an explicit note where no DOI was ever assigned) |

`normalise.py` parses this directly into `pipeline.shapes.TreeNode`/`Tree`, which is where
`Tree`'s invariants are actually enforced (pydantic validator + `_sorted`): every node's
`parent` must resolve to a known `id` (or be `null`), and nodes are sorted ascending by
`t_divergence`. The YAML itself carries no schema enforcement beyond being well-formed.

## This is a path, not a phylogeny

Per the work-package brief and `docs/ONESHOT_SCOPE.md § "The ancestor lineage"`, this file
is **one path** from LUCA to *Homo sapiens* — the lineage a single lucky lineage of cells
actually followed, not a tree with side branches. Every node has exactly one parent (the
previous node on the same path) and, other than `homo-sapiens` itself, exactly one child.
Sister taxa and extinct side branches (Neanderthals, other hominin species, non-avian
dinosaurs, trilobites, ...) are deliberately absent — they are not "this lineage."
`Tree.path_to("homo-sapiens")` (`pipeline/shapes.py`) walks every node in this file in
order; `tests/sources/test_lineage.py` asserts this directly.

## Dating convention

`t_divergence` is years before present, positive into the past (`GeoTime`). It is the
point at which the lineage represented by this node originated — i.e. split away from its
sister lineage. Two kinds of evidence are used, and every node's `note` says which:

- **Molecular-clock crown/stem age**, for nodes with no informative fossil record of their
  own split — most nodes from LUCA through early vertebrates, and the whole placental-
  mammal radiation (Mammalia .. Primates), where a single phylogenomic study dates many
  adjacent nodes at once (see below). Where a study reports a range (95% CI/HPD), this
  file uses the range's midpoint as the point value and quotes the full range in `note`.
- **Oldest unambiguous fossil evidence of the newly diverged lineage**, read as a "hard
  minimum" age for the split in the Benton & Donoghue (2007) sense — most nodes from
  Osteichthyes through the hominins. The true split is at least this old, very likely
  somewhat older; the fossil date is the defensible, checkable number.

Two clusters deliberately share **one** calibration framework across several consecutive
nodes, rather than mixing incompatible studies node-to-node:

- **Metazoa .. Vertebrata**: dos Reis et al. (2015), *Current Biology* — composite ranges
  across their calibration strategies.
- **Mammalia .. Primates**: dos Reis et al. (2012), *Proc. R. Soc. B* — their combined
  nuclear+mitochondrial analysis (Table 1).

Contested nodes say so explicitly in `note`, per the project's "flag rather than invent"
rule (`docs/ONESHOT_SCOPE.md`, applied to events there and to lineage nodes here). The
least well-constrained node in the file is `archaeal-host-lineage` (the Asgard archaea
split): the literature gives only a wide, disputed spread for it, and the file says so
rather than picking a falsely precise number.

## Verification method

Every citation was looked up with WebSearch/WebFetch against the live paper or a freely
accessible copy of it, not recalled from model knowledge — per the hard rule that an LLM
must not be the source of truth for dates. Several papers were fetched as PDF and parsed
directly (`pypdf`, not the summarising WebFetch tool, which repeatedly failed to extract
text from the older scanned-style PDFs involved here) to read exact figures off the
abstract/results/tables rather than trust a secondary summary — notably Betts et al.
(2018), dos Reis et al. (2012, 2015 — via institutional PMC mirrors), and Parfrey et al.
(2011). TimeTree was not used as a source, check, or cross-check for any number in this
file (see "Status" above).

## Coverage

The task's specified coverage list is followed almost exactly, at 42 nodes (the
"~40" in the brief plus 2, from splitting "Boreoeutheria / Euarchontoglires" into its two
real, nested clades): `luca`, `archaeal-host-lineage`, `leca`, `opisthokonta`, `holozoa`,
`metazoa`, `eumetazoa`, `bilateria`, `deuterostomia`, `chordata`, `olfactores`,
`vertebrata`, `gnathostomata`, `osteichthyes`, `sarcopterygii`, `tetrapodomorpha`,
`tetrapoda`, `amniota`, `synapsida`, `therapsida`, `cynodontia`, `mammaliaformes`,
`mammalia`, `theria`, `eutheria`, `placentalia`, `boreoeutheria`, `euarchontoglires`,
`primatomorpha`, `primates`, `haplorhini`, `simiiformes`, `catarrhini`, `hominoidea`,
`hominidae`, `homininae`, `hominini`, `australopithecus`, `homo`, `homo-erectus`,
`homo-heidelbergensis`, `homo-sapiens`. One deliberate simplification: the file goes
directly from `euarchontoglires` to `primatomorpha`, skipping the intermediate Euarchonta
rank (Primates + Dermoptera + Scandentia) — not in the task's coverage list, and a
reasonable omission for a single path rather than a full phylogeny (documented in that
node's `note`).

## Gotchas

- **Some "node" boundaries are not the same event as their neighbour's.** For clades
  defined by a two-way split (e.g. `chordata` → `olfactores` → `vertebrata`), the younger
  node is a genuinely later, separate divergence — not a restatement of the same split
  under a different name. Getting this backwards (as an early draft of this file initially
  did for `eutheria`, whose fossil-minimum date is *younger* than the `theria` molecular
  split it sits under) breaks the `Tree._sorted` strictly-decreasing invariant loudly at
  construction time, which is by design.
- **Fossil-minimum dates are floors, not point estimates.** Every node dated by "oldest
  fossil of the lineage" almost certainly split earlier than the number given — the
  citation is to the oldest *known* specimen, not a claim that evolution waited until then.
- **`interpolation` in `manifest.toml` is `"n/a"`.** `Tree` has no interpolation policy —
  `Tree.sample(t)` is a discrete bisect over dated nodes, not a continuously sampled
  series — but the manifest schema (shared across all four curated shapes) requires the
  field to be present.
- **YAML scientific notation.** As in `events-core`, all values here were written to parse
  cleanly with `yaml.safe_load` (e.g. `4.2e9`, not `4.2E+9`); `TreeNode.t_divergence` is a
  pydantic `float`, so a regression would fail loudly rather than silently.

## Measured volume

`data/curated/lineage.parquet`: **21,628 bytes** (21.1 KB) for 42 nodes. `data/lineage.yaml`
itself (the actual source of truth, git-tracked separately): ~24 KB.

## Storage tier chosen

**git.** Far under the 5 MB threshold for the git tier (`docs/DATA_SOURCES.md` storage
policy). `data/lineage.yaml` is committed as source (not gitignored, unlike `data/raw/`),
consistent with its "this is source, not derived data" status, matching `events-core`.

## Licensing note

*(Carried forward from the previous attempt's finding on branch `worktree-wf_23862af3-988-6`,
which stopped this package at exactly this check — reproduced here because the finding
itself is still correct and still the reason this package does not touch TimeTree, even
though the task now proceeds via primary literature instead of stopping.)*

Verified directly against the live page source of `http://timetree.org/` (fetched
2026-09-13; footer `copyright-info` block, quoted verbatim):

> Copyright © 2005 – 2026. Data and syntheses accessed from TimeTree are provided openly for
> personal research and teaching use. Requests to use these data for all other purposes must
> be sent to info@timetree.org. **Redistribution of TimeTree data and its transformations are
> not permitted.** Publications utilizing the TimeTree resource or data are encouraged to
> include a citation to TimeTree. Please write to info@timetree.org for clarifications.

Cross-checked via two independent WebFetch calls (`timetree.org/` and `timetree.org/about`)
that returned the identical wording, then confirmed byte-for-byte from the raw page HTML via
`curl` (not committed).

**Why this blocks TimeTree as a source, not just as a formality:** `data/lineage.yaml` is
committed to a public git repository and shipped as part of a fully static, publicly
deployed product. Writing TimeTree-derived `t_divergence` values into that file and
publishing it *is* "redistribution of TimeTree data and its transformations" — a new
dataset built from TimeTree's numbers, made available to anyone who clones the repo or
loads the site. The "personal research and teaching use" carve-out doesn't rescue this: it
is a separate clause from the redistribution prohibition, which is unqualified ("are not
permitted", not "are not permitted except for research/teaching"), and a redistributable
public artifact is not "personal" use under any reasonable reading.

This package's response to that finding: **date every node from the primary literature
instead**, per the task owner's decision recorded in this package's brief. TimeTree may be
consulted *privately*, off the record, purely as a sanity check that a chosen date is in
the right ballpark — but no number or citation in `data/lineage.yaml` may be *derived*
from it, and in practice none was even consulted this way (see "Status" above). Every date
here traces to a named primary paper or synthesis, cited in full with a DOI wherever one
was ever assigned to the work, so the whole file is independently checkable without
TimeTree. `data/lineage.yaml`'s own licence (`manifest.toml`) is **CC BY 4.0 for the
compilation itself**; the underlying facts (divergence dates) are not copyrightable, and
each publication's own text/figures retain that publisher's copyright — this file's notes
are original paraphrase, not copied text, consistent with the citation practice used
throughout this project (see `sources/events-core/README.md`'s "Licensing note" for the
same reasoning applied to `events-core`).

Open Tree of Life (https://opentreeoflife.org, CC0-licensed synthetic tree, topology
only — it does not itself provide divergence-time estimates) remains a viable topology
cross-check for a future revision of this file, noted by the previous attempt and not
re-derived here since the primary-literature route needed no separate topology source:
the topology used is standard, uncontested vertebrate/mammal/primate cladistics at every
node in this file.
