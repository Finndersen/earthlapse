'use client'

/** Text-only ancestor readout (DESIGN §10): an "Ancestor since <tDivergence>" kicker over the
 *  node's label. */

import { formatGeoTime } from '@/timeline'
import type { GeoTime, Layer, NodeValue } from '@/types/layer'

import styles from './hud.module.css'

export interface AncestorReadoutProps {
  layer: Layer<NodeValue>
  t: GeoTime
}

export function AncestorReadout({ layer, t }: AncestorReadoutProps) {
  const node = layer.sample(t)

  return (
    <span className={styles.ancestor}>
      <span className={styles.label}>
        Ancestor{node !== null && ` since ${formatGeoTime(node.tDivergence)}`}
      </span>
      {node === null ? <span className={styles.noData}>no data</span> : <strong className={styles.ancestorName}>{node.label}</strong>}
    </span>
  )
}
