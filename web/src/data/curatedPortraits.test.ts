import { describe, expect, it } from 'vitest'

import { parseTreeData } from './curated'

const NODES = [
  { id: 'luca', parent: null, label: 'LUCA', tDivergence: 4.2e9, representative: null, note: null, citation: null },
  { id: 'tetrapod', parent: 'luca', label: 'Tetrapods', tDivergence: 3.75e8, representative: null, note: null, citation: null },
  { id: 'human', parent: 'tetrapod', label: 'Homo sapiens', tDivergence: 3e5, representative: null, note: null, citation: null },
]

function plate(nodeId: string, kind = 'SPECIMEN') {
  return { nodeId, image: `portraits/${nodeId}.png`, plate: kind, pinned: 'abcdef0123456789', width: 1024, height: 1024 }
}

const MORPH = {
  older: 'tetrapod',
  younger: 'human',
  forward: 'portraits/morphs/tetrapod--human.forward.png',
  backward: 'portraits/morphs/tetrapod--human.backward.png',
  forwardRange: 0.12,
  backwardRange: 0.08,
  size: 128,
}

function tree(portraits: unknown) {
  return { id: 'lineage', nodes: NODES, portraits }
}

describe('parseTreeData: portraits (ADR-015)', () => {
  it('omits the block when the layer file has none, as files from before portraits', () => {
    expect(parseTreeData({ id: 'lineage', nodes: NODES })).not.toHaveProperty('portraits')
  })

  it('sorts plates by their node divergence and keeps the morphs', () => {
    const parsed = parseTreeData(tree({ plates: [plate('luca', 'MICROSCOPE'), plate('human'), plate('tetrapod')], morphs: [MORPH] }))

    expect(parsed.portraits).toEqual({
      plates: [plate('human'), plate('tetrapod'), plate('luca', 'MICROSCOPE')],
      morphs: [MORPH],
    })
  })

  it.each([
    ['an unknown node', { plates: [plate('dodo')], morphs: [] }, 'unknown node dodo'],
    ['an unknown plate type', { plates: [plate('human', 'SKETCH')], morphs: [] }, 'unknown plate type "SKETCH"'],
    ['a repeated node', { plates: [plate('human'), plate('human')], morphs: [] }, 'more than one plate'],
    ['no plates', { plates: [], morphs: [] }, 'empty plates'],
    ['a morph between non-adjacent plates', { plates: [plate('human'), plate('tetrapod'), plate('luca')], morphs: [{ ...MORPH, older: 'luca' }] }, 'joins no adjacent plates'],
    ['a zero flow range', { plates: [plate('human'), plate('tetrapod')], morphs: [{ ...MORPH, forwardRange: 0 }] }, 'expected a positive number'],
  ])('rejects %s', (_, portraits, message) => {
    expect(() => parseTreeData(tree(portraits))).toThrow(message)
  })
})
