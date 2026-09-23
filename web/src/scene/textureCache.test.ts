import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { fetchImage } = vi.hoisted(() => ({
  fetchImage: vi.fn(async (url: string, _onProgress?: (fraction: number) => void) => ({ src: url }) as unknown as HTMLImageElement),
}))

vi.mock('@/lib/fetchImage', () => ({ fetchImage, fetchImageBlob: vi.fn() }))

// eslint-disable-next-line import/first -- must follow the hoisted vi.mock above
import { getCachedSceneTexture, loadSceneTexture, retainSceneTextures, SCENE_CACHE_CAPACITY } from './textureCache'

afterEach(() => {
  fetchImage.mockClear()
  vi.restoreAllMocks()
})

describe('loadSceneTexture', () => {
  it('keeps a scene sRGB-encoded on the GPU, because the shader writes settled texels out unencoded', async () => {
    const texture = await loadSceneTexture('/media/scenes/colour-space-check.webp')

    // NoColorSpace: the GPU must not decode the texel on sample — shaders.ts's srgbToLinear/
    // linearToSrgb bracket only the crossfade. Tagging SRGBColorSpace here would have the GPU
    // decode it a second time, drawing every scene at about (code/255)^2.2 — much darker than
    // the published file.
    expect(texture.colorSpace).toBe(THREE.NoColorSpace)
    expect(texture.colorSpace).not.toBe(THREE.SRGBColorSpace)
  })

  it('decodes a URL at most once, including while it is still loading', async () => {
    const url = '/media/scenes/cache-check.webp'

    const [first, second] = await Promise.all([loadSceneTexture(url), loadSceneTexture(url)])
    const third = await loadSceneTexture(url)

    expect(fetchImage).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
    expect(third).toBe(first)
  })

  it('passes download progress through to the caller that started the load', async () => {
    fetchImage.mockImplementationOnce(async (url, onProgress) => {
      onProgress?.(0.25)
      onProgress?.(1)
      return { src: url } as unknown as HTMLImageElement
    })
    const progress: number[] = []

    await loadSceneTexture('/media/scenes/progress-check.webp', (fraction) => progress.push(fraction))

    expect(progress).toEqual([0.25, 1])
  })

  it('disposes scenes beyond capacity, but never a retained pair', async () => {
    const from = await loadSceneTexture('/media/scenes/bound-from.webp')
    const to = await loadSceneTexture('/media/scenes/bound-to.webp')
    const release = retainSceneTextures([from, to])
    const dispose = vi.spyOn(THREE.Texture.prototype, 'dispose')

    for (let i = 0; i < SCENE_CACHE_CAPACITY * 2; i++) await loadSceneTexture(`/media/scenes/scrubbed-${i}.webp`)

    expect(getCachedSceneTexture('/media/scenes/bound-from.webp')).toBe(from)
    expect(getCachedSceneTexture('/media/scenes/bound-to.webp')).toBe(to)
    expect(getCachedSceneTexture('/media/scenes/scrubbed-0.webp')).toBeUndefined()
    expect(dispose).toHaveBeenCalled()
    expect(dispose.mock.contexts).not.toContain(from)
    expect(dispose.mock.contexts).not.toContain(to)
    release()
  })
})
