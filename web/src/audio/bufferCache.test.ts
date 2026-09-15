import { describe, expect, it } from 'vitest'

import type { StemId } from './stemIds'

import { StemBufferCache } from './bufferCache'

describe('StemBufferCache.plan — fetching', () => {
  it('requests every needed stem not yet tracked, in `needed`\'s own iteration order, up to the concurrency cap', () => {
    const cache = new StemBufferCache<string>(2, 60_000, 180)
    const needed = new Set<StemId>(['wind', 'water', 'storm'])
    const { toFetch, toEvict } = cache.plan(needed, 0)
    expect(toFetch).toEqual(['wind', 'water'])
    expect(toEvict).toEqual([])
  })

  it('never re-requests a stem already loading or ready', () => {
    const cache = new StemBufferCache<string>(3, 60_000, 180)
    cache.markFetching('wind', 0)
    cache.markReady('water', 'buf:water', 10, 0)
    const { toFetch } = cache.plan(new Set(['wind', 'water', 'storm']), 100)
    expect(toFetch).toEqual(['storm'])
  })

  it('frees a concurrency slot as soon as a fetch resolves', () => {
    const cache = new StemBufferCache<string>(1, 60_000, 180)
    let plan = cache.plan(new Set(['wind', 'water']), 0)
    expect(plan.toFetch).toEqual(['wind'])
    cache.markFetching('wind', 0)

    plan = cache.plan(new Set(['wind', 'water']), 10)
    expect(plan.toFetch).toEqual([]) // still loading, still the only slot taken

    cache.markReady('wind', 'buf:wind', 5, 20)
    plan = cache.plan(new Set(['wind', 'water']), 30)
    expect(plan.toFetch).toEqual(['water'])
  })
})

describe('StemBufferCache.plan — error backoff', () => {
  it('does not retry a failed stem on the very next call', () => {
    const cache = new StemBufferCache<string>(3, 60_000, 180)
    cache.markFailed('wind', 0)
    const { toFetch } = cache.plan(new Set<StemId>(['wind']), 80) // one engine tick (TICK_MS) later
    expect(toFetch).toEqual([])
  })

  it('retries a failed stem once its backoff elapses', () => {
    const cache = new StemBufferCache<string>(3, 60_000, 180)
    cache.markFailed('wind', 0) // attempt 1: backoff 2000ms
    expect(cache.plan(new Set<StemId>(['wind']), 1_999).toFetch).toEqual([])
    expect(cache.plan(new Set<StemId>(['wind']), 2_000).toFetch).toEqual(['wind'])
  })

  it('doubles the backoff on each consecutive failure, capped', () => {
    const cache = new StemBufferCache<string>(3, 60_000, 180)
    cache.markFailed('wind', 0) // attempt 1: 2000ms
    cache.markFailed('wind', 2_000) // attempt 2: 4000ms -> retryAt 6000
    expect(cache.plan(new Set<StemId>(['wind']), 5_999).toFetch).toEqual([])
    expect(cache.plan(new Set<StemId>(['wind']), 6_000).toFetch).toEqual(['wind'])

    // Enough consecutive failures that uncapped doubling would reach an absurd delay (2000 *
    // 2^11 =~ 4.1e6 ms) — the actual delay must level off at MAX_RETRY_BACKOFF_MS instead.
    let lastFailAtMs = 6_000
    for (let i = 0; i < 10; i++) {
      cache.markFailed('wind', lastFailAtMs)
      lastFailAtMs += 100_000 // comfortably past any capped backoff, so each call lands on an already-eligible retry
    }
    const lastFailureAtMs = lastFailAtMs - 100_000
    const cappedRetryAtMs = lastFailureAtMs + 60_000 // MAX_RETRY_BACKOFF_MS
    expect(cache.plan(new Set<StemId>(['wind']), cappedRetryAtMs - 1).toFetch).toEqual([])
    expect(cache.plan(new Set<StemId>(['wind']), cappedRetryAtMs).toFetch).toEqual(['wind'])
  })

  it('a fresh success resets the backoff for the next failure', () => {
    const cache = new StemBufferCache<string>(3, 60_000, 180)
    cache.markFailed('wind', 0)
    cache.markFailed('wind', 2_000) // attempt 2, would back off 4000ms
    cache.markReady('wind', 'buf', 5, 6_000)
    cache.markFailed('wind', 6_001) // fresh attempt 1 again: 2000ms, not 8000ms
    expect(cache.plan(new Set<StemId>(['wind']), 6_001 + 1_999).toFetch).toEqual([])
    expect(cache.plan(new Set<StemId>(['wind']), 6_001 + 2_000).toFetch).toEqual(['wind'])
  })

  it('never retries a permanently-failed stem, however long or however many calls', () => {
    const cache = new StemBufferCache<string>(3, 60_000, 180)
    cache.markPermanentlyFailed('archosaurs', 0)
    for (const nowMs of [1, 1_000, 60_000, 1_000_000, 1e9]) {
      expect(cache.plan(new Set<StemId>(['archosaurs']), nowMs).toFetch).toEqual([])
    }
  })
})

describe('StemBufferCache.plan — idle-timeout eviction', () => {
  it('never evicts a stem that is in `needed`, however long the cache holds it', () => {
    const cache = new StemBufferCache<string>(3, 1000, 180)
    cache.markReady('wind', 'buf', 5, 0)
    const { toEvict } = cache.plan(new Set(['wind']), 10_000)
    expect(toEvict).toEqual([])
  })

  it('evicts a ready stem once it has been out of `needed` for longer than evictAfterMs', () => {
    const cache = new StemBufferCache<string>(3, 1000, 180)
    cache.markReady('wind', 'buf', 5, 0)
    cache.plan(new Set(), 500) // still inside the window — not needed, but not stale yet
    let { toEvict } = cache.plan(new Set(), 999)
    expect(toEvict).toEqual([])
    ;({ toEvict } = cache.plan(new Set(), 1001))
    expect(toEvict).toEqual(['wind'])
  })

  it('resets the idle clock every tick the stem re-enters `needed`', () => {
    const cache = new StemBufferCache<string>(3, 1000, 180)
    cache.markReady('wind', 'buf', 5, 0)
    cache.plan(new Set(['wind']), 900) // touched at 900
    const { toEvict } = cache.plan(new Set(), 1800) // only 900ms since the touch, not 1800
    expect(toEvict).toEqual([])
  })
})

describe('StemBufferCache.plan — decoded-bytes cap', () => {
  it('evicts least-recently-needed ready stems first once the total exceeds the cap', () => {
    const cache = new StemBufferCache<string>(3, 60_000, 100)
    cache.markReady('wind', 'buf', 40, 0)
    cache.markReady('water', 'buf', 40, 10)
    cache.markReady('storm', 'buf', 40, 20) // total 120 > cap 100
    const { toEvict } = cache.plan(new Set(), 30)
    // wind was touched least recently (t=0) — evicted first, dropping the total to 80 (<= 100).
    expect(toEvict).toEqual(['wind'])
  })

  it('never evicts a stem in `needed` to satisfy the cap, even while over it', () => {
    const cache = new StemBufferCache<string>(3, 60_000, 50)
    cache.markReady('wind', 'buf', 40, 0)
    cache.markReady('water', 'buf', 40, 0)
    const { toEvict } = cache.plan(new Set(['wind', 'water']), 100)
    expect(toEvict).toEqual([])
  })

  it('can evict before the idle timeout elapses when the cap alone requires it', () => {
    const cache = new StemBufferCache<string>(3, 60_000, 10)
    cache.markReady('wind', 'buf', 40, 0)
    const { toEvict } = cache.plan(new Set(), 1) // 1ms later, nowhere near the 60s timeout
    expect(toEvict).toEqual(['wind'])
  })

  it('never double-lists a stem already scheduled by the idle-timeout rule', () => {
    const cache = new StemBufferCache<string>(3, 100, 10)
    cache.markReady('wind', 'buf', 40, 0)
    const { toEvict } = cache.plan(new Set(), 1000) // both rules would fire on their own
    expect(toEvict).toEqual(['wind'])
  })

  it('reserves bytes for a stem still loading, so a landing fetch cannot blow straight past the cap', () => {
    const cache = new StemBufferCache<string>(3, 60_000, 100)
    cache.markReady('wind', 'buf', 60, 0)
    cache.markFetching('water', 10, 60) // estimated 60 bytes, not landed yet — committed total 120 > 100
    const { toEvict } = cache.plan(new Set(['water']), 20)
    expect(toEvict).toEqual(['wind'])
  })
})

describe('StemBufferCache bookkeeping', () => {
  it('handle() returns the ready buffer, and only while ready', () => {
    const cache = new StemBufferCache<string>()
    expect(cache.handle('wind')).toBeUndefined()
    cache.markFetching('wind', 0)
    expect(cache.handle('wind')).toBeUndefined()
    cache.markReady('wind', 'buf:wind', 5, 0)
    expect(cache.handle('wind')).toBe('buf:wind')
  })

  it('forget() removes an id entirely, so it is treated as untracked again', () => {
    const cache = new StemBufferCache<string>()
    cache.markReady('wind', 'buf', 5, 0)
    cache.forget('wind')
    expect(cache.status('wind')).toBe('absent')
    expect(cache.decodedBytesTotal).toBe(0)
  })

  it('decodedBytesTotal counts only ready entries', () => {
    const cache = new StemBufferCache<string>()
    cache.markFetching('wind', 0, 999)
    cache.markReady('water', 'buf', 12, 0)
    expect(cache.decodedBytesTotal).toBe(12)
  })

  it('trackedIds() lists every loading, ready or error id, for full teardown', () => {
    const cache = new StemBufferCache<string>()
    cache.markFetching('wind', 0)
    cache.markReady('water', 'buf', 12, 0)
    cache.markFailed('storm', 0)
    expect(new Set(cache.trackedIds())).toEqual(new Set(['wind', 'water', 'storm']))
  })
})
