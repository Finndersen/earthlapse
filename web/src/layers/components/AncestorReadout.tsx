'use client'

/** Text-only ancestor readout (v1 — DESIGN §10): the node's label, its representative
 *  organism when known, and "since <tDivergence>" via `@/timeline`'s `formatGeoTime`. */

import { formatGeoTime } from '@/timeline'
import type { GeoTime, Layer, NodeValue } from '@/types/layer'

export interface AncestorReadoutProps {
  layer: Layer<NodeValue>
  t: GeoTime
}

export function AncestorReadout({ layer, t }: AncestorReadoutProps) {
  const node = layer.sample(t)

  if (node === null) {
    return <span>no data</span>
  }

  return (
    <span>
      <strong>{node.label}</strong>
      {node.representative !== undefined && <span> — {node.representative}</span>}
      <span> since {formatGeoTime(node.tDivergence)}</span>
    </span>
  )
}
