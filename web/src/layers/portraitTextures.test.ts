import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadPortraitTexture } from './portraitTextures'

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
