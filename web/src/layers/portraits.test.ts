import { describe, expect, it } from 'vitest'

import type { PortraitPlate } from '@/types/layer'

import { createNodeLayer } from './factories'
import { ANCESTOR_DATA, ANCESTOR_MANIFEST, deepFreeze } from './fixtures'
import { PORTRAIT_MANIFEST, PORTRAIT_TREE_DATA, tAboveDivergence, tBelowDivergence } from './portraitFixtures'
import {
  decodeFlowByte,
  indexPortraits,
  MIN_PORTRAIT_TRANSITION_SECONDS,
  MORPH_BAND_FRACTION,
  PORTRAIT_MIX_KEYING,
  portraitAt,
  portraitDrawState,
  portraitEase,
  portraitNeighbourUrls,
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

  it('throws naming both node ids when two plates share a tDivergence', () => {
    const tied = structuredClone(PORTRAIT_TREE_DATA)
    const primate = tied.nodes.find((n) => n.id === 'primate')!
    const tetrapod = tied.nodes.find((n) => n.id === 'tetrapod')!
    tetrapod.tDivergence = primate.tDivergence // both have plates; portraitAt assumes strictly increasing divergences

    expect(() => indexPortraits(tied)).toThrow(/primate.*tetrapod|tetrapod.*primate/)
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

  it('is half-way between the two plates at the exact moment the label switches', () => {
    // t = 6.6e7 is primate's own divergence -- where sampleTree flips the ancestor label to
    // "Primates" -- so the image must already read as half tetrapod, half primate, not still
    // 100% tetrapod.
    expect(portraitAt(index, 6.6e7)).toEqual({ from: plateOf('tetrapod'), to: plateOf('primate'), mix: 0.5 })
  })

  it('runs a smoothstep on each half-band either side of the divergence', () => {
    const above = portraitAt(index, tAboveDivergence(6.6e7, 3.75e8, MORPH_BAND_FRACTION, 0.5))!
    const below = portraitAt(index, tBelowDivergence(6.6e7, 3e5, MORPH_BAND_FRACTION, 0.5))!

    expect(above.from).toBe(plateOf('tetrapod'))
    expect(above.to).toBe(plateOf('primate'))
    expect(above.mix).toBeCloseTo(0.25)
    expect(below.mix).toBeCloseTo(0.75)
  })

  it('settles on the older plate alone once past the half-band above the divergence', () => {
    const past = tAboveDivergence(6.6e7, 3.75e8, MORPH_BAND_FRACTION, 1.01)
    expect(portraitAt(index, past)).toEqual({ from: plateOf('tetrapod'), to: plateOf('tetrapod'), mix: 0 })
  })

  it('settles on the younger plate alone once past the half-band below the divergence', () => {
    const past = tBelowDivergence(6.6e7, 3e5, MORPH_BAND_FRACTION, 1.01)
    expect(portraitAt(index, past)).toEqual({ from: plateOf('primate'), to: plateOf('primate'), mix: 0 })
  })

  it('measures the youngest plate band down to the present', () => {
    expect(portraitAt(index, 3e5)).toEqual({ from: plateOf('primate'), to: plateOf('human'), mix: 0.5 })
    const inside = portraitAt(index, tBelowDivergence(3e5, 0, MORPH_BAND_FRACTION, 0.5))!
    expect(inside.from).toBe(plateOf('primate'))
    expect(inside.mix).toBeCloseTo(0.75)
    expect(portraitAt(index, 0)).toEqual({ from: plateOf('human'), to: plateOf('human'), mix: 0 })
  })
})

describe('createNodeLayer with portraits', () => {
  it('adds the portrait target to the sampled node, purely, without touching the data', () => {
    const layer = createNodeLayer(PORTRAIT_MANIFEST, deepFreeze(structuredClone(PORTRAIT_TREE_DATA)))
    const t = 6.6e7 // primate's own divergence: the label switches here, and the portrait is half-way.

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

describe('portraitNeighbourUrls', () => {
  it('is empty with no index', () => {
    expect(portraitNeighbourUrls(null, plateOf('tetrapod'), plateOf('primate'), '/media')).toEqual([])
  })

  it("uses the next-older plate's image but `older`'s OWN morphFromOlder for its flow — not the next-older plate's own field", () => {
    // Drawn pair (primate, human): the next plate further back is tetrapod. The flow between
    // (tetrapod, primate) lives on `primate.morphFromOlder` (primate is the *younger* end of
    // that pair) — tetrapod has no morphFromOlder of its own; that would be the flow one step
    // further still, toward luca.
    expect(portraitNeighbourUrls(index, plateOf('primate'), plateOf('human'), '/media')).toEqual([
      '/media/portraits/tetrapod.png',
      '/media/portraits/morphs/tetrapod--primate.forward.png',
      '/media/portraits/morphs/tetrapod--primate.backward.png',
    ])
  })

  it("uses the next-younger plate's own morphFromOlder for its flow", () => {
    // Drawn pair (tetrapod, primate): the next plate closer to the present is human, whose own
    // morphFromOlder is the (primate, human) flow. tetrapod itself has no morphFromOlder, so
    // the older side here contributes no flow.
    expect(portraitNeighbourUrls(index, plateOf('tetrapod'), plateOf('primate'), '/media')).toEqual([
      '/media/portraits/luca.png',
      '/media/portraits/human.png',
      '/media/portraits/morphs/primate--human.forward.png',
      '/media/portraits/morphs/primate--human.backward.png',
    ])
  })

  it('omits a side with no neighbour — the oldest plate has none further back, the youngest none closer to the present', () => {
    expect(portraitNeighbourUrls(index, plateOf('luca'), plateOf('luca'), '/media')).toEqual(['/media/portraits/tetrapod.png'])
    expect(portraitNeighbourUrls(index, plateOf('human'), plateOf('human'), '/media')).toEqual([
      '/media/portraits/primate.png',
      '/media/portraits/morphs/primate--human.forward.png',
      '/media/portraits/morphs/primate--human.backward.png',
    ])
  })

  it('handles the alone state (older === younger) without double-adding — both sides add their own, distinct flow exactly once', () => {
    // primate alone: the older-side flow (toward tetrapod) lives on primate's own
    // morphFromOlder; the younger-side flow (toward human) lives on human's own morphFromOlder.
    // Both are present, both are different morphs, and older/younger being the same plate here
    // must not cause either to be skipped or added twice.
    expect(portraitNeighbourUrls(index, plateOf('primate'), plateOf('primate'), '/media')).toEqual([
      '/media/portraits/tetrapod.png',
      '/media/portraits/morphs/tetrapod--primate.forward.png',
      '/media/portraits/morphs/tetrapod--primate.backward.png',
      '/media/portraits/human.png',
      '/media/portraits/morphs/primate--human.forward.png',
      '/media/portraits/morphs/primate--human.backward.png',
    ])
  })

  it('resolves every URL against assetBase, like the drawn plates themselves', () => {
    const [nextOlder] = portraitNeighbourUrls(index, plateOf('primate'), plateOf('human'), 'https://cdn.example/media/')
    expect(nextOlder).toBe('https://cdn.example/media/portraits/tetrapod.png')
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
