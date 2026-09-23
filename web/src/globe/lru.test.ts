import { describe, expect, it } from 'vitest'

import { LruCache } from './lru'

function cacheWithLog(capacity: number): { cache: LruCache<string>; evicted: string[] } {
  const evicted: string[] = []
  const cache = new LruCache<string>(capacity, (value, key) => evicted.push(`${key}=${value}`))
  return { cache, evicted }
}

describe('LruCache', () => {
  it('rejects a capacity that is not a positive integer', () => {
    expect(() => new LruCache(0, () => {})).toThrow(/positive integer/)
    expect(() => new LruCache(1.5, () => {})).toThrow(/positive integer/)
  })

  it('trims least recently used first, back down to capacity', () => {
    const { cache, evicted } = cacheWithLog(2)
    cache.set('a', '1')
    cache.set('b', '2')
    cache.set('c', '3')
    cache.set('d', '4')
    cache.trim(new Set())
    expect(evicted).toEqual(['a=1', 'b=2'])
    expect(cache.size).toBe(2)
    expect(cache.has('c')).toBe(true)
    expect(cache.has('d')).toBe(true)
  })

  it('treats get as a use, moving the entry to most recent', () => {
    const { cache, evicted } = cacheWithLog(2)
    cache.set('a', '1')
    cache.set('b', '2')
    cache.set('c', '3')
    expect(cache.get('a')).toBe('1')
    cache.trim(new Set())
    expect(evicted).toEqual(['b=2'])
  })

  it('never evicts a kept key, even when that leaves it over capacity', () => {
    const { cache, evicted } = cacheWithLog(1)
    cache.set('a', '1')
    cache.set('b', '2')
    cache.set('c', '3')
    cache.trim(new Set(['a', 'b']))
    expect(evicted).toEqual(['c=3'])
    expect(cache.size).toBe(2)
  })

  it('refuses to replace an existing key, which would leak the old value', () => {
    const { cache } = cacheWithLog(2)
    cache.set('a', '1')
    expect(() => cache.set('a', '2')).toThrow(/already holds a/)
  })
})
