import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EARTH_FORMATION, type TimelineEvent } from '@/types/layer'

import type { TimelineCheckpoint } from '../checkpoints'
import { fisheyeScale, RESTING_FISHEYE, type FisheyeScale } from '../fisheye'
import { createSymlogScale, type TimeWindow } from '../scale'
import { ScrubTrack } from './ScrubTrack'

const FULL_DOMAIN: TimeWindow = [0, EARTH_FORMATION]
const baseScale = createSymlogScale(FULL_DOMAIN)
const scale = fisheyeScale(baseScale, RESTING_FISHEYE.lens, 1000)
const PIP: TimelineCheckpoint = { id: 'cp1', t: 1e8, label: 'Test Checkpoint' }
const PIP_X = scale.toUnit(PIP.t) * 1000
const CLOSE: TimelineCheckpoint[] = [
  { id: 'a', t: 1e8, label: 'Scene A' },
  { id: 'b', t: 1e8 + 10, label: 'Scene B' },
]

beforeEach(() => {
  // jsdom reports zero-size boxes; the track maths needs a real width.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 1000,
    height: 48,
    top: 0,
    left: 0,
    right: 1000,
    bottom: 48,
    x: 0,
    y: 0,
    toJSON: () => undefined,
  } as DOMRect)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderTrack(overrides: Partial<ComponentProps<typeof ScrubTrack>> = {}) {
  const props = {
    t: 0,
    window: FULL_DOMAIN,
    scale,
    events: [] as TimelineEvent[],
    checkpoints: [] as TimelineCheckpoint[],
    onScrub: vi.fn(),
    onOpenCluster: vi.fn(),
    onLensPointer: vi.fn(),
    onLensRelease: vi.fn(),
    ...overrides,
  }
  const result = render(<ScrubTrack {...props} />)
  const track = result.getByRole('slider')
  const q = (selector: string) => result.container.querySelector(selector)
  return { ...result, props, track, q }
}

const touch = (clientX: number, pointerId = 7) => ({ clientX, clientY: 24, pointerId, pointerType: 'touch' })
const mouse = (clientX: number, pointerId = 1) => ({ clientX, clientY: 24, pointerId, pointerType: 'mouse' })

describe('ScrubTrack scrubbing and lens', () => {
  it('scrubs to the pointer position on press', () => {
    const { track, props } = renderTrack()
    fireEvent.pointerDown(track, mouse(500))
    expect(props.onScrub).toHaveBeenCalledWith(scale.fromUnit(0.5))
  })

  it('reports the hovered u to the lens and releases it on leave', () => {
    const { track, props } = renderTrack()
    fireEvent.pointerMove(track, { clientX: 300, pointerId: 1 })
    expect(props.onLensPointer).toHaveBeenCalledWith(0.3, 1000)
    fireEvent.pointerLeave(track, { pointerId: 1 })
    expect(props.onLensRelease).toHaveBeenCalledTimes(1)
  })

  it('keeps the lens engaged through a mouse click on a pip, but releases it when a touch lifts', () => {
    const { track, q, props } = renderTrack({ checkpoints: [PIP] })
    const pip = q('[data-checkpoint-pip]')!
    fireEvent.pointerMove(track, mouse(500))
    fireEvent.pointerDown(pip, mouse(500))
    fireEvent.pointerUp(pip, mouse(500))
    expect(props.onLensRelease).not.toHaveBeenCalled()
    fireEvent.pointerDown(pip, touch(PIP_X))
    fireEvent.pointerUp(track, touch(PIP_X))
    expect(props.onLensRelease).toHaveBeenCalledTimes(1)
  })

  it('shows a snapped checkpoint label in the hover readout', () => {
    const { track, q } = renderTrack({ checkpoints: [PIP] })
    fireEvent.pointerMove(track, { clientX: PIP_X, pointerId: 1 })
    expect(q('[data-visible="true"]')?.textContent).toContain('Test Checkpoint')
  })

  it('marks the track touch-active and shows the magnifier only while a touch is pressed', () => {
    const { track, q } = renderTrack({ checkpoints: [PIP] })
    fireEvent.pointerMove(track, mouse(400))
    expect(track.getAttribute('data-touch-active')).toBe('false')
    expect(q('[data-touch-magnifier]')).toBeNull()
    fireEvent.pointerDown(track, touch(PIP_X, 5))
    expect(track.getAttribute('data-touch-active')).toBe('true')
    expect(q('[data-touch-magnifier]')?.textContent).toContain('Test Checkpoint')
    fireEvent.pointerUp(track, touch(PIP_X, 5))
    expect(track.getAttribute('data-touch-active')).toBe('false')
    expect(q('[data-touch-magnifier]')).toBeNull()
  })
})

describe('ScrubTrack markers', () => {
  it('merges colliding checkpoints into one cluster and splits them when the scale gives room', () => {
    const { q, container } = renderTrack({ checkpoints: CLOSE })
    expect(container.querySelectorAll('[data-checkpoint-cluster]')).toHaveLength(1)
    expect(q('[data-checkpoint-pip]')).toBeNull()
    cleanup()
    const stretched: FisheyeScale = {
      ...baseScale,
      toUnit: (t) => (t === 1e8 ? 0.2 : t === 1e8 + 10 ? 0.8 : baseScale.toUnit(t)),
      magnificationAt: () => 1,
    }
    const split = renderTrack({ checkpoints: CLOSE, scale: stretched })
    expect(split.container.querySelectorAll('[data-checkpoint-pip]')).toHaveLength(2)
  })

  it('drops the lower-importance event of a colliding pair', () => {
    const event = (id: string, tMin: number, importance: number): TimelineEvent => ({
      id,
      label: id,
      tMin,
      tMax: tMin + 1e5,
      importance,
      description: '',
      citation: '',
    })
    const { q } = renderTrack({ events: [event('high', 2e8, 0.9), event('low', 2e8 + 1, 0.1)] })
    expect(q('[title="high"]')).not.toBeNull()
    expect(q('[title="low"]')).toBeNull()
  })

  it('selects a pip on mouse click and on a touch tap within the slop', () => {
    const { q, track, props } = renderTrack({ checkpoints: [PIP] })
    const pip = q('[data-checkpoint-pip]')!
    fireEvent.pointerDown(pip, mouse(500))
    fireEvent.click(pip)
    expect(props.onScrub).toHaveBeenLastCalledWith(PIP.t)
    vi.mocked(props.onScrub).mockClear()
    fireEvent.pointerDown(pip, touch(PIP_X))
    fireEvent.pointerUp(track, touch(PIP_X))
    expect(props.onScrub).toHaveBeenCalledTimes(1)
    expect(props.onScrub).toHaveBeenCalledWith(PIP.t)
  })

  it('scrubs instead of selecting when a touch drag from a pip exceeds the slop', () => {
    const { q, track, props } = renderTrack({ checkpoints: [PIP] })
    fireEvent.pointerDown(q('[data-checkpoint-pip]')!, touch(PIP_X))
    expect(props.onScrub).not.toHaveBeenCalled()
    expect(q('[data-touch-magnifier]')).not.toBeNull()
    fireEvent.pointerMove(track, { ...touch(PIP_X + 40), buttons: 1 })
    fireEvent.pointerUp(track, touch(PIP_X + 40))
    expect(props.onScrub).toHaveBeenCalledTimes(1)
    expect(props.onScrub).not.toHaveBeenCalledWith(PIP.t)
  })

  it('does not leak a cancelled pending marker press into the next gesture', () => {
    const { q, track, props } = renderTrack({ checkpoints: [PIP] })
    fireEvent.pointerDown(q('[data-checkpoint-pip]')!, touch(PIP_X))
    fireEvent.pointerCancel(track, touch(PIP_X))
    fireEvent.pointerDown(track, touch(900))
    expect(props.onScrub).toHaveBeenCalledTimes(1)
    expect(props.onScrub).not.toHaveBeenCalledWith(PIP.t)
  })
})

describe('ScrubTrack cluster popover', () => {
  function openCluster(input: 'click' | 'touch' = 'click') {
    const r = renderTrack({ checkpoints: CLOSE })
    const cluster = r.q('[data-checkpoint-cluster]') as HTMLElement
    if (input === 'touch') {
      fireEvent.pointerDown(cluster, touch(500, 9))
      fireEvent.pointerUp(r.track, touch(500, 9))
    } else {
      cluster.focus()
      fireEvent.click(cluster)
    }
    return { ...r, cluster }
  }

  it.each(['click', 'touch'] as const)('opens on %s, scrubbing to the oldest member and naming each', (input) => {
    const { getByRole, props, cluster } = openCluster(input)
    expect(cluster.getAttribute('aria-label')).toContain('2 scenes')
    expect(props.onOpenCluster).toHaveBeenCalledWith([CLOSE[1], CLOSE[0]])
    expect(props.onScrub).toHaveBeenCalledWith(CLOSE[1]!.t)
    expect(getByRole('dialog').textContent).toMatch(/Scene A[\s\S]*Scene B|Scene B[\s\S]*Scene A/)
  })

  it('does not open when a touch drag from the cluster exceeds the slop', () => {
    const { q, track, queryByRole, props } = renderTrack({ checkpoints: CLOSE })
    fireEvent.pointerDown(q('[data-checkpoint-cluster]')!, touch(500, 9))
    fireEvent.pointerMove(track, { ...touch(540, 9), buttons: 1 })
    fireEvent.pointerUp(track, touch(540, 9))
    expect(props.onOpenCluster).not.toHaveBeenCalled()
    expect(queryByRole('dialog')).toBeNull()
  })

  it('takes focus, traps Tab, and restores focus to the cluster on Escape without scrubbing', () => {
    const { getByRole, queryByRole, props, cluster } = openCluster()
    const dialog = getByRole('dialog')
    expect(document.activeElement).toBe(dialog)
    const buttons = Array.from(dialog.querySelectorAll('button'))
    buttons.at(-1)!.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(buttons[0])
    vi.mocked(props.onScrub).mockClear()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(queryByRole('dialog')).toBeNull()
    expect(props.onScrub).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(cluster)
  })

  it('scrubs to a chosen member and closes, restoring focus', () => {
    const { getByText, queryByRole, props, cluster } = openCluster()
    fireEvent.click(getByText('Scene B'))
    expect(props.onScrub).toHaveBeenLastCalledWith(CLOSE[1]!.t)
    expect(queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(cluster)
  })

  it("ignores a touch tap's jitter on the popover, so neither × nor a member row scrubs to the finger", () => {
    const { getByText, getByRole, queryByRole, props } = openCluster()
    vi.mocked(props.onScrub).mockClear()
    vi.mocked(props.onLensPointer).mockClear()
    const tap = (el: HTMLElement, x: number): void => {
      fireEvent.pointerDown(el, { ...touch(x, 8), buttons: 1 })
      fireEvent.pointerMove(el, { ...touch(x + 1, 8), buttons: 1 })
      fireEvent.pointerUp(el, touch(x + 1, 8))
      fireEvent.click(el)
    }
    tap(getByText('Scene B').closest('button') as HTMLElement, 100)
    expect(vi.mocked(props.onScrub).mock.calls).toEqual([[CLOSE[1]!.t]])
    expect(props.onLensPointer).not.toHaveBeenCalled()
    expect(queryByRole('dialog')).toBeNull()

    fireEvent.click(document.querySelector('[data-checkpoint-cluster]') as HTMLElement)
    vi.mocked(props.onScrub).mockClear()
    tap(getByRole('button', { name: 'Close' }), 900)
    expect(props.onScrub).not.toHaveBeenCalled()
    expect(queryByRole('dialog')).toBeNull()
  })

  it('swallows the whole dismissing gesture on the track, keeping the lens, then scrubs normally', () => {
    const { track, queryByRole, props } = openCluster()
    vi.mocked(props.onScrub).mockClear()
    fireEvent.pointerDown(track, mouse(900, 2))
    expect(queryByRole('dialog')).toBeNull()
    fireEvent.pointerMove(track, { ...mouse(850, 2), buttons: 1 })
    fireEvent.pointerUp(track, mouse(850, 2))
    expect(props.onScrub).not.toHaveBeenCalled()
    expect(props.onLensRelease).not.toHaveBeenCalled()
    fireEvent.pointerDown(track, mouse(500, 3))
    expect(props.onScrub).toHaveBeenCalled()
  })
})
