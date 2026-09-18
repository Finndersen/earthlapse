import { describe, expect, it } from 'vitest'

import { probeWebgl, supportsWebGL } from './webgl'

describe('supportsWebGL', () => {
  it('returns false in jsdom (no WebGL context available) rather than throwing', () => {
    expect(supportsWebGL()).toBe(false)
  })
})

describe('probeWebgl', () => {
  it('reports unsupported with maxTextureSize 0 in jsdom, without throwing', () => {
    expect(probeWebgl()).toEqual({ supported: false, maxTextureSize: 0 })
  })
})
