import { describe, expect, it } from 'vitest'

import type { TimelineEvent } from '@/types/layer'

import { adjacentEvent, browseEvents, matchesEventQuery, nearestBrowseEventIndex } from './browse'

function event(id: string, overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return { id, label: id, tMin: 0, tMax: 0, importance: 0.5, description: '', citation: '', ...overrides }
}

describe('matchesEventQuery', () => {
  it('matches a case-insensitive substring of the label', () => {
    expect(matchesEventQuery(event('a', { label: 'Control of Fire' }), 'fire')).toBe(true)
    expect(matchesEventQuery(event('a', { label: 'Control of Fire' }), 'FIRE')).toBe(true)
  })

  it('matches a substring of the description', () => {
    const e = event('a', { label: 'K-Pg impact', description: 'Chicxulub asteroid strikes Yucatán.' })
    expect(matchesEventQuery(e, 'asteroid')).toBe(true)
  })

  it('matches an era/section name the event is placed within, even though no field spells it', () => {
    const e = event('stego', { label: 'Stegosaurus roams', tMin: 150e6, tMax: 150e6, description: '' })
    expect(matchesEventQuery(e, 'jurassic')).toBe(true)
    expect(matchesEventQuery(e, 'cretaceous')).toBe(false)
  })

  it('requires every whitespace-separated token, in any order', () => {
    const e = event('a', { label: 'Control of Fire', description: 'Early hominins tend flame.' })
    expect(matchesEventQuery(e, 'fire early')).toBe(true)
    expect(matchesEventQuery(e, 'fire nowhere')).toBe(false)
  })

})

describe('browseEvents', () => {
  it('returns every event oldest first, regardless of input order', () => {
    const young = event('young', { tMin: 100, tMax: 100 })
    const old = event('old', { tMin: 1e9, tMax: 1e9 })
    const mid = event('mid', { tMin: 1e6, tMax: 1e6 })
    const result = browseEvents([young, old, mid], { query: '', tags: [] })
    expect(result.map((e) => e.id)).toEqual(['old', 'mid', 'young'])
  })

  it('filters by tag when tags is non-empty', () => {
    const life = event('life-event', { tags: ['life'] })
    const society = event('society-event', { tags: ['society'] })
    const result = browseEvents([life, society], { query: '', tags: ['life'] })
    expect(result.map((e) => e.id)).toEqual(['life-event'])
  })

  it('combines a query and a tag filter', () => {
    const match = event('match', { label: 'Fire tamed', tags: ['human-origins'] })
    const wrongTag = event('wrong-tag', { label: 'Fire spreads', tags: ['catastrophe'] })
    const wrongQuery = event('wrong-query', { label: 'Tools made', tags: ['human-origins'] })
    const result = browseEvents([match, wrongTag, wrongQuery], { query: 'fire', tags: ['human-origins'] })
    expect(result.map((e) => e.id)).toEqual(['match'])
  })
})

describe('nearestBrowseEventIndex', () => {
  const sorted = [
    event('old', { tMin: 1e9, tMax: 1e9 }),
    event('mid', { tMin: 1e6, tMax: 1e6 }),
    event('young', { tMin: 100, tMax: 100 }),
  ]

  it('picks the closest event by absolute distance, not direction', () => {
    expect(nearestBrowseEventIndex(sorted, 1e6 + 10)).toBe(1)
    expect(nearestBrowseEventIndex(sorted, 1e6 - 10)).toBe(1)
  })

  it('picks the nearest end when t sits outside the whole range', () => {
    expect(nearestBrowseEventIndex(sorted, 2e9)).toBe(0)
    expect(nearestBrowseEventIndex(sorted, 0)).toBe(2)
  })

})

describe('adjacentEvent', () => {
  const events = [event('recent', { tMin: 10, tMax: 10 }), event('old', { tMin: 2e9, tMax: 2e9 }), event('mid', { tMin: 5e6, tMax: 5e6 })]

  it('steps along time order, not input order, and stops at either end', () => {
    expect(adjacentEvent(events, 'mid', 'newer')?.id).toBe('recent')
    expect(adjacentEvent(events, 'mid', 'older')?.id).toBe('old')
    expect(adjacentEvent(events, 'recent', 'newer')).toBeNull()
    expect(adjacentEvent(events, 'old', 'older')).toBeNull()
  })
})
