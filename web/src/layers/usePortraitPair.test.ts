// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Loads resolve only when a test calls `resolveLoad`; `cached` stands in for the texture cache's
// synchronous hit path and is populated separately via `markCached`.
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
    'binds a fully cached set in the same render as the request, with no frame of the old set',
    async () => {
      const { result, rerender } = renderHook(({ older, younger }) => usePortraitPair(older, younger, null), {
        initialProps: { older: 'a.png', younger: 'b.png' },
      })

      act(() => {
        resolveLoad('a.png', fakeTexture('a'))
        resolveLoad('b.png', fakeTexture('b'))
      })
      await waitFor(() => expect(result.current.ready).toBe(true))

      markCached('b.png', fakeTexture('b'))
      markCached('c.png', fakeTexture('c'))

      rerender({ older: 'b.png', younger: 'c.png' })

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

    markCached('a.png', fakeTexture('a'))
    markCached('b.png', fakeTexture('b'))
    rerender({ requestFlow: flow })

    expect(result.current.boundForwardUrl).toBeNull()

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

    act(() => {
      resolveLoad('a.png', fakeTexture('a'))
      resolveLoad('b.png', fakeTexture('b'))
    })

    expect(result.current.olderTex).toEqual(fakeTexture('c'))
    expect(result.current.youngerTex).toEqual(fakeTexture('d'))
  })

})
