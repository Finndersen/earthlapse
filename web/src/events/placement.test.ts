import { describe, expect, it } from 'vitest'

import type { TimelineEvent } from '@/types/layer'

import { formatEventDate, placementT } from './placement'

function event(overrides: Partial<TimelineEvent>): TimelineEvent {
  return { id: 'x', label: 'X', tMin: 0, tMax: 0, importance: 1, description: '', citation: '', ...overrides }
}

describe('placementT', () => {
  it('uses a moment’s best-estimate t when present', () => {
    expect(placementT(event({ kind: 'moment', t: 66.043e6, tMin: 66.0e6, tMax: 66.1e6 }))).toBe(66.043e6)
  })

  it('falls back to the interval midpoint for a period', () => {
    expect(placementT(event({ kind: 'period', tMin: 100, tMax: 300 }))).toBe(200)
  })

  it('falls back to the interval midpoint when kind and t are absent', () => {
    expect(placementT(event({ tMin: 100, tMax: 200 }))).toBe(150)
  })
})

describe('formatEventDate', () => {
  it('prints a moment’s precise best-estimate date, not the interval midpoint', () => {
    expect(formatEventDate(event({ kind: 'moment', t: 6.6e7, tMin: 6.0e7, tMax: 7.0e7 }))).toBe('66 Ma')
  })

  it('prints a period as a range', () => {
    const label = formatEventDate(event({ kind: 'period', tMin: 6.35e8, tMax: 7.2e8 }))
    expect(label).toContain('–')
    expect(label).toContain('Ma')
  })

  it('treats a kind-less exact-point interval as a moment', () => {
    expect(formatEventDate(event({ tMin: 1e4, tMax: 1e4 }))).toBe('10 ka')
  })

})
