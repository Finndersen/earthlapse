import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// `loadTexture`/`trimGlobeTextures` are mocked so a disabled hook's "must not fetch anything"
// claim is checked directly against the call count, not inferred from network behaviour.
const { loadTexture, trimGlobeTextures } = vi.hoisted(() => ({
  loadTexture: vi.fn(() => new Promise(() => {})), // never resolves — tests only assert call counts
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
    renderHook(() => useGlobeTexturePair(BLEND, PRELOAD_URLS, false))
    expect(loadTexture).not.toHaveBeenCalled()
  })

  it('reports the same inert "nothing bound yet" shape a caller sees before the first pair loads', () => {
    const { result } = renderHook(() => useGlobeTexturePair(BLEND, PRELOAD_URLS, false))
    expect(result.current).toEqual({ beforeTex: null, afterTex: null, mix: 0, texturesReady: false })
  })

  it('starts fetching once re-rendered with enabled=true', () => {
    const { rerender } = renderHook(({ enabled }: { enabled: boolean }) => useGlobeTexturePair(BLEND, PRELOAD_URLS, enabled), {
      initialProps: { enabled: false },
    })
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
