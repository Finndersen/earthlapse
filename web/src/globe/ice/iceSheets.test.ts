import { describe, expect, it } from 'vitest'

import {
  domeRadius,
  ICE_SHEET_DOME_COUNT,
  ICE_SHEET_DOMES,
  ICE_SHEETS_GLSL,
  type IceSheetDome,
  type IceSheetDrivers,
  NORTHERN_GROWTH_THRESHOLD,
  northernGrowth,
  writeIceSheetRadii,
} from './iceSheets'

function dome(id: string): IceSheetDome {
  const found = ICE_SHEET_DOMES.find((d) => d.id === id)
  if (found === undefined) throw new Error(`no dome ${id}`)
  return found
}

const PRESENT: IceSheetDrivers = { iceVolume: 0, northernGate: 1, antarcticGate: 1 }
const LGM: IceSheetDrivers = { iceVolume: 1, northernGate: 1, antarcticGate: 1 }
const MIOCENE: IceSheetDrivers = { iceVolume: 0, northernGate: 0, antarcticGate: 1 }
const EOCENE: IceSheetDrivers = { iceVolume: 0, northernGate: 0, antarcticGate: 0 }

describe('northernGrowth', () => {
  it('is 0 up to the Holocene noise threshold and 1 at the LGM', () => {
    expect(northernGrowth(-0.2)).toBe(0)
    expect(northernGrowth(NORTHERN_GROWTH_THRESHOLD)).toBe(0)
    expect(northernGrowth(1)).toBe(1)
  })

  it('rises steeply early in a glacial, as radius ~ volume^0.4', () => {
    expect(northernGrowth(0.5)).toBeCloseTo(Math.pow((0.5 - NORTHERN_GROWTH_THRESHOLD) / (1 - NORTHERN_GROWTH_THRESHOLD), 0.4), 12)
    expect(northernGrowth(0.5)).toBeGreaterThan(0.7)
  })

  it('caps the largest glacials a little past the LGM', () => {
    expect(northernGrowth(1.5)).toBe(northernGrowth(3))
    expect(northernGrowth(3)).toBeLessThan(1.15)
  })
})

describe('domeRadius', () => {
  it('leaves only Greenland and Antarctica at present', () => {
    const radii = Object.fromEntries(ICE_SHEET_DOMES.map((d) => [d.id, domeRadius(d, PRESENT)]))
    expect(radii).toEqual(Object.fromEntries(ICE_SHEET_DOMES.map((d) => [d.id, d.presentRadius])))
    expect(ICE_SHEET_DOMES.filter((d) => d.presentRadius > 0).map((d) => d.id)).toEqual(['antarctica', 'greenland'])
  })

  it('grows every Northern dome to its LGM radius at the LGM', () => {
    for (const d of ICE_SHEET_DOMES.filter((x) => x.hemisphere === 'north')) {
      expect(domeRadius(d, LGM)).toBeCloseTo(d.lgmRadius, 9)
    }
  })

  it('moves Antarctica only modestly with ice volume', () => {
    const antarctica = dome('antarctica')
    expect(domeRadius(antarctica, LGM)).toBe(antarctica.lgmRadius)
    expect(domeRadius(antarctica, { ...PRESENT, iceVolume: -0.2 })).toBeLessThan(antarctica.presentRadius)
    expect(domeRadius(antarctica, { ...PRESENT, iceVolume: -0.2 })).toBeGreaterThan(antarctica.presentRadius - 1.5)
  })

  it('has Antarctica alone between the onsets', () => {
    const drawn = ICE_SHEET_DOMES.filter((d) => domeRadius(d, MIOCENE) > 0).map((d) => d.id)
    expect(drawn).toEqual(['antarctica'])
  })

  it('has no ice before the Antarctic onset', () => {
    expect(ICE_SHEET_DOMES.map((d) => domeRadius(d, EOCENE))).toEqual(ICE_SHEET_DOMES.map(() => 0))
  })

  it('scales with the gates, so an onset grows the sheets from nothing', () => {
    expect(domeRadius(dome('greenland'), { ...PRESENT, northernGate: 0.5 })).toBe(dome('greenland').presentRadius / 2)
  })
})

describe('writeIceSheetRadii', () => {
  it('fills the given array in dome order and returns it', () => {
    const out = new Float32Array(ICE_SHEET_DOME_COUNT)
    expect(writeIceSheetRadii(LGM, out)).toBe(out)
    expect(Array.from(out)).toEqual(ICE_SHEET_DOMES.map((d) => Math.fround(domeRadius(d, LGM))))
  })

  it('rejects an array of the wrong size', () => {
    expect(() => writeIceSheetRadii(LGM, new Float32Array(ICE_SHEET_DOME_COUNT - 1))).toThrow()
  })
})

describe('ICE_SHEETS_GLSL', () => {
  it('declares one radius slot and one dome evaluation per dome', () => {
    expect(ICE_SHEETS_GLSL).toContain(`uniform float uIceSheetRadius[${ICE_SHEET_DOME_COUNT}];`)
    expect(ICE_SHEETS_GLSL.match(/ice = max\(ice, iceDome\(/g)).toHaveLength(ICE_SHEET_DOME_COUNT)
  })
})
