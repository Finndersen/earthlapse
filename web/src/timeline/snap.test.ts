import { describe, expect, it } from 'vitest'

import type { TimelineEvent } from '@/types/layer'

import { fisheyeScale } from './fisheye'
import type { TimelineCheckpoint } from './checkpoints'
import { createLinearScale, type TimeWindow } from './scale'
import { findSnapTarget, snapCandidates, SNAP_PX } from './snap'

describe('snapCandidates', () => {
  const events: TimelineEvent[] = [
    { id: 'e1', label: 'Inside', tMin: 90, tMax: 110, importance: 0.01, description: '', citation: '' },
    { id: 'e2', label: 'Outside', tMin: 900, tMax: 1000, importance: 0.01, description: '', citation: '' },
  ]
  const checkpoints: TimelineCheckpoint[] = [
    { id: 'c1', t: 105, label: 'Checkpoint inside' },
    { id: 'c2', t: 900, label: 'Checkpoint outside' },
  ]

  it('includes events the caller passes that overlap the window', () => {
    const result = snapCandidates(events, [], [0, 200])
    expect(result.map((c) => c.id)).toEqual(['e1'])
  })

  it('includes checkpoints inside the window and excludes ones outside it', () => {
    const result = snapCandidates([], checkpoints, [0, 200])
    expect(result.map((c) => c.id)).toEqual(['c1'])
  })

})

describe('findSnapTarget', () => {
  const window: TimeWindow = [0, 1000]
  const scale = createLinearScale(window)
  const widthPx = 240

  it('snaps to a candidate within SNAP_PX of the cursor', () => {
    const candidates = [{ id: 'a', t: 500, label: 'A', kind: 'checkpoint' as const }]
    const cursorT = 500 - (5 / widthPx) * 1000
    const target = findSnapTarget(candidates, scale, cursorT, widthPx)
    expect(target?.id).toBe('a')
  })

  it('picks the nearest candidate when several are within range', () => {
    const candidates = [
      { id: 'near', t: 500, label: 'Near', kind: 'checkpoint' as const },
      { id: 'far', t: 505, label: 'Far', kind: 'checkpoint' as const },
    ]
    const target = findSnapTarget(candidates, scale, 500, widthPx)
    expect(target?.id).toBe('near')
  })

  it('defaults snapPx to SNAP_PX', () => {
    const candidates = [{ id: 'a', t: 500, label: 'A', kind: 'checkpoint' as const }]
    const justInside = 500 - ((SNAP_PX - 1) / widthPx) * 1000
    const justOutside = 500 - ((SNAP_PX + 1) / widthPx) * 1000
    expect(findSnapTarget(candidates, scale, justInside, widthPx)?.id).toBe('a')
    expect(findSnapTarget(candidates, scale, justOutside, widthPx)).toBeUndefined()
  })

  it('measures distance in the given (possibly distorted) scale, not the undistorted one', () => {
    const distortedWidthPx = 120
    const lensCentreT = 500
    const cursorT = 950
    const candidateT = 825 // 15 undistorted px from the cursor at this width — outside SNAP_PX
    const distortedScale = fisheyeScale(scale, { centreU: scale.toUnit(lensCentreT), strength: 1 }, distortedWidthPx)
    const candidates = [{ id: 'a', t: candidateT, label: 'A', kind: 'checkpoint' as const }]

    expect(findSnapTarget(candidates, scale, cursorT, distortedWidthPx)).toBeUndefined()
    expect(findSnapTarget(candidates, distortedScale, cursorT, distortedWidthPx)?.id).toBe('a')
  })
})
