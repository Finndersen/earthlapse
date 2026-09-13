import { describe, expect, it } from 'vitest'

import { supportsWebGL } from './webgl'

describe('supportsWebGL', () => {
  it('returns false in jsdom (no WebGL context available) rather than throwing', () => {
    expect(supportsWebGL()).toBe(false)
  })
})
