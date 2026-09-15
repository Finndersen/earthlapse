import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import {
  childSectionAt,
  childSections,
  continuationSection,
  eraNameForTime,
  nextSibling,
  parentSection,
  previousSibling,
  previousSiblingStep,
  ROOT_SECTION_ID,
  sectionAt,
  sectionById,
  sectionContains,
  sectionEntryT,
  sectionFollowingT,
  sectionPath,
  sectionSymlogKnee,
  type SectionId,
  type TimelineSection,
} from './sections'
import { SYMLOG_C, symlogKnee } from './scale'

function allSections(): TimelineSection[] {
  const out: TimelineSection[] = []
  const visit = (id: SectionId): void => {
    out.push(sectionById(id))
    for (const child of childSections(id)) visit(child.id)
  }
  visit(ROOT_SECTION_ID)
  return out
}

const ids = (sections: readonly TimelineSection[]): string[] => sections.map((s) => s.id)

describe('section tree', () => {
  it('roots at Earth over the full domain', () => {
    expect(sectionById('earth')).toEqual({
      id: 'earth',
      label: 'Earth',
      abbreviation: 'Earth',
      parentId: null,
      window: [0, EARTH_FORMATION],
      citation: expect.stringContaining('v2024/12'),
    })
  })

  it('gives every section a non-empty abbreviation no longer than its full label', () => {
    for (const section of allSections()) {
      expect(section.abbreviation.length).toBeGreaterThan(0)
      expect(section.abbreviation.length).toBeLessThanOrEqual(section.label.length)
    }
  })

  it('tiles every parent exactly with its children, oldest first', () => {
    for (const section of allSections()) {
      const children = childSections(section.id)
      if (children.length === 0) continue
      expect(children[0]!.window[1]).toBe(section.window[1])
      expect(children.at(-1)!.window[0]).toBe(section.window[0])
      for (let i = 1; i < children.length; i++) {
        expect(children[i]!.window[1]).toBe(children[i - 1]!.window[0])
      }
      for (const child of children) {
        expect(child.window[0]).toBeLessThan(child.window[1])
        expect(child.parentId).toBe(section.id)
      }
    }
  })

  it('gives every section a citation', () => {
    for (const section of allSections()) expect(section.citation.length).toBeGreaterThan(20)
  })

  it('has the approved hierarchy', () => {
    expect(ids(childSections('earth'))).toEqual(['hadean', 'archean', 'proterozoic', 'paleozoic', 'mesozoic', 'cenozoic'])
    expect(ids(childSections('proterozoic'))).toEqual(['paleoproterozoic', 'mesoproterozoic', 'neoproterozoic'])
    expect(ids(childSections('neoproterozoic'))).toEqual(['tonian', 'cryogenian', 'ediacaran'])
    expect(ids(childSections('paleozoic'))).toEqual(['cambrian', 'ordovician', 'silurian', 'devonian', 'carboniferous', 'permian'])
    expect(ids(childSections('mesozoic'))).toEqual(['triassic', 'jurassic', 'cretaceous'])
    expect(ids(childSections('cenozoic'))).toEqual(['paleogene', 'neogene', 'quaternary'])
    expect(ids(childSections('quaternary'))).toEqual(['pleistocene', 'holocene'])
    expect(ids(childSections('holocene'))).toEqual([
      'first-farmers',
      'ancient-civilisations',
      'medieval-world',
      'early-modern',
      'industrial-age',
      'modern',
    ])
    expect(childSections('hadean')).toEqual([])
    expect(childSections('modern')).toEqual([])
  })

  it('uses the ICS v2024/12 base ages', () => {
    expect(sectionById('hadean').window).toEqual([4031e6, EARTH_FORMATION])
    expect(sectionById('cretaceous').window).toEqual([66e6, 143.1e6])
    expect(sectionById('ordovician').window).toEqual([443.1e6, 486.85e6])
    expect(sectionById('neogene').window).toEqual([2.58e6, 23.04e6])
    expect(sectionById('cryogenian').window).toEqual([635e6, 720e6])
  })

  it('shifts the Holocene base from b2k onto the AD 2025 present and dates human sections from it', () => {
    expect(sectionById('holocene').window).toEqual([0, 11_725])
    expect(sectionById('first-farmers').window).toEqual([5225, 11_725])
    expect(sectionById('ancient-civilisations').window).toEqual([1525, 5225])
    expect(sectionById('medieval-world').window).toEqual([525, 1525])
    expect(sectionById('early-modern').window).toEqual([265, 525])
    expect(sectionById('industrial-age').window).toEqual([111, 265])
    expect(sectionById('modern').window).toEqual([0, 111])
  })
})

describe('navigation', () => {
  it('sectionPath runs from the root to the section', () => {
    expect(sectionPath('industrial-age').map((s) => s.label)).toEqual(['Earth', 'Cenozoic', 'Quaternary', 'Holocene', 'Industrial age'])
    expect(ids(sectionPath('earth'))).toEqual(['earth'])
  })

  it('parentSection climbs one level and stops at the root', () => {
    expect(parentSection('cretaceous')?.id).toBe('mesozoic')
    expect(parentSection('earth')).toBeUndefined()
  })

  it('nextSibling is the younger neighbour within the same parent only', () => {
    expect(nextSibling('cambrian')?.id).toBe('ordovician')
    expect(nextSibling('permian')).toBeUndefined()
    expect(nextSibling('earth')).toBeUndefined()
  })

  it('previousSibling is the older neighbour within the same parent only', () => {
    expect(previousSibling('ordovician')?.id).toBe('cambrian')
    expect(previousSibling('cambrian')).toBeUndefined()
    expect(previousSibling('earth')).toBeUndefined()
  })

  it('sectionContains includes both edges', () => {
    const industrial = sectionById('industrial-age')
    expect(sectionContains(industrial, 111)).toBe(true)
    expect(sectionContains(industrial, 265)).toBe(true)
    expect(sectionContains(industrial, 110.9)).toBe(false)
  })

  it('childSectionAt gives a shared boundary to the younger child', () => {
    expect(childSectionAt('earth', 66e6)?.id).toBe('cenozoic')
    expect(childSectionAt('earth', 1e8)?.id).toBe('mesozoic')
    expect(childSectionAt('modern', 50)).toBeUndefined()
    expect(childSectionAt('holocene', 1e6)).toBeUndefined()
  })

  it('sectionAt resolves to the requested depth, stopping at a leaf', () => {
    expect(sectionAt(1e8, 0).id).toBe('earth')
    expect(sectionAt(1e8, 1).id).toBe('mesozoic')
    expect(sectionAt(1e8, 5).id).toBe('cretaceous')
    expect(sectionAt(150, 99).id).toBe('industrial-age')
    expect(sectionAt(0, 99).id).toBe('modern')
    expect(sectionAt(EARTH_FORMATION, 99).id).toBe('hadean')
  })

  it('sectionAt throws outside the domain', () => {
    expect(() => sectionAt(-1, 1)).toThrow()
    expect(() => sectionAt(EARTH_FORMATION + 1, 1)).toThrow()
  })

  it('eraNameForTime names the top-level section, the younger one on a boundary', () => {
    expect(eraNameForTime(EARTH_FORMATION)).toBe('Hadean')
    expect(eraNameForTime(3.5e9)).toBe('Archean')
    expect(eraNameForTime(1e9)).toBe('Proterozoic')
    expect(eraNameForTime(4e8)).toBe('Paleozoic')
    expect(eraNameForTime(1e8)).toBe('Mesozoic')
    expect(eraNameForTime(66e6)).toBe('Cenozoic')
    expect(eraNameForTime(0)).toBe('Cenozoic')
    expect(() => eraNameForTime(-1)).toThrow()
  })
})

describe('continuationSection (playback continues, ADR-024)', () => {
  it('moves to the next sibling', () => {
    expect(continuationSection('industrial-age')?.id).toBe('modern')
    expect(continuationSection('pleistocene')?.id).toBe('holocene')
    expect(continuationSection('tonian')?.id).toBe('cryogenian')
  })

  it("climbs to the parent's next sibling after the last child", () => {
    expect(continuationSection('permian')?.id).toBe('mesozoic')
    expect(continuationSection('ediacaran')?.id).toBe('paleozoic')
    expect(continuationSection('neoproterozoic')?.id).toBe('paleozoic')
  })

  it('has nowhere to go exactly for sections that end at the present', () => {
    for (const section of allSections()) {
      const next = continuationSection(section.id)
      expect(next === undefined).toBe(section.window[0] === 0)
      if (next !== undefined) expect(next.window[1]).toBe(section.window[0])
    }
  })
})

describe('previousSiblingStep (the "previous section" keyboard shortcut and breadcrumb button)', () => {
  it('moves to the previous sibling', () => {
    expect(previousSiblingStep('modern')?.id).toBe('industrial-age')
    expect(previousSiblingStep('holocene')?.id).toBe('pleistocene')
    expect(previousSiblingStep('cryogenian')?.id).toBe('tonian')
  })

  it("climbs to the parent's previous sibling before the first child", () => {
    expect(previousSiblingStep('triassic')?.id).toBe('paleozoic')
    expect(previousSiblingStep('cambrian')?.id).toBe('proterozoic')
    expect(previousSiblingStep('paleoproterozoic')?.id).toBe('archean')
  })

  it("is undefined only in the tree's very first branch (the Hadean, and only there)", () => {
    const firstBranch = new Set(sectionPath('hadean').map((s) => s.id))
    for (const section of allSections()) {
      const previous = previousSiblingStep(section.id)
      expect(previous === undefined).toBe(firstBranch.has(section.id))
      if (previous !== undefined) expect(previous.window[0]).toBe(section.window[1])
    }
  })
})

describe('sectionFollowingT', () => {
  it('stays put while t is inside, including on either edge', () => {
    expect(sectionFollowingT('industrial-age', 200)).toBe('industrial-age')
    expect(sectionFollowingT('industrial-age', 111)).toBe('industrial-age')
    expect(sectionFollowingT('industrial-age', 265)).toBe('industrial-age')
    expect(sectionFollowingT('earth', 1e9)).toBe('earth')
  })

  it('moves into the sibling playback has just crossed into', () => {
    expect(sectionFollowingT('industrial-age', 110)).toBe('modern')
    expect(sectionFollowingT('pleistocene', 11_000)).toBe('holocene')
  })

  it("climbs to the parent's sibling when the last child runs out", () => {
    expect(sectionFollowingT('permian', 251e6)).toBe('mesozoic')
  })

  it('keeps the deepest level that still holds a jump elsewhere', () => {
    expect(sectionFollowingT('modern', 1000)).toBe('medieval-world')
    expect(sectionFollowingT('modern', 66e6)).toBe('paleogene')
    expect(sectionFollowingT('modern', 3e9)).toBe('archean')
  })

  it('throws for a t outside the domain', () => {
    expect(() => sectionFollowingT('modern', -5)).toThrow()
  })
})

describe('sectionEntryT', () => {
  it('keeps t already inside the section', () => {
    expect(sectionEntryT('cenozoic', 30e6)).toBe(30e6)
  })

  it("moves t to the section's start (its oldest edge) otherwise", () => {
    expect(sectionEntryT('holocene', 66e6)).toBe(11_725)
    expect(sectionEntryT('pleistocene', 0)).toBe(2.58e6)
  })
})

describe('sectionSymlogKnee (re-review fix, 2026-09-15)', () => {
  it('returns the fixed SYMLOG_C for a leaf section, not the bare adaptive shrink', () => {
    expect(childSections('modern')).toHaveLength(0) // sanity: this really is a leaf
    expect(sectionSymlogKnee('modern')).toBe(SYMLOG_C)
    expect(sectionSymlogKnee('industrial-age')).toBe(SYMLOG_C)
  })

  it('returns the ordinary symlogKnee(window) for any section with children, unaffected', () => {
    expect(childSections('holocene').length).toBeGreaterThan(0)
    expect(sectionSymlogKnee('holocene')).toBe(symlogKnee(sectionById('holocene').window))
    // The full domain (many children, well above the adaptive threshold) is just SYMLOG_C.
    expect(sectionSymlogKnee('earth')).toBe(SYMLOG_C)
  })
})
