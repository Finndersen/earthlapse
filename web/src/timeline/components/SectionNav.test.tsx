import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
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

const TRACK_WIDTH_PX = 1000

function trackRect(): DOMRect {
  return { left: 0, top: 0, right: TRACK_WIDTH_PX, bottom: 48, width: TRACK_WIDTH_PX, height: 48, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
}

describe('<SectionBands>', () => {
  it("lists the section's children as buttons, marking the one holding the playhead", () => {
    render(<SectionBands sectionId="earth" t={1e8} scale={scaleFor('earth')} onSelectSection={vi.fn()} />)
    const nav = screen.getByRole('navigation', { name: 'Sections of Earth' })
    const buttons = within(nav).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Hadean', 'Archean', 'Proterozoic', 'Paleozoic', 'Mesozoic', 'Cenozoic'])
    expect(buttons.map((b) => b.getAttribute('aria-current'))).toEqual([null, null, null, null, 'time', null])
  })

  it('reports the clicked band', () => {
    const onSelectSection = vi.fn()
    render(<SectionBands sectionId="earth" t={0} scale={scaleFor('earth')} onSelectSection={onSelectSection} />)
    fireEvent.click(screen.getByRole('button', { name: /^Cenozoic,/ }))
    expect(onSelectSection).toHaveBeenCalledWith('cenozoic')
  })

  it('names a leaf section and its range instead of offering bands', () => {
    render(<SectionBands sectionId="hadean" t={4.2e9} scale={scaleFor('hadean')} onSelectSection={vi.fn()} />)
    const nav = screen.getByRole('navigation', { name: 'Sections of Hadean' })
    expect(within(nav).queryAllByRole('button')).toEqual([])
    expect(nav.textContent).toMatch(/^Hadean · /)
  })

  it(
    'grows the strip past its own measured width instead of truncating a label below its floor, at a real phone ' +
      'width (re-review fix, 2026-09-15)',
    () => {
      const spy = vi
        .spyOn(Element.prototype, 'getBoundingClientRect')
        .mockReturnValue({ left: 0, top: 0, right: 358, bottom: 22, width: 358, height: 22, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
      const { container } = render(<SectionBands sectionId="earth" t={1e8} scale={scaleFor('earth')} onSelectSection={vi.fn()} />)
      const nav = screen.getByRole('navigation', { name: 'Sections of Earth' })
      // Every full label still renders somewhere in the DOM (via title/aria-label at minimum,
      // and here also as the button's own visible text where it fits) — none clipped away.
      const buttons = within(nav).getAllByRole('button')
      expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(
        expect.arrayContaining([expect.stringMatching(/^Hadean,/), expect.stringMatching(/^Modern,|^Cenozoic,/)]),
      )
      // The strip's inner content track is now sized past the measured 358px in px (not a %
      // squeeze) — jsdom doesn't compute real layout, so this reads the inline style it sets
      // rather than a rendered `scrollWidth`.
      const track = container.querySelector<HTMLElement>('[data-scrollable="true"]')
      expect(track).not.toBeNull()
      expect(parseFloat(track!.style.width)).toBeGreaterThan(358)
      spy.mockRestore()
    },
  )

  it('draws no connector lines once the strip is scrollable, since they would point outside the visible track (re-review fix, 2026-09-15)', () => {
    const spy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue({ left: 0, top: 0, right: 358, bottom: 22, width: 358, height: 22, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    const { container } = render(<SectionBands sectionId="earth" t={1e8} scale={scaleFor('earth')} onSelectSection={vi.fn()} />)
    expect(container.querySelector('svg')).toBeNull()
    spy.mockRestore()
  })
})

describe('<SectionBreadcrumb>', () => {
  it('shows the path with every ancestor clickable and the section itself current', () => {
    const onSelectSection = vi.fn()
    render(<SectionBreadcrumb sectionId="industrial-age" onSelectSection={onSelectSection} />)
    const nav = screen.getByRole('navigation', { name: 'Timeline section' })
    const trail = within(nav).getByRole('list')
    expect(within(trail).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Earth',
      'Cenozoic',
      'Quaternary',
      'Holocene',
    ])
    const current = within(trail).getByText('Industrial age')
    expect(current.getAttribute('aria-current')).toBe('location')
    fireEvent.click(within(trail).getByRole('button', { name: 'Quaternary' }))
    expect(onSelectSection).toHaveBeenCalledWith('quaternary')
  })

  it('renders nothing, not even a navigation landmark, at the root section', () => {
    const { container } = render(<SectionBreadcrumb sectionId="earth" onSelectSection={vi.fn()} />)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('shows the root as a crumb once one level down', () => {
    render(<SectionBreadcrumb sectionId="cenozoic" onSelectSection={vi.fn()} />)
    const trail = within(screen.getByRole('navigation', { name: 'Timeline section' })).getByRole('list')
    expect(within(trail).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Earth'])
    expect(within(trail).getByText('Cenozoic').getAttribute('aria-current')).toBe('location')
  })

  it('renders no shortcut buttons of its own (user ask, 2026-09-18: Up/Home deleted, prev/next moved to SectionEdgeNav)', () => {
    render(<SectionBreadcrumb sectionId="industrial-age" onSelectSection={vi.fn()} />)
    const nav = screen.getByRole('navigation', { name: 'Timeline section' })
    const trail = within(nav).getByRole('list')
    // Every button inside the nav belongs to the trail itself (an ancestor crumb) — none of the
    // four "‹ Up"/"⌂ Earth"/"‹"/"›" buttons this used to carry.
    expect(within(nav).getAllByRole('button')).toEqual(within(trail).getAllByRole('button'))
  })
})

// The previous/next sibling-section buttons that used to flank the breadcrumb, then moved onto
// the scrub track itself (user ask, 2026-09-18), then became a plain per-edge button
// (`SectionEdgeButton`) placed by `Timeline.tsx` itself rather than a wrapper owning both buttons
// plus everything they flank as `children` — see `SectionEdgeNav.tsx`'s own doc comment for why
// (a shared CSS Grid, so one `grid-area` reassignment can move a button between flanking the
// track and joining the phone-portrait transport row).
describe('<SectionEdgeButton>', () => {
  it('steps to the previous/next sibling section, matching the keyboard shortcuts, and reports through onSelectSection', () => {
    const onSelectSection = vi.fn()
    render(
      <>
        <SectionEdgeButton edge="previous" target={previousSiblingStep('industrial-age')} onSelectSection={onSelectSection} />
        <SectionEdgeButton edge="next" target={continuationSection('industrial-age')} onSelectSection={onSelectSection} />
      </>,
    )
    const previous = screen.getByRole('button', { name: 'Previous section: Early modern' })
    fireEvent.click(previous)
    expect(onSelectSection).toHaveBeenLastCalledWith('early-modern')

    const next = screen.getByRole('button', { name: 'Next section: Modern' })
    fireEvent.click(next)
    expect(onSelectSection).toHaveBeenLastCalledWith('modern')
  })

  it("names each button's own keyboard shortcut in its title", () => {
    render(
      <>
        <SectionEdgeButton edge="previous" target={previousSiblingStep('industrial-age')} onSelectSection={vi.fn()} />
        <SectionEdgeButton edge="next" target={continuationSection('industrial-age')} onSelectSection={vi.fn()} />
      </>,
    )
    expect(screen.getByRole('button', { name: 'Previous section: Early modern' }).getAttribute('title')).toMatch(
      /Shift\+← or Page Up/,
    )
    expect(screen.getByRole('button', { name: 'Next section: Modern' }).getAttribute('title')).toMatch(/Shift\+→ or Page Down/)
  })

  it('disables the button that has nowhere to go, without removing it', () => {
    render(
      <>
        <SectionEdgeButton edge="previous" target={previousSiblingStep('earth')} onSelectSection={vi.fn()} />
        <SectionEdgeButton edge="next" target={continuationSection('earth')} onSelectSection={vi.fn()} />
      </>,
    )
    expect((screen.getByRole('button', { name: 'No previous section' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'No next section' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

const playback: Playback = { playing: false, baseRate: 0.02, speed: 1, yearsPerSecond: 10, mode: 'scenes' }
const deepEvent: TimelineEvent = { id: 'deep', label: 'Deep', tMin: 2.5e8, tMax: 2.52e8, importance: 1, description: '', citation: '' }

function ControlledTimeline({ initial, t, onSelectSection }: { initial: SectionId; t: number; onSelectSection: (id: SectionId) => void }) {
  const [sectionId, setSectionId] = useState<SectionId>(initial)
  return (
    <Timeline
      t={t}
      scaleKind="symlog"
      scale={scaleFor(sectionId)}
      sectionId={sectionId}
      events={[deepEvent]}
      checkpoints={[{ id: 'steppe', t: 20_000, label: 'Steppe' }]}
      playback={playback}
      onScrub={vi.fn()}
      onSelectSection={(id) => {
        onSelectSection(id)
        setSectionId(id)
      }}
      onScaleKindChange={vi.fn()}
      onPlaybackChange={vi.fn()}
      onOpenCluster={vi.fn()}
    />
  )
}

describe('<Timeline> section navigation (ADR-024)', () => {
  it('Escape leaves the section for its parent', () => {
    const onSelectSection = vi.fn()
    const { container } = render(<ControlledTimeline initial="holocene" t={5000} onSelectSection={onSelectSection} />)
    fireEvent.keyDown(container.firstChild as Element, { key: 'Escape' })
    expect(onSelectSection).toHaveBeenCalledWith('quaternary')
  })

  it('Escape does nothing at the root', () => {
    const onSelectSection = vi.fn()
    const { container } = render(<ControlledTimeline initial="earth" t={5000} onSelectSection={onSelectSection} />)
    fireEvent.keyDown(container.firstChild as Element, { key: 'Escape' })
    expect(onSelectSection).not.toHaveBeenCalled()
  })

  it('steps only within the selected section', () => {
    const onScrub = vi.fn()
    render(
      <Timeline
        t={0}
        scaleKind="symlog"
        scale={scaleFor('holocene')}
        sectionId="holocene"
        events={[deepEvent]}
        checkpoints={[{ id: 'steppe', t: 20_000, label: 'Steppe' }]}
        playback={playback}
        onScrub={onScrub}
        onSelectSection={vi.fn()}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={vi.fn()}
        onOpenCluster={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByLabelText('Back to previous scene'))
    expect(onScrub).not.toHaveBeenCalled()
  })

  it('puts focus back on the band strip after a band click replaces the focused button', () => {
    render(<ControlledTimeline initial="earth" t={0} onSelectSection={vi.fn()} />)
    const cenozoic = screen.getByRole('button', { name: /^Cenozoic,/ })
    cenozoic.focus()
    fireEvent.click(cenozoic)
    const strip = screen.getByRole('navigation', { name: 'Sections of Cenozoic' })
    expect(document.activeElement).toBe(strip)
    expect(screen.getByRole('navigation', { name: 'Timeline section' }).textContent).toContain('Cenozoic')
  })

  it.each([
    ['older edge', 0, sectionById('holocene').window[1]],
    ['younger edge', TRACK_WIDTH_PX, sectionById('holocene').window[0]],
  ])('clamps a track press past the %s to the section while the window is still animating', (_, clientX, expected) => {
    // Mid-animation after Earth → Holocene: the scale still spans the whole domain, so the track's
    // left end maps to 4.6 Ga, far outside the section that is already selected.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(trackRect())
    const onScrub = vi.fn()
    render(
      <Timeline
        t={5000}
        scaleKind="symlog"
        scale={scaleFor('earth')}
        sectionId="holocene"
        events={[]}
        playback={playback}
        onScrub={onScrub}
        onSelectSection={vi.fn()}
        onScaleKindChange={vi.fn()}
        onPlaybackChange={vi.fn()}
        onOpenCluster={vi.fn()}
      />,
    )
    fireEvent.pointerDown(screen.getByRole('slider'), { clientX, pointerId: 1, pointerType: 'mouse' })
    expect(onScrub).toHaveBeenLastCalledWith(expected)
  })
})
