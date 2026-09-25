/**
 * Tier-1 ambience stem gains (ADR-023 §1, DESIGN §11). `stemGains(t, flatBasaltWindows)` is pure
 * in both arguments and called every engine tick while sound is on (`engine.ts`), so it stays
 * allocation-light and never imports `tone`.
 *
 * Every boundary is cited inline; event ids refer to `data/events.yaml` (`land-plants`,
 * `first-forests`, `dinosaurs`, `end-triassic-extinction`, `k-pg-impact`,
 * `paleocene-mammal-radiation`, `grassland-spread`, `control-of-fire`, `homo-sapiens-origin`,
 * `out-of-africa-migration`, `natufian-settlements`, `agriculture`, `livestock-domestication`,
 * `uruk-first-city`, `industrial-revolution`). `flatBasaltWindows` is every window of every
 * `Manifest.events` entry whose `effect.kind === 'flood-basalt'` (derived once by the caller),
 * so a newly-published flood-basalt event drives a `volcanic` bump with no new code here.
 */

import type { GeoTime } from '@/types/layer'

import { bump, clampUnit, rampLog, type TimeWindow } from './ramp'
import type { StemGains } from './stemIds'

/** Kept low so the K-Pg `impact` one-shot, not an adjacent Deccan swell, owns the impact moment
 *  (ADR-023). */
const VOLCANIC_FLOOD_BASALT_BUMP_GAIN = 0.45

/**
 * `wind`/`water`/`storm` stop being a global ambient bed once terrestrial ecosystems establish
 * (ADR-023). 385 Ma rounds `first-forests`'s `t_min` (3.78e8, Late Devonian *Archaeopteris*
 * forests, `data/events.yaml`); 370 Ma sits inside that same post-`first-forests` window and
 * marks land as vegetated enough for a terrestrial rustle bed (`forest`) to fully take over.
 * `devonian-estuary` (375 Ma) keeps its own `water` scene sound throughout, so it needs no help
 * from this global curve. Past this window `wind`/`water`/`storm` are heard only where a scene's
 * own `sound` names them (coastal, ice, storm or open-wind scenes), or where a real, dated
 * climate event bumps `wind` back in (`LGM_WIND_*` below) — never as a global bed.
 */
const TERRESTRIAL_BED_FADE_START = 3.85e8
const TERRESTRIAL_BED_FADE_END = 3.7e8

function terrestrialBedFade(t: GeoTime): number {
  return rampLog(t, TERRESTRIAL_BED_FADE_START, TERRESTRIAL_BED_FADE_END, 1, 0)
}

/**
 * The Last Glacial Maximum, ~26.5-19 ka (Clark, P.U. et al. (2009). "The Last Glacial Maximum."
 * *Science* 325(5941), 710-714) — a real, dated bump back into an otherwise-silent `wind` curve,
 * the same mechanism `volcanic`'s flood-basalt bump already uses, not a return of the global
 * pre-land bed. `pleistocene-steppe` (20 ka, "a cold, dry steppe") carries the scene's explicit
 * "woolly mammoth sound effect" `once` request (`data/scenes.yaml`) — a scene has one `sound`
 * slot, so the katabatic-wind character that scene's own open cold steppe wants has nowhere else
 * to live except this global, dated curve. The window comfortably brackets 20 ka without
 * reaching into `ice-age-europe-neanderthal` (42 ka, already carries its own `wind` loop) or
 * `gobekli-tepe` (11.5 ka, a settlement scene). Centred with `presenceNotch` (below) exactly on
 * the scene's own `t` — a plain `bump()` peaks at a window's arithmetic-mean midpoint (22.75 ka
 * here), 2.75 kyr off the scene itself, leaving the bump at only ~19% of its full gain right
 * where it needs to be loudest.
 */
const LGM_WIND_OLDER_EDGE = 2.65e4
const LGM_WIND_SCENE_T = 2.0e4
const LGM_WIND_YOUNGER_EDGE = 1.9e4
const LGM_WIND_BUMP_GAIN = 0.65

/**
 * Street traffic under `ginza-modern-tokyo` (95 yr), the city's motor-age street scene, whose one
 * `sound` slot already holds the tram bell `once`. The global `traffic` curve is still low there,
 * so it gets a scene-local bump centred on its own `t`, bounded by its dominant span in the
 * published manifest like `barrenSceneDuck`, so neither `somme-1916` nor `trinity-test` hears it.
 */
const GINZA_TRAFFIC_OLDER_EDGE = 101.8
const GINZA_TRAFFIC_SCENE_T = 95
const GINZA_TRAFFIC_YOUNGER_EDGE = 87.2
const GINZA_TRAFFIC_BUMP_GAIN = 0.4

/**
 * Charcoal is most abundant from the late Carboniferous through the Permian, as atmospheric O2
 * climbs toward ~30% and fire reaches an ever wider range of ecosystems (Scott, A.C. &
 * Glasspool, I.J. (2006), "The diversification of Paleozoic fire systems and fluctuations in
 * atmospheric oxygen concentration," PNAS 103(29), 10861-10865). The window peaks between
 * `carboniferous-swamp` (310 Ma) and `permian-conifer-forest` (294 Ma).
 */
const LATE_PALEOZOIC_FIRE_WINDOW: TimeWindow = { tMin: 2.55e8, tMax: 3.3e8 }
const LATE_PALEOZOIC_FIRE_GAIN = 0.15

/** `k-pg-impact` t: the `kpg-arrival` scene. */
const K_PG_IMPACT = 6.6043e7
/** ~4 days after the impact; `kpg-darkness` sits here. */
const K_PG_IMPACT_DAYS_AFTER = 6.604299999e7
/** A diverse rainforest stood at Castle Rock, Colorado by 64.1 Ma (Johnson, K.R. & Ellis, B.
 *  (2002). "A tropical rainforest in Colorado 1.4 million years after the Cretaceous-Tertiary
 *  boundary." *Science* 296(5577), 2379-2383) -- the point by which the forest/insect ambience
 *  is back to full presence, `kpg-aftermath` (100 yr after the impact, "the world has not
 *  recovered": ferns and dead trunks, no closed canopy) sitting well inside the still-suppressed
 *  early part of this recovery. */
const KPG_FOREST_RECOVERY_T = 6.41e7
/** Pre-K-Pg ends at `k-pg-impact` t_min: the boundary birds/mammals ramp in from and archosaurs
 *  are gone by. `forest`/`insects` never reach this floor by construction (both are already 0
 *  well before 66 Ma unrelated to the K-Pg duck), so it is not referenced below. */
const K_PG_END = 6.6032e7

/**
 * A "presence" multiplier: 1 (unsuppressed) at and beyond `olderEdge`/`youngerEdge`, falling to
 * exactly 0 at `centerT` in between — the shared shape both the K-Pg duck and the two barren-
 * scene ducks below need (a fall then a rise, which a single monotonic `rampLog` cannot express:
 * once one clamps flat at its floor it never recovers). The two `rampLog` calls have disjoint
 * domains that meet at exactly 0 at `centerT` (the first's floor, the second's ceiling), so
 * summing them reproduces the notch — the same disjoint-domain-sum idiom `water`'s own formula
 * uses.
 */
function presenceNotch(t: GeoTime, olderEdge: GeoTime, centerT: GeoTime, youngerEdge: GeoTime): number {
  return clampUnit(rampLog(t, olderEdge, centerT, 1, 0) + rampLog(t, centerT, youngerEdge, 0, 1))
}

/**
 * Silences the vegetation/insect ambience across the K-Pg impact and its aftermath — a real,
 * dated, GLOBAL catastrophe (unlike the two isolated scene-local ducks below), so a `t`-only
 * curve is the right model, not an approximation. Falls from 1 (full presence, before the
 * impact) to 0 across the ~4-day pyroclastic/thermal pulse (the same `K_PG_IMPACT` ->
 * `K_PG_IMPACT_DAYS_AFTER` window `archosaurs` already ducks across for the same reason), stays
 * there through `kpg-darkness` and the ~century-later `kpg-aftermath` (both scenes sit inside
 * the still-near-0 early part of the recovery ramp, nowhere near its own 64.1 Ma floor), then
 * recovers back to 1 by `KPG_FOREST_RECOVERY_T`.
 */
function kpgVegetationDuck(t: GeoTime): number {
  return presenceNotch(t, K_PG_IMPACT, K_PG_IMPACT_DAYS_AFTER, KPG_FOREST_RECOVERY_T)
}

/**
 * Two isolated, scene-local "nothing living is on screen" windows, for scenes whose own
 * `subject.vegetation`/`fauna`/`absent` explicitly rules out `forest`/`insects`/`birds`/`mammals`.
 * Unlike the K-Pg duck above, neither is a global mass-extinction — at 33.7 Ma most of Earth
 * still had rainforest; only Antarctica's freshly-calved coast did not. Each uses `presenceNotch`
 * centred exactly on that ONE scene's own `t`, bounded by its dominant span in the published
 * manifest (the `log1p(t)`-space dissolve midpoint to its neighbour on each side) rather than the
 * real duration of the geological event it depicts — an approximation of "what's on screen right
 * now", documented as such rather than mis-citing a source for a global claim it isn't making.
 *
 * - `eocene-oligocene-icesheet` (33.7 Ma, "no forest anywhere in view... no animals in view"):
 *   between `eocene-jungle` (50 Ma) and `miocene-grassland` (18 Ma), a span this scene has
 *   entirely to itself — and one during which global cooling and forest contraction through the
 *   Eocene-Oligocene transition (Hutchinson, D.K. et al. (2021). "The Eocene-Oligocene
 *   transition..." *Climate of the Past* 17, 269-315) was a real, if less abrupt, trend.
 * - `messinian-salt-flats` (5.6 Ma, "absent: any plant, any animal"): between
 *   `c4-savanna-hipparion` (7 Ma) and `lucy-afarensis` (3.2 Ma).
 */
function barrenSceneDuck(t: GeoTime): number {
  return clampUnit(
    presenceNotch(t, 4.1049e7, 3.37e7, 2.4629e7) * // eocene-oligocene-icesheet
      presenceNotch(t, 6.261e6, 5.6e6, 4.2332e6), // messinian-salt-flats
  )
}

/** Multiplies `forest`/`wing-hum`/`insects`/`birds`/`mammals` -- everything that reads as
 *  "living things are audibly present" -- so all five go quiet together wherever the on-screen
 *  scene is a global catastrophe's immediate aftermath or one of the two barren, scene-local
 *  windows above, instead of only `archosaurs` (which had its own, narrower K-Pg duck already). */
function lifePresence(t: GeoTime): number {
  return kpgVegetationDuck(t) * barrenSceneDuck(t)
}

/**
 * Farming, then cities, push wild animals off the land people live on: from `agriculture` t_max
 * to `uruk-first-city` t_min the wildlife stems recede as if human dominance were already
 * `SETTLED_LAND_DOMINANCE`, so Göbekli Tepe still sits in wild country while Athens, Rome or Edo
 * no longer carry a lion or cricket chorus. `humanDominance` takes over once industry passes it.
 */
const SETTLED_LAND_DOMINANCE = 0.7

function wildlifeDominance(t: GeoTime, dominance: number): number {
  return Math.max(dominance, rampLog(t, 1.1525e4, 5.125e3, 0, SETTLED_LAND_DOMINANCE))
}

/**
 * `ice-age-europe-neanderthal` (42 ka) and `pleistocene-steppe` (20 ka) show the cold, open
 * steppe of the last glacial, with no humid forest or summer cricket chorus. The dip spans both
 * scenes and leaves out `wallacea-hand-stencil` (67.8 ka, tropical Sulawesi) and `gobekli-tepe`
 * (11.5 ka, Holocene): scene-local like `barrenSceneDuck`, not a claim about the whole globe.
 */
function glacialSteppe(t: GeoTime): number {
  return 1 - 0.75 * rampLog(t, 5.5e4, 4.5e4, 0, 1) * rampLog(t, 1.6e4, 1.2e4, 1, 0)
}

/**
 * Scenes with no crowd, hearth or traffic in them, centred on each scene's own `t` like
 * `barrenSceneDuck`:
 *
 * - `eemian-thames-hippos` (125 ka): Britain was deserted between ~180 and ~60 ka (Ashton, N. &
 *   Lewis, S. (2002). "Deserted Britain: declining populations in the British Late Middle
 *   Pleistocene." *Antiquity* 76(292), 388-396), so no hearth or camp voices.
 * - `hattusa-abandoned` (3.21 ka), `chernobyl-exclusion-zone` (39 yr) and
 *   `covid-19-venice-lockdown` (5 yr): an abandoned or emptied city.
 * - `trinity-test` (80 yr), `green-revolution-fields` (60 yr), `amazon-deforestation-fishbone`
 *   (30 yr) and `energy-transition-solar-wind` (11 yr): a desert hilltop, a wheat field, a forest
 *   clearing and a coastline, far from any city.
 */
function peoplePresence(t: GeoTime): number {
  return clampUnit(
    presenceNotch(t, 1.984e5, 1.25e5, 9.21e4) * // eemian-thames-hippos
      presenceNotch(t, 3.836e3, 3.21e3, 2.807e3) * // hattusa-abandoned
      presenceNotch(t, 87.2, 80, 73.8) * // trinity-test
      presenceNotch(t, 63.9, 60, 58) * // green-revolution-fields
      presenceNotch(t, 44.2, 39, 37.47) * // chernobyl-exclusion-zone
      presenceNotch(t, 32.9, 30, 18.3) * // amazon-deforestation-fishbone
      presenceNotch(t, 18.3, 11, 8.8) * // energy-transition-solar-wind
      presenceNotch(t, 5.9, 5, 4.48), // covid-19-venice-lockdown
  )
}

/**
 * `livestock` is Old World goats, sheep and cattle, which reached the Americas only after 1492;
 * `tikal-classic-maya` (1.285 ka) and `columbus-landfall-1492` (533 yr) carry none.
 */
function americasSceneDuck(t: GeoTime): number {
  return clampUnit(
    presenceNotch(t, 1563, 1285, 1060) * // tikal-classic-maya
      presenceNotch(t, 601, 533, 447), // columbus-landfall-1492
  )
}

/**
 * `wing-hum` — a QUIET, generic winged-insect wing-drone, filling the gap `insects` (a
 * cricket-STRIDULATION clip) honestly cannot: Grimaldi, D. & Engel, M.S. (2005). *Evolution of
 * the Insects*. Cambridge University Press dates unambiguous WINGED insects (Meganisoptera —
 * griffinflies, the `carboniferous-swamp` scene's own Meganeura among them — and early
 * Palaeodictyopterida) to ~325 Ma, 25 Myr before Song et al. 2020's ~300 Ma date for
 * stridulation, the one character `insects`' own clip actually has. `wing-hum` uses a DIFFERENT
 * clip (`sources/audio-stems/stems.toml`: kangaroovindaloo "Blowflies!", CC0 — a diffuse,
 * continuous swarm texture, spectrogram-checked for the absence of discrete pulses, FM bird
 * chirps or periodic frog croaking), so it can rise on its own citation without inheriting
 * `insects`' stridulation date. Ramps in 325 -> 320 Ma to a plateau just under `fire`'s own 0.15
 * texture level — clearly audible in the mix from `carboniferous-swamp` onwards without
 * outweighing `forest`'s 0.3 baseline — ducked by `wildlifeDominance` and `lifePresence` exactly
 * like `insects`.
 *
 * **Persists, rather than receding, once `insects` itself starts at 300 Ma.** The two read as
 * different characters (a continuous drone vs. discrete stridulation chirps), not a duplicate of
 * the same sound, and flying insects did not go extinct when stridulation evolved — winged
 * insect lineages have flown continuously from the Carboniferous to the present (Grimaldi & Engel
 * 2005), so a generic wing-hum staying audible under every later insect stage is the honest
 * reading.
 */
const WING_HUM_RAMP_START = 3.25e8
const WING_HUM_RAMP_END = 3.2e8
const WING_HUM_PLATEAU_GAIN = 0.12

function wingHum(t: GeoTime, dominance: number, life: number): number {
  return rampLog(t, WING_HUM_RAMP_START, WING_HUM_RAMP_END, 0, WING_HUM_PLATEAU_GAIN) * duck(0.85, dominance) * life
}

/**
 * How far human noise has displaced the natural soundscape, 0 → 1. An explicit time curve, not
 * derived from the `industry`/`traffic` rows, so every stem stays an independent, auditable row.
 *
 * - 265 yr (1761), rises from 0: `industrial-revolution` t_max.
 * - 125 yr (~1900), 0.7: electric unit drives replace steam line shafts from the early 1900s
 *   (Devine 1983, J. Econ. Hist. 43(2):347–372); Model T 1908.
 * - 19 yr (~2007), 1.0: world urban population passes 50% (UN DESA, World Urbanization Prospects).
 */
export function humanDominance(t: GeoTime): number {
  return rampLog(t, 265, 125, 0, 0.7) + rampLog(t, 125, 19, 0, 0.3)
}

/** Multiplier that removes `depth` of a stem at full human dominance. */
function duck(depth: number, dominance: number): number {
  return 1 - depth * dominance
}

function floodBasaltBump(t: GeoTime, windows: ReadonlyArray<TimeWindow>): number {
  let sum = 0
  for (const window of windows) sum += bump(t, window)
  return VOLCANIC_FLOOD_BASALT_BUMP_GAIN * sum
}

/**
 * Every ambience stem's gain at `t`, each independently clamped to `[0, 1]` (ADR-023 §1: "never
 * let two contributions push a stem over 1").
 */
export function stemGains(t: GeoTime, flatBasaltWindows: ReadonlyArray<TimeWindow>): StemGains {
  const dominance = humanDominance(t)

  const wild = wildlifeDominance(t, dominance)
  const bedFade = terrestrialBedFade(t)
  const life = lifePresence(t)
  const cold = glacialSteppe(t)
  const people = peoplePresence(t)

  return {
    // `land-plants`/`first-forests`: vegetation softens open wind, THEN the whole pre-land bed
    // fades to 0 by 370 Ma, once land is vegetated enough for `forest` to carry the terrestrial
    // bed (`terrestrialBedFade`) — past this a wind scene sound (ice-sheet, salt-flat, steppe,
    // storm scenes) or the dated LGM bump is what carries it.
    wind: clampUnit(
      rampLog(t, 4.7e8, 3.78e8, 0.6, 0.32) * bedFade +
        LGM_WIND_BUMP_GAIN * (1 - presenceNotch(t, LGM_WIND_OLDER_EDGE, LGM_WIND_SCENE_T, LGM_WIND_YOUNGER_EDGE)),
    ),
    water: clampUnit(
      (// `moon-forming-impact` aftermath: early oceans louder.
      0.45 +
        rampLog(t, 4.0e9, 3.8e9, 0.15, 0) -
        // Surf recedes to a background as life, and the scenes, move inland across the same
        // `land-plants` → `first-forests` window that softens wind.
        rampLog(t, 4.7e8, 3.78e8, 0, 0.2)) *
        // Then out entirely by the same dissolve boundary `wind` fades across — a
        // coastal/estuary/landfall/panama scene brings it back with its own water loop; arid
        // inland and forest scenes no longer sit on a surf roar.
        bedFade,
    ),
    // Flat placeholder until paleoclimate precipitation is curated (ADR-023 Consequences), faded
    // out with the rest of the pre-land bed. No scene names `stem: storm` today
    // (`data/scenes.yaml`), so this stem is silent past 370 Ma until one does.
    storm: clampUnit(0.22 * bedFade),
    // Secular Hadean → Neoproterozoic decline, then out through the early Phanerozoic: the clip is
    // a crater-rim recording with eruption blasts, a plausible bed only on a volcanically
    // dominated, lifeless surface, not under every later scene. The magma-ocean scene loops it,
    // and flood-basalt windows swell it (none are published yet: no `siberian-traps` or
    // `deccan-traps` event carries a `flood-basalt` effect, so that bump is dormant).
    volcanic: clampUnit(
      rampLog(t, 4.0e9, 5.4e8, 0.75, 0.15) * rampLog(t, 5.4e8, 4.2e8, 1, 0) + floodBasaltBump(t, flatBasaltWindows),
    ),
    // The terrestrial bed `wind`/`water`/`storm` hand off to — humid forest/swamp rustle, rising
    // in lockstep with the bed's own fade-out (`TERRESTRIAL_BED_FADE_START`/`_END`) and holding
    // as the "the world has land life on it now" backdrop ever after (ducked by
    // `wildlifeDominance` like the other wildlife stems, and by `lifePresence` wherever the
    // on-screen scene itself is a global die-off or a barren, lifeless setting).
    forest: clampUnit(rampLog(t, TERRESTRIAL_BED_FADE_START, TERRESTRIAL_BED_FADE_END, 0, 0.3) * duck(0.8, wild) * life * cold),
    // See `wingHum`'s own doc comment: a quiet, generic wing-drone (a DIFFERENT, non-stridulating
    // clip from `insects`') covering the 325-300 Ma gap `insects` itself cannot honestly cover,
    // then persisting rather than receding once `insects` starts.
    'wing-hum': clampUnit(wingHum(t, wild, life) * cold),
    insects: clampUnit(
      // Forewing stridulation — the only character this clip has (a cricket-stridulation loop,
      // `sources/audio-stems/stems.toml`) — evolves late Carboniferous–early Permian (Song et
      // al. 2020, Nat. Commun. 11:4939); Orthoptera ~300 Ma. `insects` itself is still silent
      // before 300 Ma (there is still no evidence for stridulation any earlier); the 325-300 Ma
      // gap is covered instead by `wing-hum` (above), a genuinely non-stridulating clip on its
      // own citation.
      // Kept under `forest`'s 0.3 at its fullest: a texture in the bed, not its loudest voice.
      (rampLog(t, 3.0e8, 2.52e8, 0, 0.06) +
        // Triassic ensiferans with modern-homologous stridulatory files; Archaboilus musicus
        // sings a 6.4 kHz pure tone at ~165 Ma (Gu et al. 2012, PNAS 109(10):3868–3873).
        rampLog(t, 2.3e8, 1.65e8, 0, 0.08) +
        // Oldest loud modern cicadid, Davispia bearcreekensis, 59–56 Ma: denser chorus only.
        rampLog(t, 5.9e7, 5.6e7, 0, 0.04)) *
        duck(0.85, wild) *
        life *
        cold,
    ),
    // Large synapsid/large reptile groans and bellows, filling the gap between the pre-land
    // bed's silence and `archosaurs`. Large dinocephalian synapsids dominate Permian terrestrial
    // megafauna by the Guadalupian, ~270-260 Ma; gorgonopsians rise to dominance later, in the
    // Lopingian, after the dinocephalians' own end-Guadalupian extinction (Kemp, T.S. (2005).
    // *The Origin and Evolution of Mammals*. Oxford University Press) — matches the
    // `permian-interior` (260 Ma, "massive synapsids drink from a shrinking seasonal river") and
    // `early-triassic-lystrosaurus` (251 Ma) scenes. Recedes from `end-triassic-extinction`'s own
    // t_max (2.31e8, the same instant `archosaurs`' Triassic radiation ramp starts rising) to its
    // t_min (2.01e8, `archosaurs`' second ramp's own start) — moved earlier than the window
    // `archosaurs` itself recedes across, so the two stems no longer both peak together at the
    // very moment the first dinosaurs appear; `large-animal` is fully 0 by 201 Ma, well before
    // Jurassic dinosaur scenes.
    'large-animal': clampUnit(rampLog(t, 2.7e8, 2.5e8, 0, 0.32) * rampLog(t, 2.31e8, 2.01e8, 1, 0)),
    birds: clampUnit(
      // Vegavis iaai's 69 Ma syrinx implies honks, not song (Clarke et al. 2016, Nature
      // 538:502–505), so 0 until `k-pg-impact` t_min.
      (rampLog(t, K_PG_END, 4.7e7, 0, 0.12) +
        // Passerines originate ~47 Ma (Oliveros et al. 2019, PNAS 116(16):7916–7925), reaching
        // Eurasia/Africa by the Oligocene.
        rampLog(t, 4.7e7, 3.0e7, 0, 0.16)) *
        duck(0.75, wild) *
        // Silences the dawn chorus under `eocene-oligocene-icesheet` ("no animals in view") and
        // `messinian-salt-flats` ("absent: any animal") — the only two barren windows birds' own
        // 66 Ma floor overlaps.
        barrenSceneDuck(t),
    ),
    archosaurs: clampUnit(
      // `dinosaurs` Triassic radiation (t_max 243 Ma, t 231 Ma).
      (rampLog(t, 2.43e8, 2.31e8, 0, 0.18) +
        // After `end-triassic-extinction`: Jurassic dinosaur dominance.
        rampLog(t, 2.01e8, 1.75e8, 0, 0.17)) *
        // Silenced by the impact itself, not across `k-pg-impact`'s 11 kyr dating interval:
        // `kpg-darkness` (days after) and `kpg-aftermath` (a century after) must not carry them.
        // Crocodilians survive, but a residual would blur "the dinosaurs are gone". Closed-mouth
        // low bellows as the clip's character: Riede et al. 2016, Evolution 70(8):1734–1746.
        rampLog(t, K_PG_IMPACT, K_PG_IMPACT_DAYS_AFTER, 1, 0),
    ),
    mammals: clampUnit(
      // `paleocene-mammal-radiation`, then `grassland-spread` open-country herds.
      (rampLog(t, K_PG_END, 5.6e7, 0, 0.08) + rampLog(t, 2.3e7, 1.55e7, 0, 0.14)) *
        // Late Quaternary megafaunal extinctions, 50–10 ka (Koch & Barnosky 2006, Annu. Rev.
        // Ecol. Evol. Syst. 37:215–250).
        rampLog(t, 5.0e4, 1.0e4, 1, 0.6) *
        duck(0.95, wild) *
        // Silences the herd-and-lion bed under `eocene-oligocene-icesheet` and
        // `messinian-salt-flats` ("absent: any animal") — the only barren window `mammals`' own
        // 66 Ma floor overlaps.
        barrenSceneDuck(t),
    ),
    // `livestock-domestication`: Fertile Crescent goats, sheep, cattle 10–11 ka (Zeder).
    livestock: clampUnit(rampLog(t, 1.3025e4, 9.5e3, 0, 0.22) * duck(0.9, dominance) * americasSceneDuck(t)),
    fire: clampUnit(
      // Wildfire only through the late Palaeozoic high-oxygen window, not as a bed under every
      // land scene since plants first burned (ADR-023 amendment "fire is not a permanent bed").
      bump(t, LATE_PALEOZOIC_FIRE_WINDOW) * LATE_PALEOZOIC_FIRE_GAIN +
        // Hearth fire: in over `control-of-fire` t_max → t_min, out as `agriculture`'s villages
        // hand the human soundscape to `settlement` (its t_max → t_min). The scenes that show a
        // fire carry their own `fire` sound.
        rampLog(t, 1.5e6, 4.0e5, 0, 0.17) * rampLog(t, 1.1525e4, 1.0025e4, 1, 0) * people,
    ),
    settlement: clampUnit(
      // Distant camp voices: `homo-sapiens-origin` t → `out-of-africa-migration` t_min.
      (rampLog(t, 3.15e5, 5.0e4, 0, 0.08) +
        // `natufian-settlements`: first sedentary villages.
        rampLog(t, 1.5e4, 1.15e4, 0, 0.16) +
        // `agriculture` t_max → t_min.
        rampLog(t, 1.1525e4, 1.0025e4, 0, 0.14) +
        // `uruk-first-city`; flat afterwards until HYDE population is curated.
        rampLog(t, 6.025e3, 5.125e3, 0, 0.1)) *
        people,
    ),
    industry: clampUnit(
      // `industrial-revolution` t_max (1761) → steam-powered mills of 1830, then the Victorian
      // steam peak to ~1900. Isolated Newcomen mine pumps (313 yr) are not an ambient soundscape.
      (rampLog(t, 265, 195, 0, 0.5) + rampLog(t, 195, 125, 0, 0.15)) *
        // Electrification retires steam line shafts from the early 1900s (Devine 1983), then
        // later deindustrialisation.
        rampLog(t, 125, 60, 1, 0.35) *
        rampLog(t, 60, 0, 1, 0.6) *
        people,
    ),
    traffic: clampUnit(
      // Ford Model T from October 1908; half of US cars by 1918. 80 yr = 1945.
      (rampLog(t, 118, 80, 0, 0.25) +
        // Post-war mass motorisation, 1945 → 2000.
        rampLog(t, 80, 25, 0, 0.3) +
        GINZA_TRAFFIC_BUMP_GAIN *
          (1 - presenceNotch(t, GINZA_TRAFFIC_OLDER_EDGE, GINZA_TRAFFIC_SCENE_T, GINZA_TRAFFIC_YOUNGER_EDGE))) *
        people,
    ),
  }
}
