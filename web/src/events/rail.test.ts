import { describe, expect, it } from 'vitest'

import type { TimelineEvent } from '@/types/layer'

import { buildRailEntries, declutterRailLabels, railEntryAtFraction, type RailEntry } from './rail'

function event(id: string, tMin: number): TimelineEvent {
  return { id, label: id, tMin, tMax: tMin, importance: 0.5, description: '', citation: '' }
}

describe('buildRailEntries', () => {
  it('returns nothing for an empty list', () => {
    expect(buildRailEntries([])).toEqual([])
  })

  it('cuts a section abbreviation wider than the rail down to 6 characters plus a period', () => {
    // Proterozoic ("Proteroz.") -> Paleozoic ("Paleozoic", no shorter form of its own) ->
    // Industrial age ("Industrial") — all wider than a narrow rail column can hold.
    const events = [event('a', 1e9), event('b', 400e6), event('c', 200)]
    const entries = buildRailEntries(events)
    expect(entries.map((e) => e.abbreviation)).toEqual(['Proter.', 'Paleoz.', 'Indust.'])
  })

  it('leaves an abbreviation already within the rail label budget unchanged', () => {
    const events = [event('a', 4.5e9), event('b', 0)] // Hadean ("Hadean") -> Modern ("Modern")
    const entries = buildRailEntries(events)
    expect(entries.map((e) => e.abbreviation)).toEqual(['Hadean', 'Modern'])
  })

  it('emits one entry per section change, in list order (oldest first)', () => {
    // Archean (older than the Proterozoic base, 2.5 Ga) -> Paleozoic (post-Phanerozoic, pre-
    // Mesozoic base 251.9 Ma) -> Holocene human-history ("Prehistory", pre-agriculture).
    const events = [
      event('a', 3.5e9),
      event('b', 3.4e9),
      event('c', 400e6),
      event('d', 20_000),
    ]
    const entries = buildRailEntries(events)
    expect(entries.map((e) => e.startIndex)).toEqual([0, 2, 3])
    expect(entries[0]!.label).toBe('Archean')
    expect(entries[1]!.label).toBe('Paleozoic')
  })

  it('spaces entries by list position (event count), not by time span', () => {
    // Nine consecutive Paleozoic events, then one Mesozoic event: the Mesozoic entry sits at
    // 9/10 of the rail — nowhere near proportional to the two eras' actual, wildly unequal spans.
    const events = [
      ...Array.from({ length: 9 }, (_, i) => event(`p${i}`, 400e6 - i * 1e6)),
      event('m', 200e6),
    ]
    const entries = buildRailEntries(events)
    expect(entries).toHaveLength(2)
    expect(entries[0]!.offset).toBe(0)
    expect(entries[1]!.offset).toBe(0.9)
  })

  it('switches to human-history sections inside the Holocene, not one "Holocene" entry', () => {
    const events = [event('old', 9000), event('recent', 200)]
    const entries = buildRailEntries(events)
    expect(entries.map((e) => e.label)).not.toContain('Holocene')
    expect(entries).toHaveLength(2)
  })
})

describe('railEntryAtFraction', () => {
  const entries = buildRailEntries([event('a', 3.5e9), event('b', 400e6), event('c', 200e6), event('d', 20_000)])

  it('returns null for an empty rail', () => {
    expect(railEntryAtFraction([], 0.5)).toBeNull()
  })

  it('resolves a fraction to the last entry at or before it', () => {
    expect(railEntryAtFraction(entries, 0)!.startIndex).toBe(entries[0]!.startIndex)
    expect(railEntryAtFraction(entries, 0.99)!.startIndex).toBe(entries[entries.length - 1]!.startIndex)
  })

  it('clamps an out-of-range fraction instead of throwing', () => {
    expect(railEntryAtFraction(entries, -1)).toEqual(railEntryAtFraction(entries, 0))
    expect(railEntryAtFraction(entries, 2)).toEqual(railEntryAtFraction(entries, 1))
  })
})

describe('declutterRailLabels', () => {
  function fakeEntry(sectionId: string, offset: number): RailEntry {
    return { sectionId: sectionId as RailEntry['sectionId'], label: sectionId, abbreviation: sectionId, startIndex: 0, offset }
  }

  it('returns one placement per entry, never dropping an entry outright', () => {
    const entries = [fakeEntry('a', 0), fakeEntry('b', 0.001), fakeEntry('c', 0.5)]
    const placements = declutterRailLabels(entries, 200)
    expect(placements.map((p) => p.entry.sectionId)).toEqual(['a', 'b', 'c'])
  })

  it('always shows the oldest (first) entry', () => {
    const entries = [fakeEntry('a', 0), fakeEntry('b', 0.001)]
    expect(declutterRailLabels(entries, 200, 50)[0]!.visible).toBe(true)
  })

  it('hides a label too close to the last shown one', () => {
    // 200px rail: 'b' sits 2px below 'a', well under a 20px gap.
    const entries = [fakeEntry('a', 0), fakeEntry('b', 0.01)]
    expect(declutterRailLabels(entries, 200, 20).map((p) => p.visible)).toEqual([true, false])
  })

  it('measures the gap from the last SHOWN label, not the previous entry', () => {
    // a@0px, b@10px (hidden — 10px from a), c@20px (20px from a, the last *shown* label).
    const entries = [fakeEntry('a', 0), fakeEntry('b', 0.05), fakeEntry('c', 0.1)]
    expect(declutterRailLabels(entries, 200, 20).map((p) => p.visible)).toEqual([true, false, true])
  })

  it('falls back to MIN_RAIL_LABEL_GAP_PX when no gap is given', () => {
    // 1px apart on a 1000px rail — under any sane gap, including the default.
    const entries = [fakeEntry('a', 0), fakeEntry('b', 0.001)]
    expect(declutterRailLabels(entries, 1000)[1]!.visible).toBe(false)
  })
})
