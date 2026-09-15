import { describe, expect, it } from 'vitest'

import { GLOBE_FRAGMENT_SHADER, RIM_FRAGMENT_SHADER } from './shaders'

describe('globe fragment shaders', () => {
  it('re-encode their linear-light output for the sRGB canvas', () => {
    // Paired with textureCache.test.ts's SRGBColorSpace assertion: a plain ShaderMaterial's
    // fragment shader is user-authored GLSL, so — unlike three.js's built-in materials — it
    // does not automatically re-encode gl_FragColor for the renderer's output color space.
    // Losing this include while textures stay tagged SRGBColorSpace reintroduces exactly the
    // double-decode-with-no-re-encode bug scene/shaders.ts and layers/portraitShaders.ts had
    // (see their own textureCache tests) — everything sampled from a texture would render too
    // dark, undoing the fix documented at the bottom of GLOBE_FRAGMENT_SHADER.
    expect(GLOBE_FRAGMENT_SHADER).toContain('#include <colorspace_fragment>')
    expect(RIM_FRAGMENT_SHADER).toContain('#include <colorspace_fragment>')
  })
})
