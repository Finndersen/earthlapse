'use client'

/** Nice, non-overlapping labels under the scrub track. Purely presentational — all the
 *  "which ticks, where" logic lives in `ticks.ts`; this just measures its own width and
 *  renders what that returns, clamping the two edge labels via `tickLabelAlign` so a tick
 *  like "present" at `u = 1` never renders clipped outside the track. */

import { useMemo } from 'react'

import type { TimeScale } from '@/types/layer'

import type { TimeWindow } from '../scale'
import { generateTicks, tickLabelAlign } from '../ticks'
import { useTrackWidth } from '../useTrackWidth'
import styles from './AxisTicks.module.css'

interface AxisTicksProps {
  window: TimeWindow
  scale: TimeScale
}

const ALIGN_TRANSFORM: Record<ReturnType<typeof tickLabelAlign>, string> = {
  start: 'translateX(0)',
  center: 'translateX(-50%)',
  end: 'translateX(-100%)',
}

export function AxisTicks({ window: visibleWindow, scale }: AxisTicksProps) {
  const [ref, widthPx] = useTrackWidth<HTMLDivElement>()
  const ticks = useMemo(() => generateTicks(visibleWindow, scale, widthPx), [visibleWindow, scale, widthPx])

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
