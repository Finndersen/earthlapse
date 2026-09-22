import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Manifest } from '@/types/manifest'

import stubManifestJson from '../../public/stub/manifest.json'

const { loads, webgl } = vi.hoisted(() => ({
  loads: new Map<string, { progress: (f: number) => void; resolve: () => void; reject: (e: Error) => void }>(),
  webgl: { supported: true },
}))

vi.mock('@/scene/textureCache', () => ({
  loadSceneTexture: vi.fn(
    (url: string, onProgress?: (fraction: number) => void) =>
      new Promise<void>((resolve, reject) => {
        loads.set(url, { progress: (f) => onProgress?.(f), resolve, reject })
      }),
  ),
}))

vi.mock('@/lib/webgl', () => ({ supportsWebGL: () => webgl.supported }))

// eslint-disable-next-line import/first -- must follow the hoisted vi.mock above
import { firstSceneUrls, initialSceneT, loadingProgress, useFirstSceneLoad } from './firstScene'

const stubManifest = stubManifestJson as unknown as Manifest

afterEach(() => {
  loads.clear()
  webgl.supported = true
  vi.restoreAllMocks()
})

describe('initialSceneT', () => {
  it('opens on the oldest scene', () => {
    expect(initialSceneT(stubManifest)).toBe(4_000_000_000)
  })

  it('is null for a manifest with no scenes', () => {
    expect(initialSceneT({ ...stubManifest, scenes: [] })).toBeNull()
  })
})

describe('firstSceneUrls', () => {
  it('resolves the distinct images of the pair shown at the initial t', () => {
    expect(firstSceneUrls(stubManifest)).toEqual(['/stub/scenes/archean-shore.svg'])
  })

  it('is empty for a manifest with no scenes', () => {
    expect(firstSceneUrls({ ...stubManifest, scenes: [] })).toEqual([])
  })
})

describe('loadingProgress', () => {
  it.each([
    { manifestLoaded: false, fractions: [0.5], expected: 0 },
    { manifestLoaded: true, fractions: [0], expected: 0.15 },
    { manifestLoaded: true, fractions: [1, 0], expected: 0.575 },
    { manifestLoaded: true, fractions: [1, 1], expected: 1 },
    { manifestLoaded: true, fractions: [], expected: 1 },
    { manifestLoaded: true, fractions: [2], expected: 1 },
  ])('is $expected with manifest loaded $manifestLoaded and scene fractions $fractions', ({ manifestLoaded, fractions, expected }) => {
    expect(loadingProgress(manifestLoaded, fractions)).toBeCloseTo(expected)
  })
})

describe('useFirstSceneLoad', () => {
  it('is not settled before the manifest is known', () => {
    const { result } = renderHook(() => useFirstSceneLoad(null))
    expect(result.current.settled).toBe(false)
  })

  it('reports download progress and settles once the first scene has loaded', async () => {
    const { result } = renderHook(() => useFirstSceneLoad(stubManifest))
    const url = '/stub/scenes/archean-shore.svg'
    await waitFor(() => expect(loads.has(url)).toBe(true))
    expect(result.current.settled).toBe(false)

    loads.get(url)!.progress(0.4)
    await waitFor(() => expect(result.current.fractions).toEqual([0.4]))
    expect(result.current.settled).toBe(false)

    loads.get(url)!.resolve()
    await waitFor(() => expect(result.current.settled).toBe(true))
    expect(result.current.fractions).toEqual([1])
  })

  it('settles on a failed load rather than holding the page back', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useFirstSceneLoad(stubManifest))
    const url = '/stub/scenes/archean-shore.svg'
    await waitFor(() => expect(loads.has(url)).toBe(true))

    loads.get(url)!.reject(new Error('HTTP 404'))

    await waitFor(() => expect(result.current.settled).toBe(true))
    expect(error).toHaveBeenCalled()
  })

  it('gates nothing on the texture cache without WebGL', () => {
    webgl.supported = false
    const { result } = renderHook(() => useFirstSceneLoad(stubManifest))
    expect(result.current.settled).toBe(true)
    expect(loads.size).toBe(0)
  })
})
