import { describe, expect, it } from 'vitest'

import type { TimelineEvent } from '@/types/layer'

import { buildRailEntries, declutterRailLabels, railEntryAtFraction, type RailEntry } from './rail'

function event(id: string, tMin: number): TimelineEvent {
  return { id, label: id, tMin, tMax: tMin, importance: 0.5, description: '', citation: '' }
}

describe('buildRailEntries', () => {
  it('cuts a section abbreviation wider than the rail down to 6 characters plus a period', () => {
    const events = [event('a', 1e9), event('b', 400e6), event('c', 200)]
    const entries = buildRailEntries(events)
    expect(entries.map((e) => e.abbreviation)).toEqual(['Proter.', 'Paleoz.', 'Indust.'])
  })

  it('emits one entry per section change, in list order (oldest first)', () => {
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

  it('hides a label too close to the last shown one', () => {
    const entries = [fakeEntry('a', 0), fakeEntry('b', 0.01)]
    expect(declutterRailLabels(entries, 200, 20).map((p) => p.visible)).toEqual([true, false])
  })

  it('measures the gap from the last SHOWN label, not the previous entry', () => {
    const entries = [fakeEntry('a', 0), fakeEntry('b', 0.05), fakeEntry('c', 0.1)]
    expect(declutterRailLabels(entries, 200, 20).map((p) => p.visible)).toEqual([true, false, true])
  })

})
