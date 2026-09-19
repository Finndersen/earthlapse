import { describe, expect, it } from 'vitest'

import { SCENE_FRAGMENT_SHADER } from './shaders'

describe('SCENE_FRAGMENT_SHADER', () => {
  it('does not re-encode its output, because textures already sample as sRGB-encoded bytes', () => {
    // Paired with textureCache.test.ts's NoColorSpace assertion: textures upload NoColorSpace, so
    // adding `#include <colorspace_fragment>` here (the pattern `globe/shaders.ts` correctly uses,
    // since its textures stay SRGBColorSpace) would re-encode already-sRGB-encoded bytes a second
    // time and overbrighten every scene.
    expect(SCENE_FRAGMENT_SHADER).not.toContain('colorspace_fragment')
  })
})
