import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ROOT_SECTION_ID, type SectionId } from '../sections'
import { EraShortcuts } from './EraShortcuts'

afterEach(() => {
  cleanup()
})

function renderShortcuts({
  sectionId = ROOT_SECTION_ID as SectionId,
  onSelectSection = vi.fn<(id: SectionId) => void>(),
} = {}) {
  return render(<EraShortcuts sectionId={sectionId} onSelectSection={onSelectSection} />)
}

describe('<EraShortcuts>', () => {
  it('offers Dinosaurs and Humans in a named group, each naming its geological unit', () => {
    renderShortcuts()
    expect(screen.getByRole('group', { name: 'Eras' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Dinosaurs — the Mesozoic/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Humans — the Holocene/ })).toBeTruthy()
  })

  it('enters the aliased section on click', () => {
    const onSelectSection = vi.fn<(id: SectionId) => void>()
    renderShortcuts({ onSelectSection })
    fireEvent.click(screen.getByRole('button', { name: /^Dinosaurs —/ }))
    expect(onSelectSection).toHaveBeenCalledWith('mesozoic')
  })

  it.each([
    [ROOT_SECTION_ID, null, null],
    ['cretaceous', 'location', null],
    ['industrial-age', null, 'location'],
  ] as const)('marks the shortcut covering %s as current', (sectionId, dinosaurs, humans) => {
    renderShortcuts({ sectionId: sectionId as SectionId })
    expect(screen.getByRole('button', { name: /^Dinosaurs —/ }).getAttribute('aria-current')).toBe(dinosaurs)
    expect(screen.getByRole('button', { name: /^Humans —/ }).getAttribute('aria-current')).toBe(humans)
  })
})
