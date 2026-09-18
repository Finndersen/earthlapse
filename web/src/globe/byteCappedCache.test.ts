import { describe, expect, it, vi } from 'vitest'

import { ByteCappedCache } from './byteCappedCache'

describe('ByteCappedCache', () => {
  it('tracks total bytes and evicts nothing under capacity', () => {
    const onEvict = vi.fn()
    const cache = new ByteCappedCache<number>(100, onEvict, (v) => v)
    cache.set('a', 10)
    cache.set('b', 20)
    expect(cache.bytes).toBe(30)
    cache.trim(new Set())
    expect(onEvict).not.toHaveBeenCalled()
    expect(cache.size).toBe(2)
  })

  it('evicts least-recently-used entries first, oldest insertion first', () => {
    const onEvict = vi.fn()
    const cache = new ByteCappedCache<number>(25, onEvict, (v) => v)
    cache.set('a', 10)
    cache.set('b', 10)
    cache.set('c', 10)
    // total 30 > 25: evicts 'a' (oldest, never touched) down to 20 bytes.
    cache.trim(new Set())
    expect(onEvict).toHaveBeenCalledExactlyOnceWith(10, 'a')
    expect(cache.has('a')).toBe(false)
    expect(cache.bytes).toBe(20)
  })

  it('a get() marks an entry most-recently-used, changing eviction order', () => {
    const onEvict = vi.fn()
    const cache = new ByteCappedCache<number>(25, onEvict, (v) => v)
    cache.set('a', 10)
    cache.set('b', 10)
    cache.set('c', 10)
    cache.get('a') // now most-recently-used; 'b' becomes the oldest.
    cache.trim(new Set())
    expect(onEvict).toHaveBeenCalledExactlyOnceWith(10, 'b')
  })

  it('never evicts a key in keep, even over capacity', () => {
    const onEvict = vi.fn()
    const cache = new ByteCappedCache<number>(15, onEvict, (v) => v)
    cache.set('a', 10)
    cache.set('b', 10)
    cache.trim(new Set(['a', 'b']))
    expect(onEvict).not.toHaveBeenCalled()
    expect(cache.bytes).toBe(20)
  })

  it('throws on a non-positive capacity', () => {
    expect(() => new ByteCappedCache<number>(0, vi.fn(), (v) => v)).toThrow()
    expect(() => new ByteCappedCache<number>(-5, vi.fn(), (v) => v)).toThrow()
  })

  it('throws when re-setting an existing key (caller bug, same as LruCache)', () => {
    const cache = new ByteCappedCache<number>(100, vi.fn(), (v) => v)
    cache.set('a', 10)
    expect(() => cache.set('a', 20)).toThrow()
  })

  it('get() on a missing key returns undefined without touching state', () => {
    const cache = new ByteCappedCache<number>(100, vi.fn(), (v) => v)
    expect(cache.get('missing')).toBeUndefined()
  })

  it('clear() evicts every entry unconditionally, even well under capacity', () => {
    // Unlike trim(new Set()), which is a no-op once bytes <= capacityBytes — clear() exists
    // specifically for "every cached value is now invalid" (a WebGL context loss), not "we're
    // over budget".
    const onEvict = vi.fn()
    const cache = new ByteCappedCache<number>(1000, onEvict, (v) => v)
    cache.set('a', 10)
    cache.set('b', 20)
    cache.clear()
    expect(onEvict).toHaveBeenCalledTimes(2)
    expect(onEvict).toHaveBeenCalledWith(10, 'a')
    expect(onEvict).toHaveBeenCalledWith(20, 'b')
    expect(cache.size).toBe(0)
    expect(cache.bytes).toBe(0)
    expect(cache.has('a')).toBe(false)
  })

  it('a key can be re-set after clear() without the "already holds" throw', () => {
    const cache = new ByteCappedCache<number>(100, vi.fn(), (v) => v)
    cache.set('a', 10)
    cache.clear()
    expect(() => cache.set('a', 20)).not.toThrow()
    expect(cache.get('a')).toBe(20)
  })
})
