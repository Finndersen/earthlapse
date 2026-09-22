import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// `loadPortraitTexture` is mocked with resolvers we control by hand, so tests can assert what
// `usePortraitPair` shows *while* a load is still in flight — the thing that matters for "no
// blank frame". `cached` is a separate, independently-controlled stand-in for the real module's
// persistent cache (deliberately not fed by `resolveLoad`, so a test that resolves the same URL
// twice with two different fake textures — simulating two independent in-flight requests — keeps
// working); tests that care about the synchronous cache-hit path populate it directly via
// `markCached`. Mirrors `scene/useScenePair.test.ts`'s own mock exactly.
const { pending, cached } = vi.hoisted(() => ({
  pending: new Map<string, (tex: unknown) => void>(),
  cached: new Map<string, unknown>(),
}))

vi.mock('./portraitTextures', () => ({
  loadPortraitTexture: vi.fn(
    (url: string) =>
      new Promise((resolve) => {
        pending.set(url, resolve)
      }),
  ),
  getCachedPortraitTexture: vi.fn((url: string) => cached.get(url)),
  retainPortraitTextures: vi.fn(() => () => {}),
}))

// eslint-disable-next-line import/first -- must follow the hoisted vi.mock above
import { usePortraitPair, type PortraitFlow } from './usePortraitPair'

function fakeTexture(name: string): { name: string } {
  return { name }
}

function resolveLoad(url: string, tex: unknown): void {
  const resolve = pending.get(url)
  if (resolve === undefined) throw new Error(`no in-flight load for ${url}`)
  resolve(tex)
  pending.delete(url)
}

function markCached(url: string, tex: unknown): void {
  cached.set(url, tex)
}

const flow: PortraitFlow = { forwardUrl: 'fwd.png', backwardUrl: 'back.png', forwardRange: 0.2, backwardRange: 0.1 }

afterEach(() => {
  pending.clear()
  cached.clear()
  vi.clearAllMocks()
})

describe('usePortraitPair: no blank frame', () => {
  it('is not ready, and every texture is null, until the first set (no flow) has fully loaded', async () => {
    const { result } = renderHook(() => usePortraitPair('a.png', 'b.png', null))
    expect(result.current.ready).toBe(false)
    expect(result.current.olderTex).toBeNull()
    expect(result.current.youngerTex).toBeNull()

    act(() => {
      resolveLoad('a.png', fakeTexture('a'))
      resolveLoad('b.png', fakeTexture('b'))
    })

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.olderTex).toEqual(fakeTexture('a'))
    expect(result.current.youngerTex).toEqual(fakeTexture('b'))
    expect(result.current.forwardTex).toBeNull()
    expect(result.current.boundForwardUrl).toBeNull()
  })

  it('does not bind until the flow textures have also loaded, when a morph is requested', async () => {
    const { result } = renderHook(() => usePortraitPair('a.png', 'b.png', flow))

    act(() => {
      resolveLoad('a.png', fakeTexture('a'))
      resolveLoad('b.png', fakeTexture('b'))
    })
    // The plates alone resolving must not bind a partial set — the shader would then either
    // read a placeholder flow field or, worse, warp with mismatched data.
    expect(result.current.ready).toBe(false)

    act(() => {
      resolveLoad('fwd.png', fakeTexture('fwd'))
      resolveLoad('back.png', fakeTexture('back'))
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.forwardTex).toEqual(fakeTexture('fwd'))
    expect(result.current.backwardTex).toEqual(fakeTexture('back'))
    expect(result.current.boundForwardUrl).toBe('fwd.png')
  })

  it('keeps the previously bound set on screen while a newly requested set is still loading', async () => {
    const { result, rerender } = renderHook(({ older, younger }) => usePortraitPair(older, younger, null), {
      initialProps: { older: 'a.png', younger: 'b.png' },
    })

    act(() => {
      resolveLoad('a.png', fakeTexture('a'))
      resolveLoad('b.png', fakeTexture('b'))
    })
    await waitFor(() => expect(result.current.ready).toBe(true))

    rerender({ older: 'b.png', younger: 'c.png' })

    // c.png hasn't resolved yet — the *old* set must still be what's bound, not a blank frame
    // or partially-updated state. `boundOlderUrl`/`boundYoungerUrl` say so explicitly, so a
    // caller computing alpha/flow-range off the newly requested (b, c) can tell it does not
    // match what is actually bound (a, b) — see portraitRender.ts's resolvePortraitRender.
    expect(result.current.ready).toBe(true)
    expect(result.current.olderTex).toEqual(fakeTexture('a'))
    expect(result.current.youngerTex).toEqual(fakeTexture('b'))
    expect(result.current.boundOlderUrl).toBe('a.png')
    expect(result.current.boundYoungerUrl).toBe('b.png')

    act(() => {
      resolveLoad('b.png', fakeTexture('b2'))
      resolveLoad('c.png', fakeTexture('c'))
    })

    await waitFor(() => expect(result.current.youngerTex).toEqual(fakeTexture('c')))
    expect(result.current.olderTex).toEqual(fakeTexture('b2'))
  })

  it(
    'binds a newly requested set synchronously, with no intermediate render, when every ' +
      'texture it needs is already cached — the morph-boundary case where the incoming plate ' +
      "reuses the outgoing set's other half, or a preloaded neighbour",
    async () => {
      const { result, rerender } = renderHook(({ older, younger }) => usePortraitPair(older, younger, null), {
        initialProps: { older: 'a.png', younger: 'b.png' },
      })

      act(() => {
        resolveLoad('a.png', fakeTexture('a'))
        resolveLoad('b.png', fakeTexture('b'))
      })
      await waitFor(() => expect(result.current.ready).toBe(true))

      // b.png is still the same texture (it was just the younger half); c.png was preloaded as
      // a neighbour and has already decoded — both are already in the cache by the time the
      // request moves on to (b, c).
      markCached('b.png', fakeTexture('b'))
      markCached('c.png', fakeTexture('c'))

      rerender({ older: 'b.png', younger: 'c.png' })

      // No `act`/`waitFor` here on purpose: binding a fully cache-hit set must land in the same
      // render as the rerender itself, not a microtask later via the effect's `Promise.all`. A
      // caller driving alpha/flow-range off the same prop change (PortraitCanvas's `alpha`)
      // would otherwise paint one frame of the OLD set (youngerTex still 'b') under the NEW
      // alpha — a flash of the previous ancestor.
      expect(result.current.olderTex).toEqual(fakeTexture('b'))
      expect(result.current.youngerTex).toEqual(fakeTexture('c'))
    },
  )

  it('does not bind synchronously on a cache hit unless the flow textures are cached too, when a morph is requested', async () => {
    const { result, rerender } = renderHook(({ requestFlow }: { requestFlow: PortraitFlow | null }) => usePortraitPair('a.png', 'b.png', requestFlow), {
      initialProps: { requestFlow: null as PortraitFlow | null },
    })

    act(() => {
      resolveLoad('a.png', fakeTexture('a'))
      resolveLoad('b.png', fakeTexture('b'))
    })
    await waitFor(() => expect(result.current.ready).toBe(true))

    // Both plates are already cached (they're the bound set), but the flow textures the new
    // request needs are not — the render-phase fast path must not bind on plates alone.
    markCached('a.png', fakeTexture('a'))
    markCached('b.png', fakeTexture('b'))
    rerender({ requestFlow: flow })

    expect(result.current.boundForwardUrl).toBeNull()

    // The render-phase fast path skipped, so the effect below requested the whole set again
    // (Promise.all over all four URLs) — including a.png/b.png, even though they're cached,
    // since the mock's loadPortraitTexture doesn't consult the cache itself.
    act(() => {
      resolveLoad('a.png', fakeTexture('a'))
      resolveLoad('b.png', fakeTexture('b'))
      resolveLoad('fwd.png', fakeTexture('fwd'))
      resolveLoad('back.png', fakeTexture('back'))
    })
    await waitFor(() => expect(result.current.boundForwardUrl).toBe('fwd.png'))
  })

  it('drops a stale in-flight request superseded by a newer one, rather than binding it out of order', async () => {
    const { result, rerender } = renderHook(({ older, younger }) => usePortraitPair(older, younger, null), {
      initialProps: { older: 'a.png', younger: 'b.png' },
    })

    rerender({ older: 'c.png', younger: 'd.png' })

    act(() => {
      resolveLoad('c.png', fakeTexture('c'))
      resolveLoad('d.png', fakeTexture('d'))
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.olderTex).toEqual(fakeTexture('c'))
    expect(result.current.youngerTex).toEqual(fakeTexture('d'))

    // The superseded a/b request resolves late; it must not clobber the newer c/d binding.
    act(() => {
      resolveLoad('a.png', fakeTexture('a'))
      resolveLoad('b.png', fakeTexture('b'))
    })

    expect(result.current.olderTex).toEqual(fakeTexture('c'))
    expect(result.current.youngerTex).toEqual(fakeTexture('d'))
  })

  it('does not re-request a set that is already bound', async () => {
    const { loadPortraitTexture } = await import('./portraitTextures')
    const { rerender } = renderHook(({ older, younger }) => usePortraitPair(older, younger, null), {
      initialProps: { older: 'a.png', younger: 'b.png' },
    })

    act(() => {
      resolveLoad('a.png', fakeTexture('a'))
      resolveLoad('b.png', fakeTexture('b'))
    })
    await waitFor(() => expect(vi.mocked(loadPortraitTexture)).toHaveBeenCalledTimes(2))

    rerender({ older: 'a.png', younger: 'b.png' })
    expect(vi.mocked(loadPortraitTexture)).toHaveBeenCalledTimes(2)
  })
})
