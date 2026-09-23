import { describe, expect, it } from 'vitest'

import { srgbHexToLinear, srgbToLinear } from './color'

describe('sRGB to linear', () => {
  it('maps black, white and mid-grey, with or without a leading #', () => {
    expect(srgbToLinear(0)).toBe(0)
    expect(srgbToLinear(1)).toBeCloseTo(1, 6)
    expect(srgbHexToLinear('#000000')).toEqual([0, 0, 0])
    srgbHexToLinear('#ffffff').forEach((v) => expect(v).toBeCloseTo(1, 6))
    srgbHexToLinear('808080').forEach((v) => expect(v).toBeCloseTo(0.2159, 3))
  })

  it('throws on a malformed string', () => {
    for (const bad of ['#fff', 'not-a-colour', '']) expect(() => srgbHexToLinear(bad)).toThrow()
  })
})
