import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// `loadTexture`/`trimGlobeTextures` are mocked so a disabled hook's "must not fetch anything"
// claim is checked directly against the call count, not inferred from network behaviour.
const { loadTexture, trimGlobeTextures } = vi.hoisted(() => ({
  loadTexture: vi.fn((_url: string) => new Promise<unknown>(() => {})), // never resolves by default
  trimGlobeTextures: vi.fn(),
}))

vi.mock('./textureCache', () => ({ loadTexture, trimGlobeTextures }))

// eslint-disable-next-line import/first -- must follow the hoisted vi.mock above
import type { GlobeBlend } from './blend'
// eslint-disable-next-line import/first -- must follow the hoisted vi.mock above
import { useGlobeTexturePair } from './useGlobeTexturePair'

const BLEND: GlobeBlend = { beforeUrl: 'https://cdn.example.com/before.png', afterUrl: 'https://cdn.example.com/after.png', alpha: 0.5 }
const PRELOAD_URLS = ['https://cdn.example.com/ahead-1.png', 'https://cdn.example.com/ahead-2.png']

afterEach(() => {
  vi.clearAllMocks()
})

describe('useGlobeTexturePair enabled=false (no-WebGL globe, W-followup item 15/19e)', () => {
  it('fetches neither the bound pair nor the preload window', () => {
    renderHook(() => useGlobeTexturePair(BLEND, PRELOAD_URLS, { enabled: false }))
    expect(loadTexture).not.toHaveBeenCalled()
  })

  it('reports the same inert "nothing bound yet" shape a caller sees before the first pair loads', () => {
    const { result } = renderHook(() => useGlobeTexturePair(BLEND, PRELOAD_URLS, { enabled: false }))
    expect(result.current).toEqual({ beforeTex: null, afterTex: null, mix: 0, texturesReady: false })
  })

  it('starts fetching once re-rendered with enabled=true', () => {
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useGlobeTexturePair(BLEND, PRELOAD_URLS, { enabled }),
      { initialProps: { enabled: false } },
    )
    expect(loadTexture).not.toHaveBeenCalled()
    rerender({ enabled: true })
    expect(loadTexture).toHaveBeenCalledWith(BLEND.beforeUrl)
    expect(loadTexture).toHaveBeenCalledWith(BLEND.afterUrl)
  })
})

describe('useGlobeTexturePair enabled=true (default)', () => {
  it('fetches the bound pair when no third argument is passed, matching pre-existing callers', () => {
    renderHook(() => useGlobeTexturePair(BLEND, []))
    expect(loadTexture).toHaveBeenCalledWith(BLEND.beforeUrl)
    expect(loadTexture).toHaveBeenCalledWith(BLEND.afterUrl)
  })
})

// After a WebGL context loss the cache's own texture for an already-bound URL is no longer
// usable (`humanEraTextureCache.ts`'s own doc comment on why), but the plain "same URLs, don't
// re-fetch" check would never notice — `resetKey` is the escape hatch `Globe.tsx` bumps once the
// cache has been cleared (docs/GLOBE.md §10).
describe('useGlobeTexturePair resetKey (docs/GLOBE.md §10)', () => {
  it('does not re-fetch an already-bound pair when resetKey is unchanged', async () => {
    const beforeTex = { name: 'before' }
    const afterTex = { name: 'after' }
    loadTexture.mockImplementation((url: string) => Promise.resolve(url === BLEND.beforeUrl ? beforeTex : afterTex))

    const { result, rerender } = renderHook(({ resetKey }: { resetKey: number }) => useGlobeTexturePair(BLEND, [], { resetKey }), {
      initialProps: { resetKey: 0 },
    })
    await waitFor(() => expect(result.current.texturesReady).toBe(true))
    expect(loadTexture).toHaveBeenCalledTimes(2)

    rerender({ resetKey: 0 })
    expect(loadTexture).toHaveBeenCalledTimes(2)
  })

  it('re-fetches an already-bound pair (same URLs) once resetKey changes', async () => {
    const beforeTex = { name: 'before' }
    const afterTex = { name: 'after' }
    loadTexture.mockImplementation((url: string) => Promise.resolve(url === BLEND.beforeUrl ? beforeTex : afterTex))

    const { result, rerender } = renderHook(({ resetKey }: { resetKey: number }) => useGlobeTexturePair(BLEND, [], { resetKey }), {
      initialProps: { resetKey: 0 },
    })
    await waitFor(() => expect(result.current.texturesReady).toBe(true))
    expect(loadTexture).toHaveBeenCalledTimes(2)

    rerender({ resetKey: 1 })
    await waitFor(() => expect(loadTexture).toHaveBeenCalledTimes(4))
    expect(loadTexture).toHaveBeenCalledWith(BLEND.beforeUrl)
    expect(loadTexture).toHaveBeenCalledWith(BLEND.afterUrl)
  })

  it('unbinds the stale pair synchronously on a resetKey change, before the refetch resolves — a texture whose backing ImageBitmap is already closed must stop being sampled immediately, not once the replacement finishes loading', async () => {
    const beforeTex = { name: 'before' }
    const afterTex = { name: 'after' }
    loadTexture.mockImplementation((url: string) => Promise.resolve(url === BLEND.beforeUrl ? beforeTex : afterTex))

    const { result, rerender } = renderHook(({ resetKey }: { resetKey: number }) => useGlobeTexturePair(BLEND, [], { resetKey }), {
      initialProps: { resetKey: 0 },
    })
    await waitFor(() => expect(result.current.texturesReady).toBe(true))

    // The refetch triggered by this resetKey bump never resolves within this test — standing in
    // for the gap between a context restore and the replacement texture actually loading.
    loadTexture.mockImplementation(() => new Promise<unknown>(() => {}))
    rerender({ resetKey: 1 })
    // mix stays frozen at the pair's last live value (BLEND.alpha), the same "never disagree
    // with the visible pair" discipline the ordinary loading-a-new-pair case already has —
    // beforeTex/afterTex/texturesReady are what actually change here.
    expect(result.current).toEqual({ beforeTex: null, afterTex: null, mix: BLEND.alpha, texturesReady: false })
  })
})
