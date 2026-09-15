'use client'

/** `value unit` for a scalar layer at `t`. Bounds are deliberately not printed: they come and go
 *  between samples and reflowed the HUD, and are usually narrower than the value's own precision
 *  (the chart dock still draws them as a band). Never `0`
 *  when the layer has nothing at `t`: "no data" when `t` sits outside the layer's whole
 *  domain, or "no record" when it is inside the domain but in a declared gap (ADR-027) — the
 *  only other reason `sample()` returns null there. */

import type { GeoTime, Layer, ScalarValue } from '@/types/layer'

import { formatValue } from '../format'
import styles from './hud.module.css'

export interface ScalarReadoutProps {
  layer: Layer<ScalarValue>
  t: GeoTime
}

export function ScalarReadout({ layer, t }: ScalarReadoutProps) {
  const value = layer.sample(t)
  const inDomain = t >= layer.timeDomain[0] && t <= layer.timeDomain[1]

  return (
    <span className={styles.readout}>
      <span className={styles.label}>{layer.name}</span>{' '}
      {value === null ? (
        <span className={styles.noData} aria-live="polite">
          {inDomain ? 'no record' : 'no data'}
        </span>
      ) : (
        <span className={styles.value} aria-live="polite">
          {formatValue(value.value)} <span className={styles.unit}>{value.unit}</span>
        </span>
      )}
    </span>
  )
}
