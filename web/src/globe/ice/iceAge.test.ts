import { describe, expect, it } from 'vitest'

import type { SeriesData } from '@/data/curated'
import { createScalarLayer } from '@/layers'
import type { LayerManifest } from '@/types/manifest'

import { SYMLOG_C, symlogWarp } from '../effects/math'
import {
  ANTARCTIC_ONSET_EASE_WARP,
  ANTARCTIC_ONSET_T,
  GLACIAL_ICE_CAPTION,
  iceAgeCaption,
  iceAgeLayersFrom,
  type IceAgeLayers,
  iceAgeStateAt,
  NO_ICE_AGE,
  NORTHERN_ONSET_EASE_WARP,
  NORTHERN_ONSET_T,
  onsetGate,
} from './iceAge'

/** A few real rows of the curated series (sources/lr04: t = age + 75 years). */
function series(id: string, unit: string, values: readonly (readonly [number, number])[]): SeriesData {
  return { id, unit, interpolation: 'linear', samples: values.map(([t, value]) => ({ t, value, lower: null, upper: null })), gaps: [] }
}

function entry(id: string, series: SeriesData): LayerManifest {
  const ts = series.samples.map((s) => s.t)
  return {
    id,
    name: id,
    surface: 'globe',
    dataKind: 'scalar',
    timeDomain: [Math.min(...ts), Math.max(...ts)],
    source: 'lr04',
    chartable: false,
    data: `layers/${id}.json`,
  }
}

const ICE_VOLUME = series('ice_volume', 'LGM = 1', [
  [75, 0],
  [21_075, 0.9941],
  [120_075, 0.0237],
  [2_700_075, 0.2249],
  [5_320_075, -0.1893],
])
const SEA_LEVEL = series('sea_level', 'm', [
  [75, 0],
  [21_075, -133.2],
  [120_075, -3.2],
  [2_700_075, -30.1],
  [5_320_075, 25.4],
])
const LAYERS: IceAgeLayers = {
  iceVolume: createScalarLayer(entry('ice_volume', ICE_VOLUME), ICE_VOLUME),
  seaLevel: createScalarLayer(entry('sea_level', SEA_LEVEL), SEA_LEVEL),
}

/** `onset`, moved `fraction` of an ease width older in warp space. */
function olderThan(onset: number, easeWarp: number, fraction: number): number {
  return SYMLOG_C * Math.expm1(symlogWarp(onset) + fraction * easeWarp)
}

describe('onsetGate', () => {
  it('is 1 at and after the onset', () => {
    expect(onsetGate(NORTHERN_ONSET_T, NORTHERN_ONSET_T, NORTHERN_ONSET_EASE_WARP)).toBe(1)
    expect(onsetGate(0, NORTHERN_ONSET_T, NORTHERN_ONSET_EASE_WARP)).toBe(1)
  })

  it('eases to 0 across one ease width before the onset', () => {
    const halfway = onsetGate(olderThan(NORTHERN_ONSET_T, NORTHERN_ONSET_EASE_WARP, 0.5), NORTHERN_ONSET_T, NORTHERN_ONSET_EASE_WARP)
    expect(halfway).toBeCloseTo(0.5, 6)
    expect(onsetGate(olderThan(NORTHERN_ONSET_T, NORTHERN_ONSET_EASE_WARP, 1), NORTHERN_ONSET_T, NORTHERN_ONSET_EASE_WARP)).toBe(0)
  })
})

describe('iceAgeLayersFrom', () => {
  it('pairs the two LR04 layers by id', () => {
    const map = new Map([
      ['ice_volume', LAYERS.iceVolume],
      ['sea_level', LAYERS.seaLevel],
    ])
    expect(iceAgeLayersFrom(map)).toEqual(LAYERS)
  })

  it('is null unless both are published', () => {
    expect(iceAgeLayersFrom(new Map([['ice_volume', LAYERS.iceVolume]]))).toBeNull()
  })
})

describe('iceAgeStateAt', () => {
  it('has no ice at all before the Antarctic onset', () => {
    expect(iceAgeStateAt(olderThan(ANTARCTIC_ONSET_T, ANTARCTIC_ONSET_EASE_WARP, 1), LAYERS)).toEqual(NO_ICE_AGE)
    expect(iceAgeStateAt(50e6, LAYERS)).toEqual(NO_ICE_AGE)
  })

  it('has Antarctica alone, at its unscaled extent, between the onsets and outside LR04', () => {
    expect(iceAgeStateAt(10e6, LAYERS)).toEqual({ iceVolume: 0, seaLevelM: 0, northernGate: 0, antarcticGate: 1 })
  })

  it('reads the LGM from the layers', () => {
    expect(iceAgeStateAt(21_075, LAYERS)).toEqual({ iceVolume: 0.9941, seaLevelM: -133.2, northernGate: 1, antarcticGate: 1 })
  })

  it('opens the Northern sheets at their onset with LR04 already covering it', () => {
    expect(iceAgeStateAt(NORTHERN_ONSET_T, LAYERS).northernGate).toBe(1)
    expect(iceAgeStateAt(olderThan(NORTHERN_ONSET_T, NORTHERN_ONSET_EASE_WARP, 1), LAYERS).northernGate).toBe(0)
  })

  it('keeps Antarctica at its present extent when the layers are not published', () => {
    expect(iceAgeStateAt(21_075, null)).toEqual({ iceVolume: 0, seaLevelM: 0, northernGate: 1, antarcticGate: 1 })
  })

})

describe('iceAgeCaption', () => {
  it('labels a glacial as schematic', () => {
    expect(iceAgeCaption(iceAgeStateAt(21_075, LAYERS))).toBe(GLACIAL_ICE_CAPTION)
  })

  it('is empty in an interglacial or before the Northern onset', () => {
    for (const t of [0, 120_075, 10e6]) expect(iceAgeCaption(iceAgeStateAt(t, LAYERS))).toBe('')
  })
})
