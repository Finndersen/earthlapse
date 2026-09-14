/**
 * Portrait fixtures for this package's tests: a small lineage whose `portraits` block has the
 * shape `parseTreeData` produces (plates ascending by tDivergence). One node (`mammal`) has no
 * plate, and one adjacent pair (`luca` -> `tetrapod`) has no computed morph.
 */

import type { TreeData } from '@/data/curated'
import { EARTH_FORMATION } from '@/types/layer'
import type { LayerManifest } from '@/types/manifest'

export const PORTRAIT_MANIFEST: LayerManifest = {
  id: 'lineage',
  name: 'Your ancestor',
  surface: 'hud',
  dataKind: 'node',
  timeDomain: [0, EARTH_FORMATION],
  source: 'lineage',
  chartable: false,
  data: 'layers/lineage.json',
}

function plate(nodeId: string, kind: 'SPECIMEN' | 'MICROSCOPE') {
  return { nodeId, image: `portraits/${nodeId}.png`, plate: kind, pinned: '0123456789abcdef', width: 1024, height: 1024 }
}

function morph(older: string, younger: string, range: number) {
  const base = `portraits/morphs/${older}--${younger}`
  return {
    older,
    younger,
    forward: `${base}.forward.png`,
    backward: `${base}.backward.png`,
    forwardRange: range,
    backwardRange: range / 2,
    size: 128,
  }
}

export const PORTRAIT_TREE_DATA: TreeData = {
  id: 'lineage',
  nodes: [
    { id: 'human', parent: 'primate', label: 'Homo sapiens', tDivergence: 3e5, representative: null, note: null, citation: null },
    { id: 'primate', parent: 'mammal', label: 'Primates', tDivergence: 6.6e7, representative: null, note: null, citation: null },
    { id: 'mammal', parent: 'tetrapod', label: 'Mammals', tDivergence: 2.1e8, representative: null, note: null, citation: null },
    { id: 'tetrapod', parent: 'luca', label: 'Tetrapods', tDivergence: 3.75e8, representative: null, note: null, citation: null },
    { id: 'luca', parent: null, label: 'LUCA', tDivergence: 4.2e9, representative: null, note: null, citation: null },
  ],
  portraits: {
    plates: [plate('human', 'SPECIMEN'), plate('primate', 'SPECIMEN'), plate('tetrapod', 'SPECIMEN'), plate('luca', 'MICROSCOPE')],
    morphs: [morph('primate', 'human', 0.1), morph('tetrapod', 'primate', 0.2)],
  },
}

/** `t` a fraction `u` of the way through the half morph band *below* `current`'s divergence,
 *  toward `youngerBoundary` (the next younger plate's divergence, or the present). `u = 0` is
 *  the divergence itself (mix 0.5); `u = 1` is the band's lower edge (mix 1). */
export function tBelowDivergence(current: number, youngerBoundary: number, bandFraction: number, u: number): number {
  const half = (bandFraction / 2) * (Math.log1p(current) - Math.log1p(youngerBoundary))
  return Math.expm1(Math.log1p(current) - u * half)
}

/** `t` a fraction `u` of the way through the half morph band *above* `current`'s divergence,
 *  toward `olderDivergence`. `u = 0` is the divergence itself (mix 0.5); `u = 1` is the band's
 *  upper edge (mix 0). */
export function tAboveDivergence(current: number, olderDivergence: number, bandFraction: number, u: number): number {
  const half = (bandFraction / 2) * (Math.log1p(olderDivergence) - Math.log1p(current))
  return Math.expm1(Math.log1p(current) + u * half)
}
