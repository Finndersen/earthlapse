import { describe, expect, it } from 'vitest'

import { ERA_SHORTCUTS, isEraShortcutActive } from './eraShortcuts'
import { ROOT_SECTION_ID } from './sections'

describe('ERA_SHORTCUTS', () => {
  it('aliases exactly Earth, the Mesozoic and the Holocene, in that order', () => {
    expect(ERA_SHORTCUTS.map((s) => [s.id, s.nickname])).toEqual([
      [ROOT_SECTION_ID, 'Earth'],
      ['mesozoic', 'Dinosaurs'],
      ['holocene', 'Humans'],
    ])
  })

  it("carries each shortcut's real section, not a synthetic stand-in", () => {
    for (const shortcut of ERA_SHORTCUTS) {
      expect(shortcut.section.id).toBe(shortcut.id)
    }
  })

  it("gives Dinosaurs and Humans a plain-language nickname distinct from the section's own geological label (Earth's nickname IS its label — the plain and geological name coincide)", () => {
    expect(ERA_SHORTCUTS[1]!.section.label).not.toBe(ERA_SHORTCUTS[1]!.nickname)
    expect(ERA_SHORTCUTS[2]!.section.label).not.toBe(ERA_SHORTCUTS[2]!.nickname)
  })
})

describe('isEraShortcutActive', () => {
  const earth = ERA_SHORTCUTS[0]!
  const dinosaurs = ERA_SHORTCUTS[1]!
  const humans = ERA_SHORTCUTS[2]!

  it('Earth is active only at the exact root, never merely as an ancestor', () => {
    expect(isEraShortcutActive(earth, ROOT_SECTION_ID)).toBe(true)
    expect(isEraShortcutActive(earth, 'mesozoic')).toBe(false)
    expect(isEraShortcutActive(earth, 'holocene')).toBe(false)
    expect(isEraShortcutActive(earth, 'first-farmers')).toBe(false)
  })

  it('Dinosaurs is active on the Mesozoic itself and any of its descendants', () => {
    expect(isEraShortcutActive(dinosaurs, 'mesozoic')).toBe(true)
    expect(isEraShortcutActive(dinosaurs, 'triassic')).toBe(true)
    expect(isEraShortcutActive(dinosaurs, 'cretaceous')).toBe(true)
  })

  it('Dinosaurs is inactive outside the Mesozoic, including at the root', () => {
    expect(isEraShortcutActive(dinosaurs, ROOT_SECTION_ID)).toBe(false)
    expect(isEraShortcutActive(dinosaurs, 'paleozoic')).toBe(false)
    expect(isEraShortcutActive(dinosaurs, 'cenozoic')).toBe(false)
  })

  it('Humans is active on the Holocene itself and any of its human-history children', () => {
    expect(isEraShortcutActive(humans, 'holocene')).toBe(true)
    expect(isEraShortcutActive(humans, 'first-farmers')).toBe(true)
    expect(isEraShortcutActive(humans, 'modern')).toBe(true)
  })

  it('Humans is inactive outside the Holocene, including its own sibling Pleistocene', () => {
    expect(isEraShortcutActive(humans, 'pleistocene')).toBe(false)
    expect(isEraShortcutActive(humans, 'quaternary')).toBe(false)
    expect(isEraShortcutActive(humans, ROOT_SECTION_ID)).toBe(false)
  })
})
