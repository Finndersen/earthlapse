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

    // Paired with the fragment shader's colorspace re-encode (shaders.test.ts): change both together.
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(texture.colorSpace).not.toBe(THREE.NoColorSpace)
  })
})
