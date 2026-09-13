'use client'

/**
 * The hover loupe (brief §3): a "focus + context" magnifier that floats above the cursor while
 * it sits over the scrub track, without distorting the main track itself — the main track's own
 * cursor->time mapping stays exactly as it was; this is a separate, independently-scaled
 * overlay reading the same window (`loupe.ts`'s `loupeWindow`) and the same candidates
 * (`loupeCandidates`). Purely presentational: all the geometry and snap-distance math lives in
 * `loupe.ts` so it's directly unit-testable without mounting React.
 *
 * `position: fixed` (clamped inside the viewport by the caller via `loupePosition`) so it can
 * float above anything else in the shell rather than being clipped by the scrub track's own
 * `overflow`. `visible` toggles a CSS opacity fade (120ms, per the brief) rather than
 * mount/unmount, so the fade actually plays in both directions.
 */

import type { GeoTime } from '@/types/layer'

import { formatGeoTime } from '../format'
import type { LoupeCandidate, LoupePosition } from '../loupe'
import { LOUPE_HEIGHT_PX, LOUPE_WIDTH_PX } from '../loupe'
import { createLinearScale, type TimeWindow } from '../scale'
import { generateTicks } from '../ticks'
import { clampUnit } from '../util'
import styles from './Loupe.module.css'

interface LoupeProps {
  visible: boolean
  position: LoupePosition
  window: TimeWindow
  cursorT: GeoTime
  candidates: readonly LoupeCandidate[]
  snapTarget: LoupeCandidate | undefined
}

export function Loupe({ visible, position, window: loupeWin, cursorT, candidates, snapTarget }: LoupeProps) {
  const scale = createLinearScale(loupeWin)
  const ticks = generateTicks(loupeWin, scale, LOUPE_WIDTH_PX)
  const cursorU = clampUnit(scale.toUnit(cursorT))
  const displayT = snapTarget?.t ?? cursorT

  return (
    <div
      aria-hidden
      className={styles.loupe}
      data-visible={visible}
      style={{ left: `${position.left}px`, top: `${position.top}px`, width: LOUPE_WIDTH_PX, height: LOUPE_HEIGHT_PX }}
    >
      <div className={styles.track}>
        {candidates.map((c) => {
          const u = clampUnit(scale.toUnit(c.t))
          const snapped = snapTarget?.id === c.id
          return (
            <div
              key={`${c.kind}-${c.id}`}
              className={`${styles.marker} ${c.kind === 'checkpoint' ? styles.markerCheckpoint : styles.markerEvent} ${snapped ? styles.markerSnapped : ''}`}
              style={{ left: `${u * 100}%` }}
              title={c.label}
            />
          )
        })}

        <div className={styles.hairline} style={{ left: `${cursorU * 100}%` }} />

        <div className={styles.ticks}>
          {ticks.map((tick) => (
            <span key={tick.t} className={styles.tickLabel} style={{ left: `${tick.u * 100}%` }}>
              {tick.label}
            </span>
          ))}
        </div>
      </div>

      <div className={styles.readout}>
        {snapTarget ? <span className={styles.snapLabel}>{snapTarget.label}</span> : null}
        <span className={styles.time}>{formatGeoTime(displayT)}</span>
      </div>
    </div>
  )
}
