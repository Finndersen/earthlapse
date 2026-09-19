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

// The Dinosaurs/Humans shortcut group: a prominent, always-present control, rendered by
// `Timeline.tsx` inside its own `.controlsSecondary`, alongside the speed/mode/scale controls.
// Every entry is a plain alias for `onSelectSection(id)` — see `../eraShortcuts.ts` for why those
// two ids and no others. The equivalent "back to Earth" shortcut is the breadcrumb's own root
// segment, not a pill here.
describe('<EraShortcuts>', () => {
  it('renders exactly the Dinosaurs and Humans shortcuts, as one labelled group', () => {
    renderShortcuts()
    expect(screen.getByRole('group', { name: 'Eras' })).not.toBeNull()
    expect(screen.getByText('Eras')).not.toBeNull()
    for (const nickname of ['Dinosaurs', 'Humans']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${nickname} — `) })).not.toBeNull()
    }
  })

  it("names each shortcut's real geological unit, not just its nickname", () => {
    renderShortcuts()
    expect(screen.getByRole('button', { name: /^Dinosaurs — the Mesozoic/ })).not.toBeNull()
    expect(screen.getByRole('button', { name: /^Humans — the Holocene/ })).not.toBeNull()
  })

  it('marks only the shortcut matching the current section as current', () => {
    renderShortcuts({ sectionId: ROOT_SECTION_ID })
    expect(screen.getByRole('button', { name: /^Dinosaurs —/ }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('button', { name: /^Humans —/ }).getAttribute('aria-current')).toBeNull()
  })

  it('marks Dinosaurs current for the Mesozoic itself and for a descendant section', () => {
    renderShortcuts({ sectionId: 'cretaceous' as SectionId })
    expect(screen.getByRole('button', { name: /^Dinosaurs —/ }).getAttribute('aria-current')).toBe('location')
  })

  it('marks Humans current for the Holocene itself and for a human-history child', () => {
    renderShortcuts({ sectionId: 'industrial-age' as SectionId })
    expect(screen.getByRole('button', { name: /^Humans —/ }).getAttribute('aria-current')).toBe('location')
  })

  it('calls onSelectSection with the aliased section id, not the nickname, when clicked', () => {
    const onSelectSection = vi.fn<(id: SectionId) => void>()
    renderShortcuts({ onSelectSection })
    fireEvent.click(screen.getByRole('button', { name: /^Dinosaurs —/ }))
    expect(onSelectSection).toHaveBeenCalledTimes(1)
    expect(onSelectSection).toHaveBeenCalledWith('mesozoic')
  })

  it('is keyboard-reachable as ordinary buttons (native Tab order, no bespoke handler)', () => {
    renderShortcuts()
    for (const nickname of ['Dinosaurs', 'Humans']) {
      const button = screen.getByRole('button', { name: new RegExp(`^${nickname} — `) })
      expect(button.tagName).toBe('BUTTON')
      expect(button.getAttribute('type')).toBe('button')
      expect(button.hasAttribute('disabled')).toBe(false)
    }
  })
})
