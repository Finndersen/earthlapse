import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { overlayKindUniform } from './overlay'
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

describe("the globe's single overlay slot", () => {
  it('declares uOverlayKind and every renamed uOverlay* uniform', () => {
    expect(GLOBE_FRAGMENT_SHADER).toContain('uniform int uOverlayKind;')
    expect(GLOBE_FRAGMENT_SHADER).toContain('uniform sampler2D uOverlayBefore;')
    expect(GLOBE_FRAGMENT_SHADER).toContain('uniform sampler2D uOverlayAfter;')
    expect(GLOBE_FRAGMENT_SHADER).toContain('uniform float uOverlayMix;')
    expect(GLOBE_FRAGMENT_SHADER).toContain('uniform vec3 uOverlayChannel;')
    expect(GLOBE_FRAGMENT_SHADER).toContain('uniform float uOverlayDMax;')
    expect(GLOBE_FRAGMENT_SHADER).toContain('uniform float uOverlayStrength;')
  })

  it('declares no uDensity* uniform', () => {
    expect(GLOBE_FRAGMENT_SHADER).not.toMatch(/uniform\s+\S+\s+uDensity\w*;/)
  })

  it('generates the cleared-land kind constant from overlayKindUniform', () => {
    expect(GLOBE_FRAGMENT_SHADER).toContain(
      `const int OVERLAY_KIND_CLEARED_LAND = ${overlayKindUniform('cleared_land')};`,
    )
  })

  it('defines both ramps and dispatches between them by kind', () => {
    expect(GLOBE_FRAGMENT_SHADER).toContain('vec4 densityRampAt(float density) {')
    expect(GLOBE_FRAGMENT_SHADER).toContain('vec4 clearedLandRampAt(float severity) {')
    const dispatchStart = GLOBE_FRAGMENT_SHADER.indexOf('vec4 overlayColorAt(float encoded) {')
    expect(dispatchStart).toBeGreaterThan(-1)
    const dispatchBody = GLOBE_FRAGMENT_SHADER.slice(dispatchStart, dispatchStart + 400)
    expect(dispatchBody).toContain('clearedLandRampAt(')
    expect(dispatchBody).toContain('densityRampAt(')
  })
})

describe("Globe.tsx's uniform props", () => {
  // The one bug class this package's other tests structurally cannot catch: a `uniforms-uX-value`
  // prop is an untyped JSX string and the shader is an opaque template literal, so renaming a
  // uniform on one side leaves the other silently binding nothing — a green suite over a globe
  // that has quietly stopped painting a layer. Reading both sides as source is the only place
  // the two names ever meet.
  const globeSource = readFileSync(resolve(process.cwd(), 'src/globe/Globe.tsx'), 'utf8')

  it('every one names a uniform the fragment shader declares', () => {
    const bound = [...globeSource.matchAll(/uniforms-(u\w+)-value/g)].map((match) => match[1]!)
    expect(new Set(bound).size).toBeGreaterThan(0)
    const declared = new Set(
      [...GLOBE_FRAGMENT_SHADER.matchAll(/uniform\s+\S+\s+(u\w+)\s*;/g)].map((match) => match[1]!),
    )
    expect([...new Set(bound)].filter((name) => !declared.has(name))).toEqual([])
  })
})
