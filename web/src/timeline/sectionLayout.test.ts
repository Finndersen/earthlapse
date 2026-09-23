import { describe, expect, it } from 'vitest'

import { createLinearScale, createSymlogScale } from './scale'
import { layoutSectionBands, type SectionBandLayout } from './sectionLayout'
import { childSections, sectionById, type TimelineSection } from './sections'

function expectContiguous(bands: readonly SectionBandLayout[]): void {
  expect(bands[0]!.left).toBe(0)
  for (let i = 1; i < bands.length; i++) {
    expect(bands[i]!.left).toBeCloseTo(bands[i - 1]!.left + bands[i - 1]!.width, 12)
  }
  expect(bands.reduce((sum, b) => sum + b.width, 0)).toBeCloseTo(1, 12)
}

/** A real section id with controlled label and window, for exact pixel assertions. */
function fakeSection(id: TimelineSection['id'], overrides: Partial<TimelineSection>): TimelineSection {
  return { ...sectionById(id), ...overrides }
}

function floorPx(label: string): number {
  return Math.max(28, label.length * 7 + 14)
}

describe('layoutSectionBands', () => {
  it('is proportional to the drawn scale, with every label shown in full, on a very wide strip', () => {
    const holocene = sectionById('holocene')
    const children = childSections('holocene')
    const { bands, contentWidthPx } = layoutSectionBands(children, createLinearScale(holocene.window), 100_000)
    expect(contentWidthPx).toBe(100_000) // every floor fits comfortably — content is the strip itself
    expectContiguous(bands)
    expect(bands.map((b) => b.section.id)).toEqual(children.map((c) => c.id))
    expect(bands.every((b) => b.labelForm === 'full')).toBe(true)
    bands.forEach((band) => {
      expect(band.width).toBeCloseTo((band.section.window[1] - band.section.window[0]) / holocene.window[1], 12)
    })
  })

  it('lifts a band whose natural width is a sliver but whose label is long, and takes the room from wider siblings', () => {
    const sections = [
      // A tiny 5-of-300 sliver, but a label long enough that even its abbreviation needs 67.8px.
      fakeSection('hadean', { label: 'A very long section name indeed', abbreviation: 'Long name', window: [295, 300] }),
      fakeSection('archean', { label: 'B', abbreviation: 'B', window: [100, 295] }), // 195-of-300
      fakeSection('proterozoic', { label: 'C', abbreviation: 'C', window: [0, 100] }), // 100-of-300
    ]
    const scale = createLinearScale([0, 300])
    const widthPx = 300
    const { bands, contentWidthPx } = layoutSectionBands(sections, scale, widthPx)
    expect(contentWidthPx).toBe(widthPx) // still fits — every floor sums under 300px
    expectContiguous(bands)

    const longNamed = bands.find((b) => b.section.id === 'hadean')!
    const natural = 5 / 300
    expect(longNamed.width).toBeGreaterThan(natural) // lifted well above its natural sliver
    expect(longNamed.width * widthPx).toBeCloseTo(9 * 7 + 14, 6) // exactly its abbreviation's floor
    expect(longNamed.labelForm).toBe('abbr') // the full ~30-character label still doesn't fit

    const wideArchean = bands.find((b) => b.section.id === 'archean')!
    const wideProterozoic = bands.find((b) => b.section.id === 'proterozoic')!
    expect(wideArchean.width).toBeLessThan(195 / 300) // gave up room to the lifted band
    expect(wideProterozoic.width).toBeLessThan(100 / 300)
    expect(wideArchean.labelForm).toBe('full')
    expect(wideProterozoic.labelForm).toBe('full')
  })

  it(
    'grows the content width to fit every floor exactly, never shrinking a band below it, when the sum of every ' +
      'floor exceeds the strip',
    () => {
      const sections = [
        fakeSection('hadean', { label: 'Short', abbreviation: 'Short', window: [200, 300] }),
        fakeSection('archean', { label: 'A rather longer name', abbreviation: 'Longer name', window: [100, 200] }),
      ]
      const scale = createLinearScale([0, 300])
      const stripWidthPx = 5 // far too narrow for either floor
      const { bands, contentWidthPx } = layoutSectionBands(sections, scale, stripWidthPx)
      const floorShort = floorPx('Short')
      const floorLong = floorPx('Longer name')
      // The content grows to fit both floors exactly, rather than squeezing them into 5px.
      expect(contentWidthPx).toBe(floorShort + floorLong)
      expect(contentWidthPx).toBeGreaterThan(stripWidthPx)
      expectContiguous(bands)
      // Every band gets *exactly* its own required floor width in the grown content — not a
      // proportional share of the too-narrow strip, and never less than its floor.
      expect(bands[0]!.width * contentWidthPx).toBeCloseTo(floorShort, 9)
      expect(bands[1]!.width * contentWidthPx).toBeCloseTo(floorLong, 9)
    },
  )

  it('falls back to plain proportions, with every label full, on an unmeasured strip', () => {
    const scale = createSymlogScale(sectionById('earth').window)
    const { bands, contentWidthPx } = layoutSectionBands(childSections('earth'), scale, 0)
    expect(contentWidthPx).toBe(0)
    expectContiguous(bands)
    expect(bands.every((b) => b.labelForm === 'full')).toBe(true)
    const hadean = bands[0]!
    expect(hadean.width).toBeCloseTo(Math.abs(scale.toUnit(4031e6) - scale.toUnit(4.567e9)), 12)
  })

  it('clips sections that extend past a narrower drawn window', () => {
    const scale = createSymlogScale([0, 100e6])
    const { bands } = layoutSectionBands(childSections('mesozoic'), scale, 0)
    expectContiguous(bands)
    expect(bands.map((b) => b.width)).toEqual([0, 0, 1])
  })

  it(
    "grows past a real phone strip width instead of shrinking any band below its floor, for the earth level's six " +
      'sections',
    () => {
      const scale = createSymlogScale(sectionById('earth').window)
      const stripWidthPx = 358
      const children = childSections('earth')
      const { bands, contentWidthPx } = layoutSectionBands(children, scale, stripWidthPx)
      const totalFloor = children.reduce((sum, s) => sum + floorPx(s.abbreviation), 0)
      expect(totalFloor).toBeGreaterThan(stripWidthPx) // sanity: this really is the overflow case
      expect(contentWidthPx).toBeCloseTo(totalFloor, 6)
      expectContiguous(bands)
      for (const section of children) {
        const band = bands.find((b) => b.section.id === section.id)!
        expect(band.width * contentWidthPx).toBeCloseTo(floorPx(section.abbreviation), 6)
      }
    },
  )
})
