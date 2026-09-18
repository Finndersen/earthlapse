'use client'

/** `value unit` for a scalar layer at `t`. Bounds are deliberately not printed: they come and go
 *  between samples and reflowed the HUD, and are usually narrower than the value's own precision
 *  (the chart dock still draws them as a band). Never `0`
 *  when the layer has nothing at `t`: "no data" when `t` sits outside the layer's whole
 *  domain, or "no record" when it is inside the domain but in a declared gap (ADR-027) — the
 *  only other reason `sample()` returns null there.
 *
 *  A layer whose own domain doesn't reach the present (`timeDomain[0] > 0` — its newest real
 *  sample sits some years before now, e.g. HYDE 3.2's population total ending 2015 CE) holds
 *  that newest sample for every `t` nearer than it, rather than reading "no data" — the same
 *  "data simply ends, hold" convention the population-density globe overlay already uses
 *  (`web/src/globe/density.ts`'s `densityBlendAt`) — annotated "as of <year>" — a calendar year where one reads naturally since silently
 *  freezing the number would misrepresent a 2015 total as a live reading for right now. Driven
 *  by the domain, not a layer id, so this applies to any future layer whose data ends before the
 *  present the same way, not just this one. */

import { formatCalendarYear, formatGeoTime } from '@/timeline'
import type { GeoTime, Layer, ScalarValue } from '@/types/layer'

import { formatScalarValue } from '../format'
import styles from './hud.module.css'

export interface ScalarReadoutProps {
  layer: Layer<ScalarValue>
  t: GeoTime
}

export function ScalarReadout({ layer, t }: ScalarReadoutProps) {
  const [newest, oldest] = layer.timeDomain
  const held = t < newest
  const sampledT = held ? newest : t
  const value = layer.sample(sampledT)
  const inDomain = sampledT >= newest && sampledT <= oldest

  return (
    <span className={styles.readout}>
      <span className={styles.label}>{layer.name}</span>{' '}
      {value === null ? (
        <span className={styles.noData} aria-live="polite">
          {inDomain ? 'no record' : 'no data'}
        </span>
      ) : (
        <span className={styles.value} data-testid="scalar-readout-value" aria-live="polite">
          {formatScalarValue(value.value, value.unit)} <span className={styles.unit}>{value.unit}</span>
        </span>
      )}
      {held && value !== null && (
        <span className={styles.ancestorSince}>as of {formatCalendarYear(sampledT) ?? formatGeoTime(sampledT)}</span>
      )}
    </span>
  )
}
