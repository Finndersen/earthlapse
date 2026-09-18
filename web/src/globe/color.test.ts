import { describe, expect, it } from 'vitest'

import { srgbHexToLinear, srgbToLinear } from './color'

describe('srgbToLinear', () => {
  it('maps black to 0', () => {
    expect(srgbToLinear(0)).toBe(0)
  })

  it('maps white to 1', () => {
    expect(srgbToLinear(1)).toBeCloseTo(1, 6)
  })
})

describe('srgbHexToLinear', () => {
  it('maps black to [0, 0, 0]', () => {
    expect(srgbHexToLinear('#000000')).toEqual([0, 0, 0])
  })

  it('maps white to [1, 1, 1]', () => {
    const [r, g, b] = srgbHexToLinear('#ffffff')
    expect(r).toBeCloseTo(1, 6)
    expect(g).toBeCloseTo(1, 6)
    expect(b).toBeCloseTo(1, 6)
  })

  it('maps mid-grey to approximately 0.2159 linear', () => {
    const [r, g, b] = srgbHexToLinear('#808080')
    expect(r).toBeCloseTo(0.2159, 3)
    expect(g).toBeCloseTo(0.2159, 3)
    expect(b).toBeCloseTo(0.2159, 3)
  })

  it('tolerates a missing leading #', () => {
    expect(srgbHexToLinear('808080')).toEqual(srgbHexToLinear('#808080'))
  })

  it('throws on a malformed string', () => {
    expect(() => srgbHexToLinear('#fff')).toThrow()
    expect(() => srgbHexToLinear('not-a-colour')).toThrow()
    expect(() => srgbHexToLinear('')).toThrow()
  })
})
