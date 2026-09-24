# Source: events-core

The curated event set behind the scrubbable timeline. 196 events, `EventSet` id
`"events-core"`. **Hand-curated — `data/events.yaml` is the source of truth, not derived
data.** See its header comment for the full time convention.

## Schema

`data/events.yaml` is a YAML document with one top-level key, `events`, a list of records:

| Field | Type | Meaning |
|---|---|---|
| `id` | str | stable slug, unique |
| `label` | str | short display name |
| `kind` | `moment` \| `period` | ADR-022: `moment` is one happening, dated by `t` plus its `[t_min, t_max]` dating uncertainty; `period` genuinely lasted, and `t_min`/`t_max` are its own end/start |
| `t_min` | float | years BP, **nearer the present** |
| `t_max` | float | years BP, **further into the past** |
| `t` | float, required iff `kind: moment` | best-estimate instant, must fall inside `[t_min, t_max]`; **absent** for a `period` |
| `tags` | list of str, non-empty | ADR-022: closed set of six — `life`, `earth-climate`, `catastrophe`, `human-origins`, `society`, `science-technology` — ordered, first is primary and drives timeline colour |
| `importance` | float, 0..1 | drives zoom LOD (planetary milestones ~0.9-1, minor ~0.3-0.5) |
| `description` | str | 1-2 sentences; says "contested" explicitly where the date is disputed |
| `citation` | str | a specific, checkable source — author/year/venue, or the ICS chart with its boundary age |

`normalise.py` parses this directly into `pipeline.shapes.Event`/`EventSet`, which is where
`t_min <= t_max`, `0 <= importance <= 1`, the `kind`/`t` consistency rule and `tags`'
non-empty/closed-set/no-duplicates rules are actually enforced (pydantic validators) — the YAML
itself carries no schema enforcement beyond being well-formed.

**Migration status (ADR-022).** `kind` and `tags` are required fields with no default: they were
added to the `Event` contract without being back-filled into the 66 events below, because
assigning each event a kind, a best-estimate date and a primary theme is a curation judgement
call for a human/agent to make per event, not something this contract change can do mechanically.
Until that follow-up pass fills them in and reruns `make data`, `data/events.yaml` fails to load
(loudly — a pydantic `ValidationError` naming the first event missing the field) and
`sources/events-core`'s real-data test suite (`tests/sources/test_events.py`) fails at its
module-scoped fixture accordingly. This is expected, not a regression. The small committed
`fixture/events.yaml` below (never read by `normalise.py` in production) is already in the new
shape, so the schema itself stays exercised offline in the meantime.

## The present-day reference year

Deep-time dates (radiometric, biostratigraphic) are already expressed as years-before-present
and need no conversion. Historical dates (agriculture onward) are calendar dates, and had to
be converted to the same `GeoTime` axis (`t`, years BP, present = 0). Per the work-package
brief for this source, that conversion uses a **fixed** reference year rather than the actual
run date:

```
t = 2025 - CE_year          (a BCE year is negative: 3400 BCE -> CE_year = -3400)
```

This is deliberate: if `t` were computed against the pipeline's run date, `data/events.yaml`
(and the derived parquet) would silently drift by one unit of `t` every time the pipeline is
rebuilt on a later real-world date, even though nothing about the underlying scholarship
changed. Pinning the reference year makes the file's numbers stable and reviewable. It also
means the `industrial-revolution`, `writing`, `agriculture`, `moon-landing` and `present`
events are *not* exactly "years before today" once enough real time has passed — the drift is
small (single-digit years) relative to every interval in this file, so it doesn't matter for
the timeline's purpose, but it is worth knowing it exists.

## Verification method

Every date was checked against its cited source with WebSearch, not asserted from model
knowledge (per the hard rule: an LLM must not be the source of truth for dates). Stratigraphic
boundaries (Cambrian base, Ediacaran top, Cryogenian bounds, Permian-Triassic boundary,
K-Pg boundary) are checked against the **ICS International Chronostratigraphic Chart v2024/12**
(`stratigraphy.org/ICSchart/ChronostratChart2024-12.pdf`), fetched by `fetch.py` and hashed in
`manifest.toml`. First-appearance dates for clades use the primary literature that established
them (with DOI/journal where available) rather than PBDB directly — PBDB's occurrence API
returns raw specimen records, not a curated "first appearance" figure, so for a ~30-event
set the primary paper for each landmark specimen is the more precise and more easily
spot-checked citation. This is noted here as a deliberate deviation from "PBDB or primary
literature" in favour of the primary-literature half of that instruction.

The 16 events added under ADR-014 were verified the same way in spirit — against a citable
primary source, never from model memory — but by a different mechanism: live web search was
unavailable for that work (its session-wide budget had already been spent by other concurrent
work before this file was touched), so each date and citation was instead verified by fetching
the actual source page (an encyclopaedia summary in most cases) and cross-checking the primary
citation it names, rather than by search. Two citations in that batch carry narrower
verification than the rest, flagged as such in their own comment in `data/events.yaml`:
`first-seed-plants`' full bibliographic detail (journal, volume, pages) for Rothwell et al.
1989 was reconstructed from training knowledge and only partially confirmed live (the author
and year were); `gymnosperm-radiation`'s Looy & Duijnstee (2020) citation likewise lacks a
live-confirmed journal and volume.

Both batches were then put through a scientific review (ADR-014), also by fetching source pages
because WebSearch was exhausted. Its corrections are applied in `data/events.yaml`. Any
bibliographic line that could not be confirmed against its DOI page carries an inline
**UNVERIFIED** marker rather than being shipped as if checked: `first-seed-plants`,
`late-devonian-extinction` (Becker & House year, Percival 2018), `gymnosperm-radiation` (no
primary source yet, importance lowered to 0.35), `angiosperm-radiation` (Benton, Wilf & Sauquet
year) and `younger-dryas` (Rasmussen 2006 volume and pages).

**Contested dates** get a wide `t_min`/`t_max` interval and the word "contested" (or an
explanation of the disagreement) in the description, rather than a single invented number.
Contested in this file: `moon-forming-impact` (4.35 vs 4.51-4.52 Ga), `first-life` (3.4 vs
4.1 Ga), `origin-of-photosynthesis` (must predate the ~2.43 Ga Great Oxidation Event; disputed ~3.4 Ga biomarker claims),
`eukaryotes-origin` (1.6 vs 2.1 Ga), `insects` (possible myriapod misidentification),
`amniotes` (318-307 Ma uncontroversial vs a 2025 claim pushing crown Amniota to ~358.9-354 Ma),
`dinosaurs` (231 vs 243 Ma), `flowering-plants` (undisputed ~130 Ma vs a disputed Triassic
pollen claim), `earliest-pollinating-insects` (Melittosphex burmensis, originally described as
the oldest bee, now reassessed as an aculeate wasp of uncertain position), `primates` (stem vs
crown), `hominins` (contested classification), `control-of-fire` (sporadic vs habitual use
span over 1 Myr), and `k-pg-aftermath` (the fern spike's own duration is not precisely
bounded, so the scene's interval is kept deliberately narrow and conservative). Also contested, among the 19
events added for the Cenozoic scene work package: `india-asia-collision` (59-34 Ma, one of
the most debated timing questions in Earth science), `antarctic-circumpolar-current` (34-21 Ma
for the gateway and proto-current; the modern current late Miocene per Evangelinos et al. 2024),
`isthmus-of-panama` (~2.8 Ma final closure vs stepwise emergence and a middle-Miocene closure
of the deep seaway, 16 Ma),
`messinian-salinity-crisis` (well-dated onset and end, but how dry the basin got and how
catastrophic the refill was remain disputed), and `toba-eruption` (well-dated eruption, but
its "volcanic winter" severity and effect on contemporary humans is heavily contested and
increasingly doubted). Also contested: `carboniferous-rainforest-collapse` (scale and
ecological effects; rainforest persisted in Cathaysia), `lomekwi-stone-tools` (sceptics
question the Pliocene age), `earliest-cave-art` (the disputed >65 ka Iberian Neanderthal-art
claim) and `acheulean-technology` (1.95 Ma at Melka Kunture vs 1.76 Ma at Kokiselei).

## Event selection and density

The 21 minimum-coverage topics from the work-package brief are all present, each as its own
event with a matching id (`earth-formation`, `moon-forming-impact`, `first-life`,
`great-oxidation-event`, `snowball-earth`, `ediacaran-biota`, `cambrian-explosion`,
`land-plants`, `insects`, `tetrapods`, `amniotes`, `permian-extinction`, `dinosaurs`,
`flowering-plants`, `k-pg-impact`, `primates`, `hominins`, `agriculture`, `writing`,
`industrial-revolution`, `present`). Nine more filled out the original set to 30 and produce
the deliberately uneven, present-clustered density the brief asked for:
`eukaryotes-origin`, `multicellularity-sexual-reproduction`, `mammals-origin`, `birds-origin`
(deep-time, filling the life-to-dinosaurs gap), and `homo-sapiens-origin`,
`out-of-africa-migration`, `control-of-fire`, `last-glacial-maximum`, `moon-landing` (all
within the last ~1.5 Myr, where density is highest). `last-glacial-maximum` was added after
the first browser review so the ice-age scene (t = 20 ka) has a matching event.

A further 16 events were added under ADR-014, ahead of a richer set of deep-time scene specs
(older than 66 Ma, now in `data/scenes.yaml`) so each new scene has a matching event to
anchor to: `origin-of-photosynthesis`, `banded-iron-formations`, `first-seaweeds`,
`great-ordovician-biodiversification`, `end-ordovician-extinction`, `first-forests`,
`first-seed-plants`, `late-devonian-extinction`, `carboniferous-rainforest-collapse`,
`gymnosperm-radiation`, `siberian-traps`, `end-triassic-extinction`,
`earliest-pollinating-insects`, `angiosperm-radiation`, `deccan-traps`, `k-pg-aftermath`.
Three topics from that same work-package brief were deliberately *not* added as new events,
because an existing event already covers the same ground with a citation that already
supports the claim: "first eukaryotic algae" (`eukaryotes-origin`'s own citation, Bengtson et
al. 2017, already describes 1.6 Ga crown-group red algae), "first vascular plants"
(`land-plants`'s upper bound is already Cooksonia, ~425 Ma), and "first flowers"
(`flowering-plants`, already present).

A further 19 events were added by the "get the foundation right" Cenozoic scene work package
(human-directed 2026-09-13, ADR-014), bringing the total to 65 and filling what had been the
single largest gap in the set: 56 Ma (`primates`) to 6 Ma (`hominins`) held only two events
across 50 Myr, and 6 Ma to 400 ka (`control-of-fire`) held none at all. All 19 sit strictly
inside that same 66 Ma-present range this source already covers, in time order:
`paleocene-mammal-radiation`, `petm`, `india-asia-collision`, `eocene-oligocene-transition`,
`antarctic-circumpolar-current`, `grassland-spread`, `hipparion-dispersal`, `c4-expansion`,
`isthmus-of-panama`, `messinian-salinity-crisis`, `lomekwi-stone-tools`,
`australopithecus-afarensis`, `quaternary-glaciation-begins`, `homo-erectus`,
`acheulean-technology`, `toba-eruption`, `earliest-cave-art`, `neanderthal-sapiens-overlap`,
`younger-dryas`. Ten of these back a matching new scene in `data/scenes.yaml`; the other nine (`india-asia-collision`,
`antarctic-circumpolar-current`, `hipparion-dispersal`, `isthmus-of-panama`,
`lomekwi-stone-tools`, `quaternary-glaciation-begins`, `toba-eruption`, `earliest-cave-art`,
`younger-dryas`) stand alone, either because no single vantage suits them (a plate-tectonic
process, an ocean current) or because this work package judged a dedicated scene redundant
with a neighbouring one (see the work-package report for the reasoning per event). One
citation in this batch is weaker than the rest and is flagged inline in
`paleocene-mammal-radiation`'s own citation field: its Pantolambda detail rests on a
paraphrased Wikipedia summary rather than primary literature, the one point in this batch
where the session's WebSearch budget ran out before a stronger source could be found. Six
topics named in that work package's brief — domestication of dogs, first cities, the Bronze
Age, the start of the Holocene, a broad "megafauna extinctions" event distinct from
`younger-dryas`, and the printing press — were **not** added: the session's WebSearch budget (a session-wide cap
shared across concurrent agents) was exhausted before they could be verified, and per this
project's "verify, don't assert from memory" rule they were left out rather than guessed.
They remain open follow-up work, not a judgement that they don't belong.

The scientific review added one more, `early-eocene-climatic-optimum`, so the
`arctic-hothouse-forest` scene (52 Ma) has a matching event. The set totals 66 events.

A **digital-age batch** (2026-09-14) added 11 technology milestones, in time order:
`integrated-circuit-invented`, `arpanet-first-message`, `first-microprocessor`,
`first-handheld-mobile-call`, `mass-market-personal-computers`, `internet-tcp-ip-switchover`,
`ibm-simon-first-smartphone`, `gps-fully-operational`, `iphone-launch`,
`half-of-humanity-online`, `chatgpt-release`. Each was checked by fetching the page named in
its citation (mostly Wikipedia; ITU's own press release for `half-of-humanity-online`).
Importance follows the existing near-present scale: the Internet's TCP/IP switchover and
the iPhone sit at 0.65, alongside `wright-flyer-first-flight`, just under `moon-landing`.
Curation choices:
- **Personal computers** are dated to 1977 (the Apple II / PET / TRS-80 "Trinity", the first
  mass-market PCs) rather than the IBM PC of 1981. The IBM PC is named in the description as
  the standard-setter.
- **"First smartphone"** is two events: the IBM Simon (1994), the literal first, and the
  iPhone (2007), the one that took smartphones to the mass market.
- **GPS** is dated to 1995 only: Wikipedia gives April 1995 and the 17 July 1995 date could
  not be confirmed. It is marked UNVERIFIED inline.

Deliberately not added:
- AlphaGo vs Lee Sedol (2016): a research demonstration. ChatGPT is the single AI milestone,
  chosen because it reached a mass public.
- Social media reaching billions: the only dated milestones are single-company user counts.
  `half-of-humanity-online` covers the reach of the Internet instead.

A **human-history gap-filling batch** (2026-09-15) added 6 events, each backing a new
`data/scenes.yaml` scene, to close the largest remaining silent stretches in the historical
half of the timeline: `roman-empire-peak`, `angkor-wat-built`, `ford-model-t-assembly-line`,
`battle-of-the-somme`, `d-day-normandy-landings`, `berlin-wall-falls`. Each was checked by
fetching the page named in its citation (Wikipedia throughout). Two new scenes link to
existing events instead of adding new ones: `black-death-messina-1347` (the existing
`black-death`) and `normandy-landings-dday`'s neighbour `somme-1916` needed no separate event
beyond `battle-of-the-somme` above. Curation choices:
- **`roman-empire-peak`** and **`angkor-wat-built`** are both `kind: period` rather than a
  single dated moment: "the empire at its height" and "a temple built over decades" are
  genuinely-lasted spans, not one happening with a dating error bar (ADR-022).
- **`battle-of-the-somme`**, **`d-day-normandy-landings`** and **`berlin-wall-falls`** carry
  war and mass-casualty content. Descriptions state casualty figures once, soberly, without
  embellishment, matching this project's documentary, non-sensational register for these
  topics; the linked scenes carry the same restraint in their `subject.absent` lists (no
  bodies, wounds, gore, or prominent flags/insignia).
- **Gutenberg's printing press vs. the Black Death**, and **Imperial Rome vs. classical
  Athens**, and **Angkor Wat vs. another non-European medieval capital** were three-way
  editorial choices made at the scene level, not here — see `data/scenes.yaml`'s comments on
  `black-death-messina-1347`, `imperial-rome-pantheon` and `angkor-wat` for the reasoning. No
  event for Gutenberg, Athens, or an alternative medieval capital was added, since the chosen
  alternative already had (Black Death) or now has (Rome, Angkor Wat) a citable event.

A **review-fix pass** (2026-09-15, later the same day) corrected several factual and
compositional errors a review found in that batch, and added 2 more events:
- **`battle-of-the-somme`** originally used `t_min == t_max == 109`: the battle (1 July-18
  November 1916) genuinely lasted months, but both ends fell inside the same calendar year at
  this file's usual whole-year historical resolution (see "The present-day reference year"
  above), collapsing a `kind: period` event's interval to a point — exactly what ADR-022 says a
  period must not do (a period is read by its span, not a single instant). Fixed by computing
  `t_min`/`t_max` from the actual day of year (`t_min: 108.12`, `t_max: 108.50`) rather than the
  file's usual whole-year shorthand; GeoTime is a float and nothing else about the schema
  changed, so this is a data-precision fix, not a shape change.
- **`d-day-normandy-landings`**'s description credited "156,000 troops ashore on the first day
  alone" to the beach landings; Wikipedia's own figure is the whole day's combined sea-and-air
  total, 24,000 of the 156,000 being airborne troops who dropped inland overnight rather than
  coming ashore by landing craft. The description and `normandy-landings-dday`'s caption now
  state the ~132,000 seaborne and 24,000 airborne figures separately.
- **`world-war-i`** and **`world-war-ii`** (both `kind: period`, tags `[catastrophe, society]`)
  were added: the original batch dated the Somme and D-Day as standalone battles but named no
  event for either World War itself, so the wars they belong to had no entry in the event feed.
  Both are linked from `somme-1916` and `normandy-landings-dday` respectively, alongside each
  scene's own battle event. Their `t_min`/`t_max` use the same day-counted precision as the
  `battle-of-the-somme` fix above (start/end dates from Wikipedia's "World War I"/"World War II").
- **`black-death-messina-1347`** (`data/scenes.yaml`, renamed from `black-death-quarantine`,
  unpinned so free to rename) no longer depicts a maritime quarantine: formal quarantine (a
  30-day isolation) is a Ragusan practice first adopted in 1377, three decades after this
  scene's October 1347 setting, so showing warning cloth, a shuttered town or an unmanned
  "ghost ship" both invented a practice that did not yet exist and leaned on a myth (the ships
  were crewed, not derelict — Wikipedia's "Black Death" describes twelve Genoese galleys
  arriving, not one). It now shows several moored galleys and a few distant, motionless
  sailors, with the port going about an ordinary day.
- **`imperial-rome-pantheon`** and **`angkor-wat`** (`data/scenes.yaml`) both overstated what
  their vantage could actually see: the Pantheon's north-facing portico and inscribed frieze
  are invisible from a Tiber wharf some 600 m away (only the bronze-tiled dome's upper curve
  would show), and Angkor Wat's 4.5 m outer wall would hide its inner galleries from someone
  standing at the moat. Both `far_bank` fields now describe only what the geometry actually
  permits.

A **lifestyle-and-society batch** (2026-09-15) added 3 events, each backing a new
`data/scenes.yaml` scene chosen to fill out the human-era sequence as an arc of how people
live, work, move and gather, from hunter-gatherer bands to the present: `dutch-golden-age-voc`
(backing `amsterdam-voc-harbour`, an early-modern merchant city bridging the agrarian/medieval
world and the Industrial Revolution), `ginza-modern-urban-culture` (backing
`ginza-modern-tokyo`, the first mass urban lifestyle of department stores, subways and radio,
filling the 1916-1944 gap between `battle-of-the-somme` and `d-day-normandy-landings`), and
`urban-majority-milestone` (backing `global-city-rush-hour`, present-day desk-job and commuter
life). Each was checked by fetching the page named in its citation (Wikipedia throughout,
accessed 2026-09-15). `dutch-golden-age-voc` and `ginza-modern-urban-culture` are `kind: period`
— a lasting phase of a city's life, not one dated happening (ADR-022) — bounded by the hardest
verified dates within each (VOC's 1602 founding and 1669 employee count; Ginza's 1924 department-
store, 1925 radio and 1927-1934 subway dates). `urban-majority-milestone` is deliberately
distinct from the existing `half-of-humanity-online` (Internet access, 2018): both are
`society`-tagged threshold-crossing moments, but this one is about urbanisation itself, sourced
to the same UN-cited 2007 figure Wikipedia's "Urbanization" article gives.

A **later-migrations batch** (2026-09-17) made `ArrivalEffect.arrival_kind` (`pipeline/shapes.py`)
a required, closed-enum field distinguishing `peopling` (first human settlement of a previously
uninhabited region, leaving a persistent inhabited marker on the globe) from `migration` (a later
movement into land already inhabited or previously settled, transient arc only) -- see ADR-032.
All thirteen pre-existing arrivals were set to `peopling`. Ten new events, plus the pre-existing
`columbian-exchange`, were curated as `migration`, in time order: `neolithic-farmers-europe`,
`yamnaya-steppe-migration`, `austronesian-expansion-taiwan`, `bantu-expansion`,
`norse-north-atlantic-settlement`, `thule-arctic-expansion`, `columbian-exchange`,
`transatlantic-slave-trade`, `russian-conquest-of-siberia`, `british-colonisation-australia`,
`mass-european-emigration`. Each was checked by fetching the page named in its citation
(Wikipedia throughout, accessed 2026-09-17) plus, where genetic or archaeological ancient-DNA
literature exists, the primary paper itself (DOIs verified live against Crossref): Pinhasi et
al. 2005 and Haak et al. 2010 and Mathieson et al. 2018 (Anatolian farmers), Haak et al. 2015
and Allentoft et al. 2015 (Yamnaya), Gray et al. 2009 (Austronesian), Fortes-Lima et al. 2023
(Bantu), Raghavan et al. 2014 (Thule). Curation choices and open judgement calls:
- **Norse settlement of Iceland was originally curated as `migration`, not `peopling`, even
  though Iceland itself was genuinely uninhabited before Norse arrival** (unlike every other
  `migration` in this batch, which moved into already-inhabited land), on the judgement call
  that the thirteen pre-existing arrivals were a closed narrative of humanity's original
  prehistoric dispersal, already concluded at `aotearoa-arrival` (~1280 CE), and that a Viking
  Age seafaring colonisation was a different kind of event thematically. This was flagged for
  review at the time as not a mechanical application of the `arrival_kind` contract's own
  wording ("first human settlement of a previously uninhabited region" would, read literally,
  make Iceland `peopling`) — and the same-day fact-check pass below overturned it: see
  "later-migrations fact-check pass" for the correction and the Iceland/Greenland split.
- **`british-colonisation-australia` and `columbian-exchange`'s new `arrival_kind: migration`
  effect** both state plainly, per this batch's brief, the disease and violence existing
  populations suffered (the April 1789 Sydney-region smallpox epidemic; "catastrophic population
  loss among Indigenous Americans" already in `columbian-exchange`'s own description).
  **`transatlantic-slave-trade`** states plainly that European traders and colonial powers
  forced millions of captive Africans across the Atlantic.
- **`columbian-exchange`'s `established` (1496, Santo Domingo's founding)** is deliberately not
  1492 (Columbus's landfall, already this event's own `t_max`) -- the arc is meant to mark when
  European presence became permanent, not the first sighting of land.
- Five of the ten new events (`neolithic-farmers-europe`, `yamnaya-steppe-migration`,
  `austronesian-expansion-taiwan`, `bantu-expansion`, `thule-arctic-expansion`) are tagged
  `[human-origins, society]` rather than `[society]` alone: each is evidenced by ancient-DNA or
  comparable population-genetic data, the same character as the pre-existing
  `human-origins`-tagged arrivals, not merely a cultural or political development. The
  remaining five (`norse-north-atlantic-settlement`, `transatlantic-slave-trade`,
  `russian-conquest-of-siberia`, `british-colonisation-australia`, `mass-european-emigration`)
  are `[society]` only, as is the pre-existing `columbian-exchange`.

A **later-migrations fact-check pass** (2026-09-17, later the same day, ADR-032 amendment)
independently verified every one of the eleven events above against primary literature
(WebFetch against journal/publisher pages and Crossref/EuropePMC metadata; the session's
WebSearch budget was already exhausted). Six needed no change (`neolithic-farmers-europe`,
`yamnaya-steppe-migration`, `bantu-expansion`, `russian-conquest-of-siberia`,
`british-colonisation-australia`) or only a citation upgrade with no factual correction. Five
needed a real fix:
- **`austronesian-expansion-taiwan`** was reclassified `migration` -> `peopling`: the primary
  excavation report (Bellwood & Dizon 2013, ch. 5, fifty-one radiocarbon dates across seven
  sites) finds no preceramic occupation anywhere in the Batanes Islands before this arrival, so
  the destination — not the Taiwan origin — was genuinely uninhabited, matching this file's own
  `lapita-oceania-expansion` precedent (classification keys on the destination). Its origin
  coordinate also moved off an inland Taiwanese mountain range onto the Hengchun
  Peninsula/Eluanbi, the shortest and most-cited embarkation point toward the Batanes, and its
  `established` date moved from 2200 BC to 2000 BC to match the excavators' own stated
  precision limit ("further precision at the moment would be unwarranted"). Citation replaced
  with the primary excavation monograph (DOI-bearing, fetched and read directly) in place of an
  unread secondary paraphrase.
- **`norse-north-atlantic-settlement` was split into two events**, both `peopling`: the single
  arc had conflated Iceland (~AD 877) and Greenland (~AD 985) — 111 years and a different
  landmass apart — under one id, with every numeric field encoding Iceland's chronology while
  `effect.destination` pointed at Greenland. `norse-north-atlantic-settlement` keeps its id
  (avoiding an orphaned pin) and is repurposed as Iceland-only: `established` moves from the
  saga-traditional AD 874 to the tephra-dated AD 877 ± 1 (Schmid et al. 2017), its destination
  moves to Iceland, and `arrival_kind` becomes `peopling` (Iceland was genuinely uninhabited;
  the only counter-claim, Irish papar hermits, is archaeologically unproven). Its description
  now also names the enslaved and free Gaelic component of Iceland's founding population
  (Ebenesersdóttir et al. 2018: ~56% Norse ancestry, majority-Gaelic maternal line), previously
  omitted. A new event, **`greenland-norse-settlement`** (`kind: period`, `established` AD 985),
  covers the Greenland leg on its own correct dates: also `peopling`, since the Eastern/Western
  Settlement area had no established population at Norse contact (Dorset presence was
  concentrated further north; Thule contact came only in the 13th-14th century, per
  `thule-arctic-expansion`).
- **`thule-arctic-expansion`**'s window start moved from ~975 CE to ~1200 CE: the ~1000 CE
  figure it inherited from Wikipedia describes Thule culture's own origin in coastal Alaska, not
  the start of its eastward migration. The dedicated radiocarbon study of that migration
  (Friesen & Arnold 2008) finds the western Canadian Arctic transit corridor "was not occupied
  before the thirteenth century A.D.," added as a citation. `established` (~1275 CE) needed no
  change.
- **`columbian-exchange`**'s description attributed Taíno population collapse solely to
  "introduced disease," a euphemism by omission: mainstream scholarship (Stannard 1992,
  Reséndez 2016, both added as citations) treats the encomienda forced-labour system and direct
  violence as major, non-secondary co-drivers. The description now names them and the ~80-90%
  population collapse they drove within three decades.
- **`transatlantic-slave-trade`**'s `t_max`/`established` were each borrowed from unrelated
  facts: the 1525 "first direct transatlantic voyage" was São Tomé-to-Hispaniola, Caribbean-
  bound and unconnected to this event's Angola-origin/Brazil-destination arc, and 1549 marks
  Tomé de Sousa's arrival as Brazil's first royal governor — general crown administration, not
  anything specific to the Angola-Brazil slave axis. Moved to Portugal's 1575 colonisation of
  Angola (`t_max`) and the 1648 Portuguese-Brazilian recapture of Luanda from the Dutch
  (`established`), which the literature treats as the point the axis became indispensable (the
  contemporary maxim "Sem Angola, não há Brasil," 1646). Citations added: Heywood & Thornton
  (2007) and Alencastro (2018), both independently confirmed this session (Crossref/publisher
  pages) rather than taken from the review's own uncertain recollection of them.
- **`mass-european-emigration`**'s literal origin (Naples) was inconsistent with its own
  `established` date (1850): Italian mass emigration through Naples did not begin until roughly
  1880 (Naples was not a legally designated Italian emigration port until 1903), while 1850 is
  the aggregate era's onset, dominated by Irish/German/British flows per the event's own
  description. Origin moved to Cobh (Queenstown), Ireland, the single largest emigration port
  of that era; description reworded so "65 million... for the Americas" (the four listed
  destinations sum to only ~48 million) reads "the majority of them for the Americas."

No event was dropped. The `arrival_kind` reclassifications (`austronesian-expansion-taiwan`,
and the Iceland/Greenland split) change globe rendering — a persistent "inhabited" marker
appears where none did before — so they are recorded as an ADR-032 amendment in
`docs/DECISIONS.md`, not merged as a silent data edit (`CLAUDE.md`'s rule for NORMATIVE
contract fields).

A **deep-time tectonics batch** (2026-09-22) added 9 events covering the supercontinent
cycle and a hand-picked set of major impact craters, bringing the total to 170:
`nuna-columbia-supercontinent`, `rodinia-supercontinent` and
`gondwana-supercontinent-assembly` (each `kind: period`, tag `[earth-climate]`, matching
`pangaea-supercontinent`'s existing pattern of one event spanning assembly through
breakup/completion — Pangaea's own breakup was already covered and needed no new event);
`vredefort-impact-crater`, `sudbury-impact-crater`, `popigai-impact-crater`,
`chesapeake-bay-impact-crater`, `manicouagan-impact-crater` and `acraman-impact-crater`
(each `kind: moment`, tag `[catastrophe]` or `[catastrophe, earth-climate]` where a
climate link is at least proposed in the literature). Every date was checked with WebSearch
and WebFetch against the primary dating paper named in each citation, not asserted from
model knowledge. Curation choices:
- **No `GlobeEffect`/anchor was added to any crater.** `GlobeEffectKind`
  (`pipeline/shapes.py`) is a closed, NORMATIVE set with exactly one impact-shaped point
  kind already spoken for by `k-pg-impact` (`impact-winter`, a global-climate visual) and
  one by `moon-forming-impact` (`giant-impact`, a formation-scale flash). Neither fits six
  Earth-surface craters with no comparable global effect; reusing either kind would imply a
  visual the literature doesn't support. Adding a generic "crater" `GlobeEffectKind` is a
  contract change and needs its own ADR, not a data-file edit.
- **Popigai and Chesapeake Bay** form within ~25,000 years of each other at ~36 Ma and are
  the two largest Cenozoic craters; both are tagged `earth-climate` alongside `catastrophe`
  because a link to the Eocene-Oligocene cooling step has genuinely been proposed in the
  literature — but each description also carries Wade & Cheng (2024)'s finding of no
  detectable paleoclimatic anomaly, so the tag isn't read as an endorsed causal claim.
- **Manicouagan** (214 Ma) is dated too far from the end-Triassic extinction (201 Ma) to
  have triggered it — the hypothesis that motivated its original dating study (Hodych &
  Dunning 1992) is stated and then corrected in the same event's description, rather than
  only citing the paper that proposed it.
- **Acraman**'s age is dated from the stratigraphic position of its ejecta horizon in the
  Bunyeroo Formation, not from the eroded crater itself — noted explicitly, matching this
  file's convention (see `ediacaran-biota`, `snowball-earth`) of flagging when an interval
  reflects something other than ordinary dating-error uncertainty.
- Not added: a broader Precambrian crater sweep (Sudbury and Vredefort are the two hand-
  picked Precambrian entries; a general-purpose crater database is explicitly out of scope
  per the work-package brief) and a Rodinia/Gondwana breakup event distinct from Pangaea's
  (Gondwana's later breakup is the southern half of Pangaea's own breakup, already covered
  by `pangaea-supercontinent`).

A **gap-filling batch** (2026-09-24) added 26 events, bringing the total to 196, for silent
stretches found by measuring the gaps between scenes on the timeline's warped scale and by
counting scenes per era section. Deep time: `huronian-glaciation`, `ichthyosaurs-origin`,
`pterosaurs-origin`, `mosasaurs`. Cenozoic and Quaternary: `messel-pit`,
`whales-return-to-sea`, `paraceratherium`, `middle-miocene-climatic-optimum`,
`mid-pleistocene-transition`, `late-quaternary-megafauna-extinction`, `4-2-kiloyear-event`,
`late-bronze-age-collapse`. Early modern onward: `little-ice-age`, `edo-million-city`,
`lisbon-earthquake-1755`, `canton-system`, `american-revolution`, `laki-eruption`,
`french-revolution`, `haitian-revolution`, `jenner-smallpox-vaccine`, `tambora-eruption`,
`first-transcontinental-railroad`, `krakatoa-eruption`, `smallpox-eradication`,
`paris-agreement`. Four back new scenes (`paraceratherium`, `edo-million-city`,
`first-transcontinental-railroad`, and `messel-pit`, to which `eocene-jungle` moved); the
new `wallacea-hand-stencil` scene links existing events. A Vredefort impact scene was drafted
and dropped: its neighbours are both split-level over-under frames, and a half-underwater view
of a distant impact read poorly, so `vredefort-impact-crater` stays an event only. Verification
was narrower than the batches above: WebFetch was blocked by the session's egress proxy for
every publisher and encyclopaedia host tried, so each date was checked against WebSearch result
text quoting the cited source, not a full page read. Details that could not be confirmed that
way are marked UNVERIFIED inline. Curation choices:
- **`4-2-kiloyear-event`** starts at the Meghalayan base, 4,250 yr **b2k** (before 2000), not
  BP 1950, so t = 4,275 under this file's convention.
- **`messel-pit`**'s t (47.5 Ma) sits in the Middle Messel Formation (47.65-47.22 Ma, Schmitt
  et al. 2024), assuming the classic fossils come from it. Mertz & Renne's 47.8 Ma is kept in
  the citation, marked as superseded by Lenz et al. 2015.
- **`huronian-glaciation`**'s 2.22 Ga end is the age of dykes cutting the glacial rocks, so it
  is a cap on the glaciation's end rather than a date for it.
- **`pterosaurs-origin`** does not claim a ~228 Ma first appearance: the oldest definite
  pterosaurs are ~215 Ma, and older Brazilian candidates are of uncertain identity.
- **`paraceratherium`** is described as among the largest land mammals, not the largest: some
  mass estimates for *Palaeoloxodon* elephants are higher.

## Gotchas

- **`t_min`/`t_max` is not always "measurement uncertainty about one moment."** For a few
  events (`ediacaran-biota`, `snowball-earth`) it is the fossil/geological record's known
  *span* — e.g. Ediacara biota are known from ~571 Ma to the end of the Ediacaran at 538.8 Ma.
  The description says so explicitly in each case; don't assume every interval is a plus/minus
  error bar.
- **`Event.placement_t` (`pipeline/shapes.py`; ADR-022) is for placement only** — a moment's own
  best-estimate `t`, else the interval's midpoint. Never present it as "the date" in the UI —
  several period midpoints (e.g. `ediacaran-biota`, `control-of-fire`) fall in the middle of a
  real span or a genuine scientific disagreement, not at a meaningful instant.
- **`EventSet.domain` is `(events[0].t_min, events[-1].t_max)` after sorting by `placement_t`**
  (see `pipeline/shapes.py`). Because `present` has the smallest placement value and
  `earth-formation` the largest, this works out to `(0.0, 4.59e9)` here, but that is a property
  of this specific event set, not a guarantee — a future event with a very wide interval could
  make the true min/max span wider than `domain` reports if it weren't also the extremal
  midpoint. Not an issue today; flagged for whoever next edits this file.
- **YAML scientific notation.** PyYAML's default (non-safe-adjacent) float regex requires a
  sign or digit immediately around the exponent — `4.49e9` parses fine, but if you ever write
  something like `4.49E+9` by hand, double-check it still parses as a float rather than a
  string. All values in this file were written to parse cleanly with `yaml.safe_load`, and the
  test suite would catch a regression (`Event.t_min` is a pydantic `float`, so a str would
  fail validation loudly rather than silently).
- **`interpolation` in `manifest.toml` is `"n/a"`.** `EventSet` has no interpolation policy —
  it's discrete events, not a continuously sampled series — but the manifest schema (shared
  across all four curated shapes) requires the field to be present.

## Measured volume

`data/curated/events-core.parquet`: **100,900 bytes** (98.5 KB) for 170 events, regenerated
from the current `data/events.yaml` via `normalise.main()`. `data/events.yaml` itself (the
actual source of truth, git-tracked separately): **192,131 bytes** (187.6 KB).

## Storage tier chosen

**git.** Far under the 5 MB threshold for the git tier (`docs/DATA_SOURCES.md` storage
policy). `data/events.yaml` is committed as source (not gitignored, unlike `data/raw/`),
consistent with its "this is source, not derived data" status in `docs/DATA_SOURCES.md`.

## Licensing note

Per `docs/DATA_SOURCES.md`, this source's licence is a mix:

- **Wikidata (CC0).** The work-package brief allows an optional Wikidata SPARQL pass to
  generate a candidate pool of events. That pass was **not used** for this build — all 29
  events were selected and dated directly against primary literature and the ICS chart, which
  gives more precise and more easily verified citations than a SPARQL "point in time" query
  would for a curated set this small. `fetch.py` therefore does not query Wikidata. If a future
  agent adds a Wikidata-sourced candidate pool, it inherits Wikidata's **CC0** dedication.
- **ICS International Chronostratigraphic Chart.** Used as the boundary-age reference for
  every stratigraphic-boundary event. The chart is **not CC-licensed** — ICS's own terms
  (`stratigraphy.org/ICSchart/Permissions_ICS_2017_v2.pdf`) grant free use for research,
  education and non-commercial reproduction, provided the chart is not modified beyond
  resizing and its copyright notice is retained. This project only cites specific boundary
  ages from it (in `data/events.yaml`'s citation fields) and keeps a local copy in
  `data/raw/events-core/` for reference; it does not redistribute or embed the chart image
  itself anywhere in `web/` or the published site.
- **Per-event literature citations.** Each event's own citation (Nature, Science, PNAS, PLOS,
  etc. papers) retains that publisher's copyright. `data/events.yaml`'s descriptions are
  original paraphrase, not copied text, consistent with the "paraphrase, don't copy" rule for
  Wikipedia-adjacent sourcing in `docs/DATA_SOURCES.md`.
