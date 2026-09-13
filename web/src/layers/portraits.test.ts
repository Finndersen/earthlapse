import { describe, expect, it } from 'vitest'

import type { PortraitPlate } from '@/types/layer'

import { createNodeLayer } from './factories'
import { ANCESTOR_DATA, ANCESTOR_MANIFEST, deepFreeze } from './fixtures'
import { PORTRAIT_MANIFEST, PORTRAIT_TREE_DATA, tInBand } from './portraitFixtures'
import {
  decodeFlowByte,
  indexPortraits,
  MIN_PORTRAIT_TRANSITION_SECONDS,
  MORPH_BAND_FRACTION,
  PORTRAIT_MIX_KEYING,
  portraitAt,
  portraitDrawState,
  portraitEase,
} from './portraits'

const index = indexPortraits(PORTRAIT_TREE_DATA)!

function plateOf(nodeId: string): PortraitPlate {
  const found = index.plates.find((p) => p.nodeId === nodeId)
  if (found === undefined) throw new Error(`no plate ${nodeId}`)
  return found
}

describe('indexPortraits', () => {
  it('is null for a lineage that publishes no portraits', () => {
    expect(indexPortraits(ANCESTOR_DATA)).toBeNull()
  })

  it('joins plates to their divergence, youngest first, and attaches each computed morph to its younger plate', () => {
    expect(index.plates).toEqual([
      {
        nodeId: 'human',
        tDivergence: 3e5,
        image: 'portraits/human.png',
        plate: 'SPECIMEN',
        width: 1024,
        height: 1024,
        morphFromOlder: {
          older: 'primate',
          forward: 'portraits/morphs/primate--human.forward.png',
          backward: 'portraits/morphs/primate--human.backward.png',
          forwardRange: 0.1,
          backwardRange: 0.05,
          size: 128,
        },
      },
      {
        nodeId: 'primate',
        tDivergence: 6.6e7,
        image: 'portraits/primate.png',
        plate: 'SPECIMEN',
        width: 1024,
        height: 1024,
        morphFromOlder: {
          older: 'tetrapod',
          forward: 'portraits/morphs/tetrapod--primate.forward.png',
          backward: 'portraits/morphs/tetrapod--primate.backward.png',
          forwardRange: 0.2,
          backwardRange: 0.1,
          size: 128,
        },
      },
      { nodeId: 'tetrapod', tDivergence: 3.75e8, image: 'portraits/tetrapod.png', plate: 'SPECIMEN', width: 1024, height: 1024 },
      { nodeId: 'luca', tDivergence: 4.2e9, image: 'portraits/luca.png', plate: 'MICROSCOPE', width: 1024, height: 1024 },
    ])
  })
})

describe('portraitAt', () => {
  it('is null before the oldest plate has diverged', () => {
    expect(portraitAt(index, 4.3e9)).toBeNull()
  })

  it('shows the oldest plate alone throughout its span', () => {
    expect(portraitAt(index, 1e9)).toEqual({ from: plateOf('luca'), to: plateOf('luca'), mix: 0 })
  })

  it('shows the nearest older plate for a node without one, clear of any band', () => {
    // t = 1e8 is inside the plate-less `mammal` node's span, well below tetrapod's band.
    expect(portraitAt(index, 1e8)).toEqual({ from: plateOf('tetrapod'), to: plateOf('tetrapod'), mix: 0 })
  })

  it('starts the morph at the divergence, from the older plate', () => {
    expect(portraitAt(index, 6.6e7)).toEqual({ from: plateOf('tetrapod'), to: plateOf('primate'), mix: 0 })
  })

  it('runs a smoothstep across MORPH_BAND_FRACTION of the log1p gap to the next younger plate', () => {
    const quarter = portraitAt(index, tInBand(6.6e7, 3e5, MORPH_BAND_FRACTION, 0.25))!
    const half = portraitAt(index, tInBand(6.6e7, 3e5, MORPH_BAND_FRACTION, 0.5))!

    expect(quarter.from).toBe(plateOf('tetrapod'))
    expect(quarter.to).toBe(plateOf('primate'))
    expect(quarter.mix).toBeCloseTo(0.15625)
    expect(half.mix).toBeCloseTo(0.5)
  })

  it('settles on the younger plate alone once past the band', () => {
    const past = tInBand(6.6e7, 3e5, MORPH_BAND_FRACTION, 1.01)
    expect(portraitAt(index, past)).toEqual({ from: plateOf('primate'), to: plateOf('primate'), mix: 0 })
  })

  it('measures the youngest plate band down to the present', () => {
    const inside = portraitAt(index, tInBand(3e5, 0, MORPH_BAND_FRACTION, 0.5))!
    expect(inside.from).toBe(plateOf('primate'))
    expect(inside.mix).toBeCloseTo(0.5)
    expect(portraitAt(index, 0)).toEqual({ from: plateOf('human'), to: plateOf('human'), mix: 0 })
  })
})

describe('createNodeLayer with portraits', () => {
  it('adds the portrait target to the sampled node, purely, without touching the data', () => {
    const layer = createNodeLayer(PORTRAIT_MANIFEST, deepFreeze(structuredClone(PORTRAIT_TREE_DATA)))
    const t = tInBand(6.6e7, 3e5, MORPH_BAND_FRACTION, 0.5)

    const value = layer.sample(t)

    expect(value?.id).toBe('primate')
    expect(value?.portrait?.from.nodeId).toBe('tetrapod')
    expect(value?.portrait?.to.nodeId).toBe('primate')
    expect(value?.portrait?.mix).toBeCloseTo(0.5)
    expect(layer.sample(t)).toEqual(value)
  })

  it('samples no portrait for a lineage without one', () => {
    const value = createNodeLayer(ANCESTOR_MANIFEST, ANCESTOR_DATA).sample(5e7)
    expect(value).not.toBeNull()
    expect(value).not.toHaveProperty('portrait')
  })
})

describe('portraitDrawState', () => {
  it('draws an older-to-younger mix as-is, with the morph between the two', () => {
    const state = portraitDrawState({ from: plateOf('tetrapod'), to: plateOf('primate'), mix: 0.3 })
    expect(state).toEqual({ older: plateOf('tetrapod'), younger: plateOf('primate'), alpha: 0.3, morph: plateOf('primate').morphFromOlder })
  })

  it('reverses a younger-to-older mix, as the limiter produces when scrubbing back', () => {
    const state = portraitDrawState({ from: plateOf('primate'), to: plateOf('tetrapod'), mix: 0.3 })
    expect(state.older).toBe(plateOf('tetrapod'))
    expect(state.alpha).toBeCloseTo(0.7)
    expect(state.morph).toBe(plateOf('primate').morphFromOlder)
  })

  it('crossfades a direct jump across several plates, and a pair with no computed morph', () => {
    expect(portraitDrawState({ from: plateOf('luca'), to: plateOf('human'), mix: 0.5 }).morph).toBeNull()
    expect(portraitDrawState({ from: plateOf('luca'), to: plateOf('tetrapod'), mix: 0.5 }).morph).toBeNull()
  })

  it('draws one plate alone with no morph', () => {
    expect(portraitDrawState({ from: plateOf('human'), to: plateOf('human'), mix: 0 })).toEqual({
      older: plateOf('human'),
      younger: plateOf('human'),
      alpha: 0,
      morph: null,
    })
  })
})

describe('flow decoding and easing', () => {
  it('decodes the pipeline byte convention: 1, 128 and 255 are -range, 0 and +range', () => {
    expect([1, 128, 255].map((byte) => decodeFlowByte(byte, 0.25))).toEqual([-0.25, 0, 0.25])
  })

  it('eases with a smoothstep that is exact at both ends', () => {
    expect([portraitEase(0), portraitEase(0.5), portraitEase(1)]).toEqual([0, 0.5, 1])
  })

  it('keys plates by node and measures distance in log1p', () => {
    expect(PORTRAIT_MIX_KEYING.same(plateOf('human'), { ...plateOf('human') })).toBe(true)
    expect(PORTRAIT_MIX_KEYING.distance(plateOf('human'), plateOf('primate'))).toBeCloseTo(Math.log1p(6.6e7) - Math.log1p(3e5))
  })

  it('has tunables in range', () => {
    expect(MORPH_BAND_FRACTION).toBeGreaterThan(0)
    expect(MORPH_BAND_FRACTION).toBeLessThan(1)
    expect(MIN_PORTRAIT_TRANSITION_SECONDS).toBeGreaterThan(0)
  })
})
