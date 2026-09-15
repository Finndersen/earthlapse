import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadTexture } from './textureCache'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubFetchAndDecode(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, blob: async () => new Blob() }) as unknown as Response),
  )
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({}) as unknown as ImageBitmap),
  )
}

describe('loadTexture', () => {
  it('tags globe textures SRGBColorSpace, because the fragment shader re-encodes its own output', async () => {
    stubFetchAndDecode()

    const texture = await loadTexture('/media/textures/paleodem/colour-space-check.webp')

    // Unlike scene/textureCache.ts and layers/portraitTextures.ts, the globe's fragment shader
    // (globe/shaders.ts) ends every path with `#include <colorspace_fragment>`, which re-encodes
    // its linear-light output for the renderer's sRGB canvas. SRGBColorSpace here is what makes
    // the GPU decode the sampled texel to match — dropping it (e.g. to "fix" this the same way
    // as the scene/portrait textures) would leave the shader's linear-light math operating on
    // still-sRGB-encoded bytes and the final re-encode would then overbrighten, not correct, the
    // image. The two must change together.
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(texture.colorSpace).not.toBe(THREE.NoColorSpace)
  })
})
