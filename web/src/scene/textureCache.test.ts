import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadSceneTexture } from './textureCache'

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

describe('loadSceneTexture', () => {
  it('keeps a scene sRGB-encoded on the GPU, because the shader writes settled texels out unencoded', async () => {
    stubLoader()

    const texture = await loadSceneTexture('/media/scenes/colour-space-check.jpg')

    // NoColorSpace: the GPU must not decode the texel on sample — shaders.ts's srgbToLinear/
    // linearToSrgb bracket only the crossfade. Tagging SRGBColorSpace here would have the GPU
    // decode it a second time, drawing every scene at about (code/255)^2.2 — much darker than
    // the published file.
    expect(texture.colorSpace).toBe(THREE.NoColorSpace)
    expect(texture.colorSpace).not.toBe(THREE.SRGBColorSpace)
  })

  it('decodes a URL at most once, including while it is still loading', async () => {
    const load = stubLoader()
    const url = '/media/scenes/cache-check.jpg'

    const [first, second] = await Promise.all([loadSceneTexture(url), loadSceneTexture(url)])
    const third = await loadSceneTexture(url)

    expect(load).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
    expect(third).toBe(first)
  })
})
