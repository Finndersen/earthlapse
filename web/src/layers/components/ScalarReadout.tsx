'use client'

/** `value unit` for a scalar layer at `t`, with bounds when the layer carries them. Renders
 *  "no data" — never `0` — when the layer has nothing at `t`. */

import type { GeoTime, Layer, ScalarValue } from '@/types/layer'

import { formatValue } from '../format'

export interface ScalarReadoutProps {
  layer: Layer<ScalarValue>
  t: GeoTime
}

export function ScalarReadout({ layer, t }: ScalarReadoutProps) {
  const value = layer.sample(t)

  return (
    <span>
      <span>{layer.name}</span>{' '}
      {value === null ? (
        <span aria-live="polite">no data</span>
      ) : (
        <span aria-live="polite">
          {formatValue(value.value)} {value.unit}
          {value.bounds && (
            <span>
              {' '}
              ({formatValue(value.bounds[0])}–{formatValue(value.bounds[1])} {value.unit})
            </span>
          )}
        </span>
      )}
    </span>
  )
}
