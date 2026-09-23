import { describe, expect, it } from 'vitest'

import { mipmapDimensions } from './humanEraTextureCache'

describe('mipmapDimensions', () => {
  it('halves each axis independently down to 1x1, a power-of-two example', () => {
    expect(mipmapDimensions(8, 4)).toEqual([
      [8, 4],
      [4, 2],
      [2, 1],
      [1, 1],
    ])
  })

  it('floors odd dimensions rather than looping forever or overshooting', () => {
    expect(mipmapDimensions(5, 3)).toEqual([
      [5, 3],
      [2, 1],
      [1, 1],
    ])
  })

  it('handles a 1x1 base without an infinite loop', () => {
    expect(mipmapDimensions(1, 1)).toEqual([[1, 1]])
  })

})
