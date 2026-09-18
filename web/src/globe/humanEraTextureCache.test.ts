import { describe, expect, it } from 'vitest'

import { mipmapDimensions } from './humanEraTextureCache'

// Regression guard for a real investigation: a faint, smooth, wavy "closed loop" pattern on the
// present (t=0) globe over open ocean turned out to be a Moiré artefact from WebGLRenderer's own
// implicit gl.generateMipmap() aliasing Natural Earth II's fine bathymetric shaded-relief
// striations — confirmed by forcing the fragment shader's base colour flat (loops vanished) and
// by disabling mipmaps entirely (loops also vanished, texture still correct). The fix builds the
// mip chain manually with a proper resampling filter (`buildHighQualityMipmaps`, a thin,
// canvas-dependent consumer of this pure function) instead of leaving the GPU to build one with a
// naive box filter. `mipmapDimensions` is the one part of that worth pinning without a browser
// canvas context: getting the halving/rounding or the stopping condition wrong would silently
// under- or over-build the chain (missing the 1x1 tail, or looping forever on an odd dimension).
describe('mipmapDimensions', () => {
  it('starts with the base dimensions at index 0, unchanged', () => {
    expect(mipmapDimensions(2048, 1024)[0]).toEqual([2048, 1024])
  })

  it('halves each axis independently down to 1x1, a power-of-two example', () => {
    expect(mipmapDimensions(8, 4)).toEqual([
      [8, 4],
      [4, 2],
      [2, 1],
      [1, 1],
    ])
  })

  it('floors odd dimensions rather than looping forever or overshooting', () => {
    // 5 -> 2 -> 1 (floor(5/2)=2, floor(2/2)=1), 3 -> 1 -> 1 (floor(3/2)=1, already 1 stays 1).
    expect(mipmapDimensions(5, 3)).toEqual([
      [5, 3],
      [2, 1],
      [1, 1],
    ])
  })

  it('always ends at exactly 1x1, never below it', () => {
    const dims = mipmapDimensions(2048, 1024)
    const last = dims.at(-1)!
    expect(last).toEqual([1, 1])
    for (const [w, h] of dims) {
      expect(w).toBeGreaterThanOrEqual(1)
      expect(h).toBeGreaterThanOrEqual(1)
    }
  })

  it('handles a 1x1 base without an infinite loop', () => {
    expect(mipmapDimensions(1, 1)).toEqual([[1, 1]])
  })

  it('matches the standard full mip-chain length, log2(max(w,h)) + 1, for a square power-of-two texture', () => {
    const dims = mipmapDimensions(4096, 4096)
    expect(dims.length).toBe(Math.log2(4096) + 1)
  })

  it('handles a non-power-of-two, non-square texture without stalling (T1 basemap tier shape)', () => {
    const dims = mipmapDimensions(4096, 2048)
    expect(dims.at(-1)).toEqual([1, 1])
    expect(dims.length).toBeGreaterThan(1)
  })
})
