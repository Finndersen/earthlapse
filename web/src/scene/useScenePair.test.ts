import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// `loadSceneTexture` is mocked with resolvers we control by hand, so tests can assert what
// `useScenePair` shows *while* a load is still in flight — the thing that matters for "no
// blank frame". `cached` is a separate, independently-controlled stand-in for the real
// module's persistent cache (deliberately not fed by `resolveLoad`, so existing tests that
// resolve the same URL twice with two different fake textures — simulating two independent
// in-flight requests — keep working); tests that care about the synchronous cache-hit path
// populate it directly via `markCached`.
const { pending, cached } = vi.hoisted(() => ({
  pending: new Map<string, (tex: unknown) => void>(),
  cached: new Map<string, unknown>(),
}))

vi.mock('./textureCache', () => ({
  loadSceneTexture: vi.fn(
    (url: string) =>
      new Promise((resolve) => {
        pending.set(url, resolve)
      }),
  ),
  getCachedSceneTexture: vi.fn((url: string) => cached.get(url)),
}))

// eslint-disable-next-line import/first -- must follow the hoisted vi.mock above
import { useScenePair } from './useScenePair'

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
  pending.clear()
  cached.clear()
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

    // c.png hasn't resolved yet — the *old* pair must still be what's bound, not a blank
    // frame or partially-updated state. `boundFromUrl`/`boundToUrl` say so explicitly, so a
    // caller computing mix/drift off the newly requested (b, c) can tell it does not match
    // what is actually bound (a, b) — see sceneRender.ts's resolveSceneRender.
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

  it(
    'binds a newly requested pair synchronously, with no intermediate render, when both its ' +
      'textures are already cached — the scene-checkpoint case where the incoming pair reuses ' +
      "a texture that was the outgoing pair's other half, or a preloaded neighbour",
    async () => {
      const { result, rerender } = renderHook(({ from, to }) => useScenePair(from, to), {
        initialProps: { from: 'a.png', to: 'b.png' },
      })

      act(() => {
        resolveLoad('a.png', fakeTexture('a'))
        resolveLoad('b.png', fakeTexture('b'))
      })
      await waitFor(() => expect(result.current.ready).toBe(true))

      // b.png is still the same texture (it was just the "to" half); c.png was preloaded as a
      // neighbour and has already decoded — both are already in the cache by the time the pair
      // request moves on to (b, c).
      markCached('b.png', fakeTexture('b'))
      markCached('c.png', fakeTexture('c'))

      rerender({ from: 'b.png', to: 'c.png' })

      // No `act`/`waitFor` here on purpose: binding a fully cache-hit pair must land in the
      // same render as the rerender itself, not a microtask later via the effect's
      // `Promise.all`. A caller driving mix/drift off the same prop change (SceneCanvasView's
      // `mix`/`fromDrift`/`toDrift`) would otherwise paint one frame of the OLD pair (toTex
      // still 'b') under the NEW mix/drift — a flash of the previous scene.
      expect(result.current.fromTex).toEqual(fakeTexture('b'))
      expect(result.current.toTex).toEqual(fakeTexture('c'))
    },
  )

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

    // The superseded a/b request resolves late; it must not clobber the newer c/d binding.
    act(() => {
      resolveLoad('a.png', fakeTexture('a'))
      resolveLoad('b.png', fakeTexture('b'))
    })

    expect(result.current.fromTex).toEqual(fakeTexture('c'))
    expect(result.current.toTex).toEqual(fakeTexture('d'))
  })

  it('does not re-request a pair that is already bound', async () => {
    const { loadSceneTexture } = await import('./textureCache')
    const { rerender } = renderHook(({ from, to }) => useScenePair(from, to), {
      initialProps: { from: 'a.png', to: 'b.png' },
    })

    act(() => {
      resolveLoad('a.png', fakeTexture('a'))
      resolveLoad('b.png', fakeTexture('b'))
    })
    await waitFor(() => expect(vi.mocked(loadSceneTexture)).toHaveBeenCalledTimes(2))

    rerender({ from: 'a.png', to: 'b.png' })
    expect(vi.mocked(loadSceneTexture)).toHaveBeenCalledTimes(2)
  })
})
