'use client'

/** Nice, non-overlapping labels under the scrub track (README §2). Purely presentational —
 *  all the "which ticks, where" logic lives in `ticks.ts`; this just measures its own width
 *  and renders what that returns. */

import { useMemo } from 'react'

import type { TimeScale } from '@/types/layer'

import type { TimeWindow } from '../scale'
import { generateTicks } from '../ticks'
import { useTrackWidth } from '../useTrackWidth'

interface AxisTicksProps {
  window: TimeWindow
  scale: TimeScale
}

export function AxisTicks({ window: visibleWindow, scale }: AxisTicksProps) {
  const [ref, widthPx] = useTrackWidth<HTMLDivElement>()
  const ticks = useMemo(() => generateTicks(visibleWindow, scale, widthPx), [visibleWindow, scale, widthPx])

  return (
    <div ref={ref} aria-hidden style={{ position: 'relative', height: 16, width: '100%' }}>
      {ticks.map((tick) => (
        <span
          key={tick.t}
          style={{
            position: 'absolute',
            left: `${tick.u * 100}%`,
            transform: 'translateX(-50%)',
            fontSize: 10,
            letterSpacing: 0.2,
            color: 'rgba(255,255,255,0.4)',
            whiteSpace: 'nowrap',
          }}
        >
          {tick.label}
        </span>
      ))}
    </div>
  )
}
