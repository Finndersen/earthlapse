// @vitest-environment jsdom
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

describe('useGlobeTexturePair enabled=false (no-WebGL globe)', () => {
  it('fetches neither the bound pair nor the preload window', () => {
    renderHook(() => useGlobeTexturePair(BLEND, PRELOAD_URLS, { enabled: false }))
    expect(loadTexture).not.toHaveBeenCalled()
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

// After a WebGL context loss a bound texture is unusable even though its URL is unchanged;
// bumping resetKey forces the re-fetch.
describe('useGlobeTexturePair resetKey', () => {
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

  it('unbinds the stale pair synchronously on a resetKey change, before the refetch resolves', async () => {
    const beforeTex = { name: 'before' }
    const afterTex = { name: 'after' }
    loadTexture.mockImplementation((url: string) => Promise.resolve(url === BLEND.beforeUrl ? beforeTex : afterTex))

    const { result, rerender } = renderHook(({ resetKey }: { resetKey: number }) => useGlobeTexturePair(BLEND, [], { resetKey }), {
      initialProps: { resetKey: 0 },
    })
    await waitFor(() => expect(result.current.texturesReady).toBe(true))

    loadTexture.mockImplementation(() => new Promise<unknown>(() => {}))
    rerender({ resetKey: 1 })
    expect(result.current).toEqual({ beforeTex: null, afterTex: null, mix: BLEND.alpha, texturesReady: false })
  })
})
