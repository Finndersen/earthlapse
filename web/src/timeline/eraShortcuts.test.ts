import { describe, expect, it } from 'vitest'

import { ERA_SHORTCUTS, isEraShortcutActive } from './eraShortcuts'
import { ROOT_SECTION_ID } from './sections'

describe('ERA_SHORTCUTS', () => {
  it('aliases exactly the Mesozoic and the Holocene, in that order', () => {
    expect(ERA_SHORTCUTS.map((s) => [s.id, s.nickname])).toEqual([
      ['mesozoic', 'Dinosaurs'],
      ['holocene', 'Humans'],
    ])
  })

})

describe('isEraShortcutActive', () => {
  const dinosaurs = ERA_SHORTCUTS[0]!
  const humans = ERA_SHORTCUTS[1]!

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
