import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState, type ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Playback, TimelineEvent } from '@/types/layer'

import { createSymlogScale } from '../scale'
import { continuationSection, previousSiblingStep, sectionById, type SectionId } from '../sections'
import { Timeline } from '../Timeline'
import { SectionBands } from './SectionBands'
import { SectionBreadcrumb } from './SectionBreadcrumb'
import { SectionEdgeButton } from './SectionEdgeNav'

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const scaleFor = (id: SectionId) => createSymlogScale(sectionById(id).window)

describe('<SectionBands>', () => {
  it('lists child sections, marks the current one, and reports a click', () => {
    const onSelectSection = vi.fn()
    render(<SectionBands sectionId="earth" t={1e8} scale={scaleFor('earth')} onSelectSection={onSelectSection} />)
    const buttons = within(screen.getByRole('navigation', { name: 'Sections of Earth' })).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Hadean', 'Archean', 'Proterozoic', 'Paleozoic', 'Mesozoic', 'Cenozoic'])
    expect(buttons.map((b) => b.getAttribute('aria-current'))).toEqual([null, null, null, null, 'time', null])
    fireEvent.click(screen.getByRole('button', { name: /^Cenozoic,/ }))
    expect(onSelectSection).toHaveBeenCalledWith('cenozoic')
  })

  it('names a leaf section instead of offering bands', () => {
    render(<SectionBands sectionId="hadean" t={4.2e9} scale={scaleFor('hadean')} onSelectSection={vi.fn()} />)
    expect(within(screen.getByRole('navigation', { name: 'Sections of Hadean' })).queryAllByRole('button')).toEqual([])
  })
})

describe('<SectionBreadcrumb>', () => {
  it('shows every ancestor as a button with the section itself current', () => {
    const onSelectSection = vi.fn()
    render(<SectionBreadcrumb sectionId="industrial-age" onSelectSection={onSelectSection} />)
    const trail = within(screen.getByRole('navigation', { name: 'Timeline section' })).getByRole('list')
    expect(within(trail).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Earth', 'Cenozoic', 'Quaternary', 'Holocene'])
    expect(within(trail).getByText('Industrial age').getAttribute('aria-current')).toBe('location')
    fireEvent.click(within(trail).getByRole('button', { name: 'Quaternary' }))
    expect(onSelectSection).toHaveBeenCalledWith('quaternary')
  })

  it('renders nothing at the root', () => {
    const { container } = render(<SectionBreadcrumb sectionId="earth" onSelectSection={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('<SectionEdgeButton>', () => {
  it('steps to the neighbouring section, and is disabled where there is none', () => {
    const onSelectSection = vi.fn()
    render(
      <>
        <SectionEdgeButton edge="previous" target={previousSiblingStep('industrial-age')} onSelectSection={onSelectSection} />
        <SectionEdgeButton edge="next" target={continuationSection('industrial-age')} onSelectSection={onSelectSection} />
        <SectionEdgeButton edge="next" target={continuationSection('earth')} onSelectSection={onSelectSection} />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Previous section: Early modern' }))
    expect(onSelectSection).toHaveBeenLastCalledWith('early-modern')
    fireEvent.click(screen.getByRole('button', { name: 'Next section: Modern' }))
    expect(onSelectSection).toHaveBeenLastCalledWith('modern')
    expect((screen.getByRole('button', { name: 'No next section' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

const playback: Playback = { playing: false, baseRate: 0.02, speed: 1, mode: 'scenes' }
const deepEvent: TimelineEvent = { id: 'deep', label: 'Deep', tMin: 2.5e8, tMax: 2.52e8, importance: 1, description: '', citation: '' }

function timelineProps(overrides: Partial<ComponentProps<typeof Timeline>> = {}): ComponentProps<typeof Timeline> {
  return {
    t: 0,
    scaleKind: 'symlog',
    scale: scaleFor('holocene'),
    sectionId: 'holocene',
    events: [deepEvent],
    checkpoints: [{ id: 'steppe', t: 20_000, label: 'Steppe' }],
    playback,
    onScrub: vi.fn(),
    onSelectSection: vi.fn(),
    onScaleKindChange: vi.fn(),
    onPlaybackChange: vi.fn(),
    onOpenCluster: vi.fn(),
    ...overrides,
  }
}

function ControlledTimeline({ initial, t, onSelectSection }: { initial: SectionId; t: number; onSelectSection: (id: SectionId) => void }) {
  const [sectionId, setSectionId] = useState<SectionId>(initial)
  return (
    <Timeline
      {...timelineProps({ t, sectionId, scale: scaleFor(sectionId) })}
      onSelectSection={(id) => {
        onSelectSection(id)
        setSectionId(id)
      }}
    />
  )
}

describe('<Timeline> section navigation', () => {
  it('leaves the section for its parent on Escape, doing nothing at the root', () => {
    const onSelectSection = vi.fn()
    const holocene = render(<ControlledTimeline initial="holocene" t={5000} onSelectSection={onSelectSection} />)
    fireEvent.keyDown(holocene.container.firstChild as Element, { key: 'Escape' })
    expect(onSelectSection).toHaveBeenCalledWith('quaternary')
    cleanup()
    onSelectSection.mockClear()
    const earth = render(<ControlledTimeline initial="earth" t={5000} onSelectSection={onSelectSection} />)
    fireEvent.keyDown(earth.container.firstChild as Element, { key: 'Escape' })
    expect(onSelectSection).not.toHaveBeenCalled()
  })

  it('enters a band, updating the breadcrumb and keeping focus on the strip', () => {
    render(<ControlledTimeline initial="earth" t={0} onSelectSection={vi.fn()} />)
    const cenozoic = screen.getByRole('button', { name: /^Cenozoic,/ })
    cenozoic.focus()
    fireEvent.click(cenozoic)
    expect(document.activeElement).toBe(screen.getByRole('navigation', { name: 'Sections of Cenozoic' }))
    expect(screen.getByRole('navigation', { name: 'Timeline section' }).textContent).toContain('Cenozoic')
  })

  it('steps scenes only within the selected section', () => {
    const props = timelineProps()
    render(<Timeline {...props} />)
    fireEvent.click(screen.getByLabelText('Back to previous scene'))
    expect(props.onScrub).not.toHaveBeenCalled()
  })

  it.each([
    ['older', 0, sectionById('holocene').window[1]],
    ['younger', 1000, sectionById('holocene').window[0]],
  ])('clamps a press past the %s edge to the section while the window is still animating', (_, clientX, expected) => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 48, width: 1000, height: 48, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    const props = timelineProps({ t: 5000, scale: scaleFor('earth'), events: [], checkpoints: [] })
    render(<Timeline {...props} />)
    fireEvent.pointerDown(screen.getByRole('slider'), { clientX, pointerId: 1, pointerType: 'mouse' })
    expect(props.onScrub).toHaveBeenLastCalledWith(expected)
  })
})
