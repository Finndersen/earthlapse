'use client'

/** `value unit` for a scalar layer at `t`, with bounds when the layer carries them. Renders
 *  "no data" — never `0` — when the layer has nothing at `t`. */

import type { GeoTime, Layer, ScalarValue } from '@/types/layer'

import { formatValue } from '../format'
import styles from './hud.module.css'

export interface ScalarReadoutProps {
  layer: Layer<ScalarValue>
  t: GeoTime
}

export function ScalarReadout({ layer, t }: ScalarReadoutProps) {
  const value = layer.sample(t)

  return (
    <span className={styles.readout}>
      <span className={styles.label}>{layer.name}</span>{' '}
      {value === null ? (
        <span className={styles.noData} aria-live="polite">
          no data
        </span>
      ) : (
        <span className={styles.value} aria-live="polite">
          {formatValue(value.value)} <span className={styles.unit}>{value.unit}</span>
          {value.bounds && (
            <span className={styles.bounds}>
              {' '}
              ({formatValue(value.bounds[0])}–{formatValue(value.bounds[1])} {value.unit})
            </span>
          )}
        </span>
      )}
    </span>
  )
}
