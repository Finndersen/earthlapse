// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Loads resolve only when a test calls `resolveLoad`; `cached` stands in for the texture cache's
// synchronous hit path and is populated separately via `markCached`.
const { pending, cached, retained } = vi.hoisted(() => ({
  pending: new Map<string, (tex: unknown) => void>(),
  cached: new Map<string, unknown>(),
  retained: [] as unknown[],
}))

vi.mock('./textureCache', () => {
  const load = vi.fn(
    (url: string) =>
      new Promise((resolve) => {
        pending.set(url, resolve)
      }),
  )
  const get = vi.fn((url: string) => cached.get(url))
  return {
    loadSceneTexture: load,
    loadSceneThumbnail: vi.fn((url: string) => load(url)),
    getCachedSceneTexture: get,
    getCachedSceneThumbnail: vi.fn((url: string) => get(url)),
    retainSceneTextures: vi.fn((textures: readonly unknown[]) => {
      const held = textures.filter((texture) => texture !== null)
      retained.push(...held)
      return () => {
        for (const texture of held) retained.splice(retained.indexOf(texture), 1)
      }
    }),
  }
})

// eslint-disable-next-line import/first -- must follow the hoisted vi.mock above
import { FULL_IMAGE_GRACE_MS, RAPID_REQUEST_MS } from './sceneLayer'
// eslint-disable-next-line import/first -- must follow the hoisted vi.mock above
import { useScenePair as useScenePairOf } from './useScenePair'

/** Each scene's thumbnail is `<url>.thumb`. */
function useScenePair(from: string, to: string) {
  const pair = useScenePairOf(from, `${from}.thumb`, to, `${to}.thumb`)
  return {
    fromTex: pair.from?.full ?? null,
    toTex: pair.to?.full ?? null,
    fromThumb: pair.from?.thumb ?? null,
    toThumb: pair.to?.thumb ?? null,
    boundFromUrl: pair.from?.url ?? null,
    boundToUrl: pair.to?.url ?? null,
    ready: pair.ready,
  }
}

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

afterEach(() => {
  vi.useRealTimers()
  pending.clear()
  cached.clear()
  retained.length = 0
  vi.clearAllMocks()
})

describe('useScenePair: no blank frame', () => {
  it('is not ready, and both textures are null, until the first pair has fully loaded', async () => {
    const { result } = renderHook(() => useScenePair('a.png', 'b.png'))
    expect(result.current.ready).toBe(false)
    expect(result.current.fromTex).toBeNull()
    expect(result.current.toTex).toBeNull()

    act(() => {
      resolveLoad('a.png', fakeTexture('a'))
      resolveLoad('b.png', fakeTexture('b'))
    })

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.fromTex).toEqual(fakeTexture('a'))
    expect(result.current.toTex).toEqual(fakeTexture('b'))
  })

  it('keeps the previously bound pair on screen while a newly requested pair is still loading', async () => {
    const { result, rerender } = renderHook(({ from, to }) => useScenePair(from, to), {
      initialProps: { from: 'a.png', to: 'b.png' },
    })

    act(() => {
      resolveLoad('a.png', fakeTexture('a'))
      resolveLoad('b.png', fakeTexture('b'))
    })
    await waitFor(() => expect(result.current.ready).toBe(true))

    rerender({ from: 'b.png', to: 'c.png' })

    expect(result.current.ready).toBe(true)
    expect(result.current.fromTex).toEqual(fakeTexture('a'))
    expect(result.current.toTex).toEqual(fakeTexture('b'))
    expect(result.current.boundFromUrl).toBe('a.png')
    expect(result.current.boundToUrl).toBe('b.png')

    act(() => {
      resolveLoad('b.png', fakeTexture('b2'))
      resolveLoad('c.png', fakeTexture('c'))
    })

    await waitFor(() => expect(result.current.toTex).toEqual(fakeTexture('c')))
    expect(result.current.fromTex).toEqual(fakeTexture('b2'))
  })

  it('binds a fully cached pair in the same render as the request, with no frame of the old pair', async () => {
    const { result, rerender } = renderHook(({ from, to }) => useScenePair(from, to), {
      initialProps: { from: 'a.png', to: 'b.png' },
    })

    act(() => {
      resolveLoad('a.png', fakeTexture('a'))
      resolveLoad('b.png', fakeTexture('b'))
    })
    await waitFor(() => expect(result.current.ready).toBe(true))

    markCached('b.png', fakeTexture('b'))
    markCached('c.png', fakeTexture('c'))

    rerender({ from: 'b.png', to: 'c.png' })

    expect(result.current.fromTex).toEqual(fakeTexture('b'))
    expect(result.current.toTex).toEqual(fakeTexture('c'))
  })

  it('holds the bound pair through the grace for a jump to a scene with only its thumbnail, then binds the thumbnail, then the full image', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const flush = () => act(async () => {})
    const { result, rerender } = renderHook(({ from, to }) => useScenePair(from, to), {
      initialProps: { from: 'a.png', to: 'b.png' },
    })
    act(() => {
      resolveLoad('a.png', fakeTexture('a'))
      resolveLoad('b.png', fakeTexture('b'))
    })
    await flush()
    expect(result.current.ready).toBe(true)

    act(() => vi.advanceTimersByTime(RAPID_REQUEST_MS))
    markCached('b.png', fakeTexture('b'))
    markCached('c.png.thumb', fakeTexture('c thumb'))
    rerender({ from: 'b.png', to: 'c.png' })
    expect(result.current.boundToUrl).toBe('b.png')

    act(() => vi.advanceTimersByTime(FULL_IMAGE_GRACE_MS))
    expect(result.current.boundToUrl).toBe('c.png')
    expect(result.current.toTex).toBeNull()
    expect(result.current.toThumb).toEqual(fakeTexture('c thumb'))

    act(() => resolveLoad('c.png', fakeTexture('c')))
    await flush()
    expect(result.current.toTex).toEqual(fakeTexture('c'))
    expect(result.current.toThumb).toEqual(fakeTexture('c thumb'))
    expect(retained).toContainEqual(fakeTexture('c thumb'))
  })

  it('drops a stale in-flight request superseded by a newer one, rather than binding it out of order', async () => {
    const { result, rerender } = renderHook(({ from, to }) => useScenePair(from, to), {
      initialProps: { from: 'a.png', to: 'b.png' },
    })

    rerender({ from: 'c.png', to: 'd.png' })

    act(() => {
      resolveLoad('c.png', fakeTexture('c'))
      resolveLoad('d.png', fakeTexture('d'))
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.fromTex).toEqual(fakeTexture('c'))
    expect(result.current.toTex).toEqual(fakeTexture('d'))

    act(() => {
      resolveLoad('a.png', fakeTexture('a'))
      resolveLoad('b.png', fakeTexture('b'))
    })

    expect(result.current.fromTex).toEqual(fakeTexture('c'))
    expect(result.current.toTex).toEqual(fakeTexture('d'))
  })

  it('does not re-request a pair that is already bound', async () => {
    const { loadSceneTexture } = await import('./textureCache')
    const { result, rerender } = renderHook(({ from, to }) => useScenePair(from, to), {
      initialProps: { from: 'a.png', to: 'b.png' },
    })

    act(() => {
      resolveLoad('a.png', fakeTexture('a'))
      resolveLoad('b.png', fakeTexture('b'))
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    const calls = vi.mocked(loadSceneTexture).mock.calls.length

    rerender({ from: 'a.png', to: 'b.png' })
    expect(vi.mocked(loadSceneTexture)).toHaveBeenCalledTimes(calls)
  })
})

describe('useScenePair: eviction safety', () => {
  it('retains exactly the bound pair, holding the old pair while a new one loads', async () => {
    const { result, rerender, unmount } = renderHook(({ from, to }) => useScenePair(from, to), {
      initialProps: { from: 'a.png', to: 'b.png' },
    })
    const a = fakeTexture('a')
    const b = fakeTexture('b')
    const c = fakeTexture('c')
    act(() => {
      resolveLoad('a.png', a)
      resolveLoad('b.png', b)
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(retained).toEqual([a, b])

    rerender({ from: 'b.png', to: 'c.png' })
    expect(retained).toEqual([a, b])

    act(() => {
      resolveLoad('b.png', b)
      resolveLoad('c.png', c)
    })
    await waitFor(() => expect(result.current.toTex).toBe(c))
    expect(retained).toEqual([b, c])

    unmount()
    expect(retained).toEqual([])
  })
})
