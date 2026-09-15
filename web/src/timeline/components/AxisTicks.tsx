'use client'

/** Nice, non-overlapping labels under the scrub track (README §2: "nice round values for the
 *  current span and scale (Ga, Ma, ka, years, and 'present'), with no overlapping labels"). The
 *  "which ticks, where" layout logic lives in `ticks.ts`; this only renders what that returns,
 *  clamping the two edge labels via `tickLabelAlign` so a tick like "present" at `u = 1` never
 *  renders clipped outside the track. Purely presentational: the ruler does not drag. The window
 *  is the selected era section's (ADR-024); see Timeline's own doc comment. */

import { useMemo } from 'react'

import type { GeoTime, TimeScale } from '@/types/layer'

import type { TimeWindow } from '../scale'
import { generateTicks, tickLabelAlign } from '../ticks'
import { useTrackWidth } from '../useTrackWidth'
import styles from './AxisTicks.module.css'

interface AxisTicksProps {
  window: TimeWindow
  scale: TimeScale
  /** The symlog knee `scale` was actually built with, when it differs from the bare
   *  `symlogKnee(window)` default (re-review fix, 2026-09-15) — `Timeline.tsx` passes
   *  `sectionSymlogKnee(sectionId)` so this module's near-linear tick-style judgement stays in
   *  sync with the scale it's ticking rather than silently disagreeing with it. Omit to fall
   *  back to `generateTicks`'s own default. */
  knee?: GeoTime
}

const ALIGN_TRANSFORM: Record<ReturnType<typeof tickLabelAlign>, string> = {
  start: 'translateX(0)',
  center: 'translateX(-50%)',
  end: 'translateX(-100%)',
}

export function AxisTicks({ window: visibleWindow, scale, knee }: AxisTicksProps) {
  const [ref, widthPx] = useTrackWidth<HTMLDivElement>()
  const ticks = useMemo(() => generateTicks(visibleWindow, scale, widthPx, knee), [visibleWindow, scale, widthPx, knee])

  return (
    <div ref={ref} aria-hidden className={styles.ticks}>
      {ticks.map((tick) => (
        <span
          key={tick.t}
          className={styles.label}
          style={{
            left: `${tick.u * 100}%`,
            transform: ALIGN_TRANSFORM[tickLabelAlign(tick.u, tick.label, widthPx)],
          }}
        >
          {tick.label}
        </span>
      ))}
    </div>
  )
}
