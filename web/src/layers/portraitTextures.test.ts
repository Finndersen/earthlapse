import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getCachedPortraitTexture, loadPortraitTexture, PORTRAIT_CACHE_CAPACITY, retainPortraitTextures } from './portraitTextures'

afterEach(() => {
  vi.restoreAllMocks()
})

function stubLoader(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(function (url, onLoad) {
    const texture = new THREE.Texture<HTMLImageElement>()
    texture.name = url
    queueMicrotask(() => onLoad?.(texture))
    return texture
  })
}

describe('loadPortraitTexture', () => {
  it('keeps a plate sRGB-encoded on the GPU, because the shader writes settled texels out unencoded', async () => {
    stubLoader()

    const texture = await loadPortraitTexture('/media/portraits/colour-space-check.jpg')

    expect(texture.colorSpace).toBe(THREE.NoColorSpace)
    expect(texture.colorSpace).not.toBe(THREE.SRGBColorSpace)
  })

  it('decodes a URL at most once, including while it is still loading', async () => {
    const load = stubLoader()
    const url = '/media/portraits/cache-check.jpg'

    const [first, second] = await Promise.all([loadPortraitTexture(url), loadPortraitTexture(url)])
    const third = await loadPortraitTexture(url)

    expect(load).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
    expect(third).toBe(first)
  })
})

describe('getCachedPortraitTexture', () => {
  it('is undefined for a URL that has never resolved', () => {
    expect(getCachedPortraitTexture('/media/portraits/never-loaded.jpg')).toBeUndefined()
  })

  it('returns the same texture loadPortraitTexture resolved, once it has loaded', async () => {
    stubLoader()
    const url = '/media/portraits/sync-check.jpg'

    expect(getCachedPortraitTexture(url)).toBeUndefined()
    const texture = await loadPortraitTexture(url)

    expect(getCachedPortraitTexture(url)).toBe(texture)
  })
})

describe('portrait texture eviction', () => {
  it('disposes textures beyond capacity, but never a retained set', async () => {
    stubLoader()
    const older = await loadPortraitTexture('/media/portraits/bound-older.webp')
    const younger = await loadPortraitTexture('/media/portraits/bound-younger.webp')
    const release = retainPortraitTextures([older, younger, null, null])
    const dispose = vi.spyOn(THREE.Texture.prototype, 'dispose')

    for (let i = 0; i < PORTRAIT_CACHE_CAPACITY * 2; i++) await loadPortraitTexture(`/media/portraits/scrubbed-${i}.webp`)

    expect(getCachedPortraitTexture('/media/portraits/bound-older.webp')).toBe(older)
    expect(getCachedPortraitTexture('/media/portraits/bound-younger.webp')).toBe(younger)
    expect(getCachedPortraitTexture('/media/portraits/scrubbed-0.webp')).toBeUndefined()
    expect(dispose).toHaveBeenCalled()
    expect(dispose.mock.contexts).not.toContain(older)
    expect(dispose.mock.contexts).not.toContain(younger)
    release()
  })
})
