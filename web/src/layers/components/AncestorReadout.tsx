'use client'

/** Text-only ancestor readout (v1 — DESIGN §10): the node's label, its representative
 *  organism when known, and "since <tDivergence>" via `@/timeline`'s `formatGeoTime`. */

import { formatGeoTime } from '@/timeline'
import type { GeoTime, Layer, NodeValue } from '@/types/layer'

import styles from './hud.module.css'

export interface AncestorReadoutProps {
  layer: Layer<NodeValue>
  t: GeoTime
}

export function AncestorReadout({ layer, t }: AncestorReadoutProps) {
  const node = layer.sample(t)

  if (node === null) {
    return <span className={styles.noData}>no data</span>
  }

  return (
    <span className={styles.ancestor}>
      <strong className={styles.ancestorName}>{node.label}</strong>
      {node.representative !== undefined && (
        <span className={styles.ancestorRepresentative}>
          <span className={styles.ancestorDash}> — </span>
          {node.representative}
        </span>
      )}
      <span className={styles.ancestorSince}> since {formatGeoTime(node.tDivergence)}</span>
    </span>
  )
}
