import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { humanDominance, stemGains } from './stemGains'
import { AMBIENCE_STEM_IDS, SCENE_STEM_IDS, type AmbienceStemId } from './stemIds'

const NO_FLOOD_BASALT: never[] = []
// Siberian Traps (data/events.yaml t_min 2.5e8 / t_max 2.54e8) and Deccan Traps (t_min 6.56e7 /
// t_max 6.63e7), passed the same way `engine.ts` derives them from flood-basalt-effect events.
const FLOOD_BASALT = [
  { tMin: 2.5e8, tMax: 2.54e8 },
  { tMin: 6.56e7, tMax: 6.63e7 },
]

type Row = [label: string, t: number, gains: Record<AmbienceStemId, number>]
type GainColumns = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

function row(
  label: string,
  t: number,
  [
    wind,
    water,
    storm,
    volcanic,
    forest,
    wingHum,
    insects,
    largeAnimal,
    birds,
    archosaurs,
    mammals,
    livestock,
    fire,
    settlement,
    industry,
    traffic,
  ]: GainColumns,
): Row {
  return [
    label,
    t,
    {
      wind,
      water,
      storm,
      volcanic,
      forest,
      'wing-hum': wingHum,
      insects,
      'large-animal': largeAnimal,
      birds,
      archosaurs,
      mammals,
      livestock,
      fire,
      settlement,
      industry,
      traffic,
    },
  ]
}

// Era-fit v3 checkpoints (ADR-023 amendment 2026-09-15 "era fit v3" and its "era fit v3 fixes"
// amendment), covering the diagnostic checkpoints the listening feedback named plus the ones the
// v3 review's fixes need pinned. `wind`/`water`/`storm` are the pre-land bed only — exactly 0 for
// every t <= 370 Ma, the moment `late-devonian-tetrapod` becomes the dominant on-screen scene, not
// 350 Ma (the v3 build's original, laggy boundary); `forest`/`insects` pick up across the same
// window; `insects` itself only starts at 300 Ma (Song et al. 2020's stridulation date — the only
// character its one cricket-loop clip actually has, era fit v3 fixes); `large-animal` bridges the
// Permian-Triassic gap before `archosaurs`, now clearing by 201 Ma instead of 175 Ma; three barren,
// scene-local windows (`eocene-oligocene-icesheet`, `messinian-salt-flats`, `gondwana-ice-margin`)
// and the K-Pg impact+aftermath silence `forest`/`insects`/`birds`/`mammals` exactly at their own
// scene `t` and recover at the neighbouring scenes on each side.
//                                                wind  water storm volc  forest wnghm insct large-an birds archo mamml lvstk fire  settl indst traffic
const CHECKPOINTS: Row[] = [
  row('4.4 Ga', 4.4e9, [0.6, 0.6, 0.22, 0.75, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  row('3 Ga', 3e9, [0.6, 0.45, 0.22, 0.72, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  row('700 Ma', 7e8, [0.6, 0.45, 0.22, 0.1745, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  row('480 Ma', 4.8e8, [0.6, 0.45, 0.22, 0.0824, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  row('400 Ma', 4.0e8, [0.3641, 0.2815, 0.22, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.15, 0, 0, 0]),
  // 370 Ma: `late-devonian-tetrapod` (a forested stream) becomes the dominant scene right here —
  // the pre-land bed must already be fully silent and `forest` already at its full baseline
  // (era-fit v3 fix: previously the bed only finished fading 20 Myr later, at 350 Ma). `wing-hum`
  // is still 0 here -- its own ramp only starts at 325 Ma (wing-hum amendment).
  row('370 Ma (late-devonian-tetrapod becomes dominant)', 3.7e8, [0, 0, 0, 0, 0.3, 0, 0, 0, 0, 0, 0, 0, 0.15, 0, 0, 0]),
  row('365 Ma', 3.65e8, [0, 0, 0, 0, 0.3, 0, 0, 0, 0, 0, 0, 0, 0.15, 0, 0, 0]),
  row('360 Ma', 3.6e8, [0, 0, 0, 0, 0.3, 0, 0, 0, 0, 0, 0, 0, 0.15, 0, 0, 0]),
  // The user's own diagnostic point: a forest scene (late-devonian-tetrapod is dominant here), the
  // pre-land bed must already read as silent and the forest bed must already be on. `insects` is
  // still 0 here (era-fit v3 fix): the only clip is a cricket-stridulation loop, and stridulation
  // is not dated earlier than ~300 Ma (Song et al. 2020) — see the "insects" describe block below
  // for why this trades off part of the human's literal "insects at 346 Ma" ask for not playing an
  // anachronistic clip. `wing-hum` is also still 0 at 346 Ma -- 21 Myr before its own 325 Ma start
  // (wing-hum amendment); it is `forest` alone that answers the "forest/swamp" half of the human's
  // 346 Ma ask, same as before this amendment.
  row('346 Ma (forest scene)', 3.46e8, [0, 0, 0, 0, 0.3, 0, 0, 0, 0, 0, 0, 0, 0.15, 0, 0, 0]),
  // 300 Ma: `gondwana-ice-margin`'s own t, inside the scene-local barren duck — forest, wing-hum
  // and (the not-yet-started) insects all read as silent exactly here, not just "quieter".
  row('300 Ma (gondwana-ice-margin)', 3.0e8, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.15, 0, 0, 0]),
  // 260 Ma: `wing-hum` is at its full quiet plateau here (325→320 Ma ramp long complete), well
  // under `forest`'s 0.3 baseline -- see the "wing-hum" describe block below.
  row('260 Ma (permian-interior)', 2.6e8, [0, 0, 0, 0, 0.3, 0.06, 0.0923, 0.1552, 0, 0, 0, 0, 0.15, 0, 0, 0]),
  // 248 Ma: the user's other diagnostic point -- large-animal (early-triassic-lystrosaurus, a
  // synapsid scene) must already be clearly audible.
  row('248 Ma', 2.48e8, [0, 0, 0, 0, 0.3, 0.06, 0.1, 0.32, 0, 0, 0, 0, 0.15, 0, 0, 0]),
  // 200 Ma: era-fit v3 fix -- `large-animal` now clears by 201 Ma (the same instant its recession
  // starts moving archosaurs' own second ramp on), so it no longer outweighs `archosaurs` here the
  // way the original 175 Ma-clearing window did.
  row('200 Ma', 2.0e8, [0, 0, 0, 0, 0.3, 0.06, 0.1678, 0, 0, 0.1805, 0, 0, 0.15, 0, 0, 0]),
  // 154 Ma: jurassic-floodplain, the sauropod scene the user liked (archosaurs loop) -- unchanged.
  row('154 Ma (sauropods)', 1.54e8, [0, 0, 0, 0, 0.3, 0.06, 0.28, 0, 0, 0.35, 0, 0, 0.15, 0, 0, 0]),
  // 90 Ma: mid-cretaceous-pollinators, the pollination scene -- ambient only; the pronounced
  // bee/fly buzz is a scene sound (sceneSound.test.ts / data/scenes.yaml), not an ambient row.
  row('90 Ma (pollination scene)', 9.0e7, [0, 0, 0, 0, 0.3, 0.06, 0.28, 0, 0, 0.35, 0, 0, 0.15, 0, 0, 0]),
  row('66.043 Ma (impact, just before)', 6.6043e7, [0, 0, 0, 0.3758, 0.3, 0.06, 0.28, 0, 0, 0.35, 0, 0, 0.15, 0, 0, 0]),
  // 66.0 Ma: era-fit v3 fix -- inside the K-Pg vegetation duck's still-near-0 recovery ramp
  // (`kpg-darkness`/`kpg-aftermath` both sit here too), not the untouched 0.3/0.46 the v3 build
  // originally left across the whole K-Pg window. `wing-hum` is ducked by the same `life`
  // multiplier as `forest`/`insects` (wing-hum amendment), so it is silenced here too.
  row('66.0 Ma (K-Pg aftermath)', 6.6e7, [0, 0, 0, 0.4276, 0.0004, 0.0001, 0.0003, 0, 0, 0, 0, 0, 0.15, 0, 0, 0]),
  // 30 Ma: inside `eocene-oligocene-icesheet`'s barren duck window (era-fit v3 fix) -- forest,
  // wing-hum, insects, birds and mammals are all measurably reduced here, not the untouched values
  // the v3 build originally left across the whole Eocene-Oligocene-to-Miocene span.
  row('30 Ma', 3.0e7, [0, 0, 0, 0, 0.0908, 0.0182, 0.1059, 0, 0.0848, 0, 0.0242, 0, 0.15, 0, 0, 0]),
  // 12 Ma: miocene-grassland/c4-savanna, the mammal calls the user liked -- unchanged.
  row('12 Ma (mammals liked)', 1.2e7, [0, 0, 0, 0, 0.3, 0.06, 0.35, 0, 0.28, 0, 0.22, 0, 0.15, 0, 0, 0]),
  row('10 ka', 1.0e4, [0, 0, 0, 0, 0.3, 0.06, 0.35, 0, 0.28, 0, 0.132, 0.206, 0.32, 0.38, 0, 0]),
  // 195 yr (~1830): industrial-mill-town, the machinery the user liked -- unchanged. `wing-hum` is
  // ducked by `humanDominance` exactly like `insects` (wing-hum amendment), so it is already well
  // below its 0.06 plateau here.
  row('195 yr (1830, industry liked)', 195, [0, 0, 0, 0, 0.2398, 0.0472, 0.2753, 0, 0.2273, 0, 0.1005, 0.1703, 0.2585, 0.48, 0.5, 0]),
  // 162 yr: also industrial-mill-town (dominant scene) -- unchanged.
  row('162 yr (industry liked)', 162, [0, 0, 0, 0, 0.1766, 0.0338, 0.197, 0, 0.172, 0, 0.0675, 0.1182, 0.194, 0.48, 0.5557, 0]),
  row('present', 0, [0, 0, 0, 0, 0.06, 0.009, 0.0525, 0, 0.07, 0, 0.0066, 0.022, 0.075, 0.48, 0.1365, 0.55]),
]

const WILDLIFE = ['forest', 'wing-hum', 'insects', 'birds', 'mammals', 'livestock'] as const

function wildlifeMax(t: number): number {
  const gains = stemGains(t, NO_FLOOD_BASALT)
  return Math.max(...WILDLIFE.map((id) => gains[id]))
}

describe('stemGains (IMPLEMENTATION.md A6: era-fit v3 checkpoints, era-fit v3 fixes)', () => {
  it.each(CHECKPOINTS)('matches the era-fit v3 checkpoint table at %s', (_label, t, expected) => {
    const gains = stemGains(t, FLOOD_BASALT)
    for (const id of AMBIENCE_STEM_IDS) {
      expect(gains[id], `${id}`).toBeCloseTo(expected[id], 2)
    }
  })

  it('rows cover exactly the ambience stems: scene-only stems (impact et al.) have no ambient gain', () => {
    const gains = stemGains(6.6043e7, FLOOD_BASALT)
    expect(Object.keys(gains).sort()).toEqual([...AMBIENCE_STEM_IDS].sort())
    for (const id of SCENE_STEM_IDS) {
      expect(id in gains, id).toBe(false)
    }
  })
})

describe('stemGains: the listening-feedback complaints, confirmed fixed', () => {
  it('wind/water/storm are exactly 0 for every t <= 370 Ma -- no global surf/storm past the Devonian/Carboniferous boundary', () => {
    for (const t of [3.7e8, 3.5e8, 3.46e8, 3.0e8, 2.48e8, 1.5e8, 6.6043e7, 1.2e7, 1.0e4, 195, 0]) {
      const gains = stemGains(t, FLOOD_BASALT)
      expect(gains.wind, `wind at t=${t}`).toBe(0)
      expect(gains.water, `water at t=${t}`).toBe(0)
      expect(gains.storm, `storm at t=${t}`).toBe(0)
    }
  })

  it('wind/water/storm are still a full pre-land bed well before 385 Ma', () => {
    const gains = stemGains(4.0e8, NO_FLOOD_BASALT)
    expect(gains.wind).toBeGreaterThan(0.3)
    expect(gains.water).toBeGreaterThan(0.2)
    expect(gains.storm).toBeCloseTo(0.22, 5)
  })

  it('at 346 Ma (the forest scene) the pre-land bed is silent and forest is clearly audible', () => {
    const gains = stemGains(3.46e8, NO_FLOOD_BASALT)
    expect(gains.wind).toBe(0)
    expect(gains.water).toBe(0)
    expect(gains.storm).toBe(0)
    expect(gains.forest).toBeGreaterThan(0.25)
  })

  it('large-animal is clearly audible at 248 Ma (early-triassic-lystrosaurus) where the feedback asked for it', () => {
    expect(stemGains(2.48e8, NO_FLOOD_BASALT)['large-animal']).toBeCloseTo(0.32, 2)
  })

  it('large-animal is silent before the Permian synapsid radiation and after the end-Triassic handover to archosaurs', () => {
    expect(stemGains(2.75e8, NO_FLOOD_BASALT)['large-animal']).toBe(0)
    for (const t of [2.0e8, 1.75e8, 1.5e8, 6.6043e7, 0]) {
      expect(stemGains(t, NO_FLOOD_BASALT)['large-animal'], `t=${t}`).toBe(0)
    }
  })

  it('archosaurs at 154 Ma (sauropods, jurassic-floodplain) are unchanged and still liked', () => {
    expect(stemGains(1.54e8, NO_FLOOD_BASALT).archosaurs).toBeCloseTo(0.35, 2)
  })

  it('industry at 1830/162 yr (industrial-mill-town) is unchanged and still louder than every wildlife stem', () => {
    for (const t of [195, 162]) {
      const gains = stemGains(t, NO_FLOOD_BASALT)
      expect(gains.industry, `t=${t}`).toBeGreaterThan(0)
      expect(gains.industry, `t=${t}`).toBeGreaterThan(wildlifeMax(t))
    }
    expect(stemGains(195, NO_FLOOD_BASALT).industry).toBeGreaterThanOrEqual(0.49)
  })

  it('settlement is unchanged from the v2 amendment', () => {
    expect(stemGains(1.15e4, NO_FLOOD_BASALT).settlement).toBeGreaterThanOrEqual(0.23)
    expect(stemGains(1.0e4, NO_FLOOD_BASALT).settlement).toBeGreaterThanOrEqual(0.37)
  })
})

describe('stemGains: bed fade completes by the scene transition, not 20 Myr later (era-fit v3 fixes)', () => {
  it('wind/water/storm are already exactly 0, and forest already at its full baseline, from 370 Ma on', () => {
    for (const t of [3.7e8, 3.65e8, 3.6e8]) {
      const gains = stemGains(t, NO_FLOOD_BASALT)
      expect(gains.wind, `wind at t=${t}`).toBe(0)
      expect(gains.water, `water at t=${t}`).toBe(0)
      expect(gains.storm, `storm at t=${t}`).toBe(0)
      expect(gains.forest, `forest at t=${t}`).toBeCloseTo(0.3, 5)
    }
  })

  it('the pre-land bed is still measurably louder than forest just before 385 Ma, unlike right after it', () => {
    const before = stemGains(3.9e8, NO_FLOOD_BASALT)
    expect(before.wind).toBeGreaterThan(before.forest)
  })
})

describe('stemGains: insects re-dated to the clip\'s own stridulation character (era-fit v3 fixes)', () => {
  it('is silent for every t > 300 Ma -- the citation (Song et al. 2020) dates stridulation, the only character this clip has, from ~300 Ma, not from 385 Ma or 325 Ma as the v3 build had it', () => {
    for (const t of [4.5e8, 3.85e8, 3.5e8, 3.46e8, 3.2e8, 3.05e8]) {
      expect(stemGains(t, NO_FLOOD_BASALT).insects, `t=${t}`).toBe(0)
    }
  })

  it('is audible from 300 Ma, right at the citation\'s own date', () => {
    expect(stemGains(3.0e8, NO_FLOOD_BASALT).insects).toBe(0) // exactly at the ramp's own start
    for (const t of [2.9e8, 2.6e8, 2.52e8]) {
      expect(stemGains(t, NO_FLOOD_BASALT).insects, `t=${t}`).toBeGreaterThan(0)
    }
  })
})

describe('stemGains: wing-hum fills the 325-300 Ma gap insects cannot honestly cover (2026-09-15 "wing-hum" amendment)', () => {
  it('is exactly 0 for every t >= 325 Ma, its own ramp start (Grimaldi & Engel 2005)', () => {
    for (const t of [4.5e8, 3.85e8, 3.5e8, 3.46e8, 3.3e8, 3.25e8]) {
      expect(stemGains(t, NO_FLOOD_BASALT)['wing-hum'], `t=${t}`).toBe(0)
    }
  })

  it('rises across 325 -> 320 Ma to its quiet plateau, then holds', () => {
    const mid = stemGains(3.22e8, NO_FLOOD_BASALT)['wing-hum']
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(0.06)
    expect(stemGains(3.2e8, NO_FLOOD_BASALT)['wing-hum']).toBeCloseTo(0.06, 5)
    expect(stemGains(3.1e8, NO_FLOOD_BASALT)['wing-hum']).toBeCloseTo(0.06, 5)
  })

  it('is well under forest across the 320-300 Ma window the human\'s "forest/swamp... insects" ask named', () => {
    for (const t of [3.2e8, 3.15e8, 3.1e8, 3.05e8]) {
      const gains = stemGains(t, NO_FLOOD_BASALT)
      expect(gains['wing-hum'], `t=${t}`).toBeCloseTo(0.06, 5)
      expect(gains['wing-hum']).toBeLessThan(gains.forest)
      expect(gains.forest, `forest at t=${t}`).toBeCloseTo(0.3, 5)
    }
  })

  it('is quiet: its plateau sits an order of magnitude below forest, a texture not a foreground', () => {
    expect(stemGains(3.1e8, NO_FLOOD_BASALT)['wing-hum']).toBeLessThan(0.1)
  })

  it('is at least 6 dB under forest at reference-trimmed playback level, not just raw curve gain', () => {
    // A raw curve-gain comparison (the test above) would still pass for a re-sourced clip whose
    // own level trim erased the intended headroom -- this asserts what a listener actually
    // hears: loudness_db + level_trim_db (`pipeline.audio.StemManifest.level_trim_db`) +
    // 20*log10(curve gain). Mirrors sources/audio-stems/stems.toml's attested loudness_db/
    // peak_dbfs for `forest` (-48.8 / -29.8, giving level_trim_db 18.8 -- re-sourced a fourth
    // time 2026-09-16 after an independent review found the third pick, though genuinely
    // non-stationary and frog/bird-free, was low-frequency wind rumble rather than leaf rustle)
    // and `wing-hum` (-24.3 / -5.9, giving level_trim_db -5.7) -- update these two pairs together
    // if either entry's attested levels change.
    const FOREST_EFFECTIVE_LOUDNESS_DB = -48.8 + 18.8
    const WING_HUM_EFFECTIVE_LOUDNESS_DB = -24.3 + -5.7
    const gains = stemGains(3.1e8, NO_FLOOD_BASALT)
    const forestLevelDb = FOREST_EFFECTIVE_LOUDNESS_DB + 20 * Math.log10(gains.forest)
    const wingHumLevelDb = WING_HUM_EFFECTIVE_LOUDNESS_DB + 20 * Math.log10(gains['wing-hum'])
    expect(forestLevelDb - wingHumLevelDb).toBeGreaterThanOrEqual(6)
  })

  it('persists, not recedes, once insects (stridulation) itself starts at 300 Ma -- both are audible together, not a handover', () => {
    for (const t of [2.9e8, 2.6e8, 2.48e8, 1.54e8, 9.0e7, 1.2e7, 1.0e4]) {
      const gains = stemGains(t, NO_FLOOD_BASALT)
      expect(gains['wing-hum'], `wing-hum at t=${t}`).toBeCloseTo(0.06, 5)
      expect(gains.insects, `insects at t=${t}`).toBeGreaterThan(0)
    }
  })

  it('is ducked by humanDominance exactly like insects, ~50% by 1830 (195 yr)', () => {
    const gains = stemGains(195, NO_FLOOD_BASALT)
    expect(gains['wing-hum']).toBeLessThan(0.06)
    expect(gains['wing-hum']).toBeGreaterThan(0)
    expect(gains['wing-hum']).toBeCloseTo(0.06 * (1 - 0.85 * humanDominance(195)), 5)
  })

  it('is never fully silenced by human dominance alone, only by the life ducks below', () => {
    expect(stemGains(0, NO_FLOOD_BASALT)['wing-hum']).toBeGreaterThan(0)
  })

  it('is silenced together with forest/insects/birds/mammals at the three barren, scene-local windows and through the K-Pg impact+aftermath', () => {
    for (const t of [3.37e7, 5.6e6, 3.0e8, 6.6e7]) {
      expect(stemGains(t, NO_FLOOD_BASALT)['wing-hum'], `t=${t}`).toBeLessThan(0.001)
    }
  })

  it('recovers to its plateau at the neighbouring scenes on each side of gondwana-ice-margin', () => {
    for (const t of [3.0496e8, 2.9698e8]) {
      expect(stemGains(t, NO_FLOOD_BASALT)['wing-hum'], `t=${t}`).toBeCloseTo(0.06, 2)
    }
  })
})

describe('stemGains: K-Pg impact silences forest/insects through the aftermath, recovering by 64.1 Ma (era-fit v3 fixes)', () => {
  it('forest and insects are still full right up to the impact instant', () => {
    const justBefore = stemGains(6.6043e7, NO_FLOOD_BASALT)
    expect(justBefore.forest).toBeCloseTo(0.3, 2)
    expect(justBefore.insects).toBeCloseTo(0.28, 2)
  })

  it('forest and insects are silenced at kpg-darkness (days after) and stay silenced through kpg-aftermath (a century after)', () => {
    for (const t of [6.604299999e7, 6.60429e7]) {
      const gains = stemGains(t, NO_FLOOD_BASALT)
      expect(gains.forest, `forest at t=${t}`).toBeLessThan(0.01)
      expect(gains.insects, `insects at t=${t}`).toBeLessThan(0.01)
    }
  })

  it('forest and insects fully recover by 64.1 Ma (Castle Rock rainforest, Johnson & Ellis 2002)', () => {
    const recovered = stemGains(6.41e7, NO_FLOOD_BASALT)
    expect(recovered.forest).toBeCloseTo(0.3, 2)
    expect(recovered.insects).toBeCloseTo(0.28, 2)
  })
})

describe('stemGains: three barren, scene-local windows silence forest/insects/birds/mammals at their own scene t (era-fit v3 fixes)', () => {
  const BARREN_SCENES: [label: string, t: number][] = [
    ['eocene-oligocene-icesheet', 3.37e7],
    ['messinian-salt-flats', 5.6e6],
    ['gondwana-ice-margin', 3.0e8],
  ]

  it.each(BARREN_SCENES)('forest/insects/birds/mammals are exactly 0 at %s\'s own t', (_label, t) => {
    const gains = stemGains(t, NO_FLOOD_BASALT)
    expect(gains.forest, 'forest').toBe(0)
    expect(gains.insects, 'insects').toBe(0)
    expect(gains.birds, 'birds').toBe(0)
    expect(gains.mammals, 'mammals').toBe(0)
  })

  it('recovers at the neighbouring scenes on each side of eocene-oligocene-icesheet', () => {
    for (const t of [4.1049e7, 2.4629e7]) {
      expect(stemGains(t, NO_FLOOD_BASALT).forest, `t=${t}`).toBeCloseTo(0.3, 2)
    }
  })

  it('recovers at the neighbouring scenes on each side of messinian-salt-flats', () => {
    for (const t of [6.261e6, 4.2332e6]) {
      expect(stemGains(t, NO_FLOOD_BASALT).forest, `t=${t}`).toBeCloseTo(0.3, 2)
    }
  })

  it('recovers at the neighbouring scenes on each side of gondwana-ice-margin', () => {
    for (const t of [3.0496e8, 2.9698e8]) {
      expect(stemGains(t, NO_FLOOD_BASALT).forest, `t=${t}`).toBeCloseTo(0.3, 2)
    }
  })
})

describe('stemGains: a dated Last Glacial Maximum bump restores wind for pleistocene-steppe (era-fit v3 fixes)', () => {
  it('is at its full bump gain exactly at 20 ka, pleistocene-steppe\'s own t', () => {
    expect(stemGains(2.0e4, NO_FLOOD_BASALT).wind).toBeCloseTo(0.65, 2)
  })

  it('is 0 at the window\'s own edges, so it does not leak into ice-age-europe-neanderthal (42 ka) or gobekli-tepe (11.5 ka)', () => {
    expect(stemGains(2.65e4, NO_FLOOD_BASALT).wind).toBe(0)
    expect(stemGains(1.9e4, NO_FLOOD_BASALT).wind).toBe(0)
    expect(stemGains(4.2e4, NO_FLOOD_BASALT).wind).toBe(0)
    expect(stemGains(1.15e4, NO_FLOOD_BASALT).wind).toBe(0)
  })
})

describe('stemGains: large-animal recedes earlier, clearing before archosaurs\' Jurassic rise (era-fit v3 fixes)', () => {
  it('is still full at 231 Ma (late-triassic-dinosaurs, dinosaurs\' own radiation) -- large synapsids/reptiles genuinely still dominate biomass there', () => {
    expect(stemGains(2.31e8, NO_FLOOD_BASALT)['large-animal']).toBeCloseTo(0.32, 2)
  })

  it('clears to exactly 0 by 201 Ma, unlike the original 175 Ma-clearing window that left it audible at 200 Ma', () => {
    expect(stemGains(2.01e8, NO_FLOOD_BASALT)['large-animal']).toBe(0)
    expect(stemGains(2.0e8, NO_FLOOD_BASALT)['large-animal']).toBe(0)
  })

  it('hands over to archosaurs mid-recession, both present', () => {
    const handover = stemGains(2.15e8, NO_FLOOD_BASALT)
    expect(handover['large-animal']).toBeGreaterThan(0)
    expect(handover.archosaurs).toBeGreaterThan(0)
  })
})

describe('stemGains: forest (era-fit v3, era-fit v3 fixes)', () => {
  it('rises from 0 to its full baseline across 385 -> 370 Ma and holds thereafter', () => {
    expect(stemGains(3.86e8, NO_FLOOD_BASALT).forest).toBe(0)
    expect(stemGains(3.7e8, NO_FLOOD_BASALT).forest).toBeCloseTo(0.3, 5)
    expect(stemGains(3.1e8, NO_FLOOD_BASALT).forest).toBeCloseTo(0.3, 5)
  })

  it('is silent before land ecosystems establish', () => {
    expect(stemGains(4.5e8, NO_FLOOD_BASALT).forest).toBe(0)
    expect(stemGains(EARTH_FORMATION, NO_FLOOD_BASALT).forest).toBe(0)
  })

  it('is ducked toward the present as human dominance rises, never silenced entirely', () => {
    const preIndustrial = stemGains(500, NO_FLOOD_BASALT).forest
    const present = stemGains(0, NO_FLOOD_BASALT).forest
    expect(present).toBeLessThan(preIndustrial)
    expect(present).toBeGreaterThan(0)
  })
})

describe('stemGains: shape invariants', () => {
  it('volcanic spikes measurably higher at a flood-basalt window than nearby unaffected t', () => {
    const siberianMid = (2.5e8 + 2.54e8) / 2
    const deccanMid = (6.56e7 + 6.63e7) / 2
    const baseline = stemGains(1.5e8, FLOOD_BASALT).volcanic

    expect(stemGains(siberianMid, FLOOD_BASALT).volcanic).toBeGreaterThan(baseline + 0.3)
    expect(stemGains(deccanMid, FLOOD_BASALT).volcanic).toBeGreaterThan(baseline + 0.3)
  })

  it('volcanic without any flood-basalt windows ramps down from the Hadean and is silent after 420 Ma', () => {
    expect(stemGains(4.0e9, NO_FLOOD_BASALT).volcanic).toBeCloseTo(0.75, 5)
    expect(stemGains(5.4e8, NO_FLOOD_BASALT).volcanic).toBeCloseTo(0.15, 5)
    for (const t of [4.2e8, 6.6043e7, 5.2e3, 0]) {
      expect(stemGains(t, NO_FLOOD_BASALT).volcanic, `t=${t}`).toBe(0)
    }
  })

  it('wind is a full pre-land bed early, softened by land plants, then exactly 0 past the Devonian/Carboniferous boundary', () => {
    expect(stemGains(EARTH_FORMATION, NO_FLOOD_BASALT).wind).toBeCloseTo(0.6, 5)
    expect(stemGains(4.2e8, NO_FLOOD_BASALT).wind).toBeGreaterThan(0.3)
    expect(stemGains(0, NO_FLOOD_BASALT).wind).toBe(0)
  })

  it('storm is a flat placeholder pre-land, then exactly 0', () => {
    expect(stemGains(EARTH_FORMATION, NO_FLOOD_BASALT).storm).toBe(0.22)
    expect(stemGains(0, NO_FLOOD_BASALT).storm).toBe(0)
  })

  it('every stem stays within [0, 1] across a dense sweep of t, including near flood-basalt windows', () => {
    const steps = 2000
    const sweep = [...Array.from({ length: steps + 1 }, (_, i) => (EARTH_FORMATION * i) / steps), ...Array.from({ length: 301 }, (_, i) => i)]
    for (const t of sweep) {
      const gains = stemGains(t, FLOOD_BASALT)
      for (const id of AMBIENCE_STEM_IDS) {
        expect(gains[id], `${id} at t=${t}`).toBeGreaterThanOrEqual(0)
        expect(gains[id], `${id} at t=${t}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('is pure: identical t and windows content always produce the same result', () => {
    const windows = [{ tMin: 2.5e8, tMax: 2.54e8 }]
    expect(stemGains(1.2e8, windows)).toEqual(stemGains(1.2e8, [...windows]))
  })
})

describe('humanDominance', () => {
  it('is 0 before the industrial revolution, 1 at present, and never decreases toward present', () => {
    expect(humanDominance(265)).toBe(0)
    expect(humanDominance(1.0e6)).toBe(0)
    expect(humanDominance(0)).toBeCloseTo(1, 10)
    let previous = humanDominance(300)
    for (let t = 299; t >= 0; t--) {
      const current = humanDominance(t)
      expect(current, `t=${t}`).toBeGreaterThanOrEqual(previous)
      previous = current
    }
  })
})
