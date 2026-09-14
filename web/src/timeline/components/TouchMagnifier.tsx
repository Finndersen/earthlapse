'use client'

/** The touch press-and-drag magnifier (ADR-021), modelled on the mobile text-selection loupe:
 *  while a touch/pen pointer is down on the track, a bubble floats above the finger — never
 *  under it, where a real finger would hide it — showing a further-magnified strip of the track
 *  around the touch point plus the same time/label readout the mouse hover readout shows.
 *  `ScrubTrack` already computed everything drawn here (`checkpointLayout`, the decluttered
 *  event bands, the precision-formatted hover readout) against the fisheye-distorted `scale`; this
 *  component only re-projects those same displayed positions into its own, further-zoomed local
 *  window — it does no time-scale math of its own. `position: fixed`, since the finger (and so
 *  the bubble above it) can sit anywhere in the viewport, not just within the track's own bounds. */

import type { CheckpointLayoutEntry } from '../checkpointLayout'
import { clamp } from '../util'
import styles from './TouchMagnifier.module.css'

/** The magnified strip's own on-screen size. */
const VIEWPORT_WIDTH_PX = 220
const VIEWPORT_HEIGHT_PX = 32

/** `.magnifier`'s own horizontal padding in the CSS module — the strip plus the readout below
 *  it sit inside one opaque panel now (brief #1: "one opaque ... rounded panel", replacing the
 *  old borderless viewport-only look), so the panel's real on-screen width is wider than the
 *  strip alone and every edge/clamp calculation below has to account for that padding, not just
 *  `VIEWPORT_WIDTH_PX`. */
const PANEL_PADDING_X_PX = 10

/** The panel's own worst-case on-screen width — the strip's width plus its padding on both
 *  sides. The readout row is capped to this same width (via its own inline `width` below) so a
 *  long label truncates with ellipsis rather than growing the panel wider than the strip. */
const PANEL_WIDTH_PX = VIEWPORT_WIDTH_PX + PANEL_PADDING_X_PX * 2

/** Minimum gap the panel keeps from either screen edge (brief #1: "stays fully inside the
 *  viewport with a margin at both screen edges") — clamping flush to 0 would still touch the
 *  edge, not leave a margin. */
const EDGE_MARGIN_PX = 8

/** Extra magnification the bubble applies on top of whatever the fisheye lens has already done
 *  to `centerU`'s surroundings — the lens spreads a gap open on the real track; this then blows
 *  that already-opened gap up further so it reads clearly in a bubble a fraction of the track's
 *  own width. */
const MAGNIFIER_ZOOM = 3

/** How far above the touch point the bubble's own bottom edge sits (screen px) — comfortably
 *  clear of a real fingertip's own contact width so the finger never covers it. */
const BUBBLE_GAP_PX = 76

/** Content is drawn `MAGNIFIER_ZOOM`x zoomed into the viewport; +/- this many px of slack keeps
 *  a marker that is only partially in view rendering (its diamond can straddle the edge) rather
 *  than popping in only once fully inside. */
const EDGE_SLACK_PX = 10

interface EventBand {
  id: string
  uStart: number
  uEnd: number
}

interface TouchMagnifierProps {
  clientX: number
  clientY: number
  trackWidthPx: number
  /** 0..1, the touched position in the same (fisheye-distorted) displayed space every other `u`
   *  in this package is measured in — the bubble's own centre. */
  centerU: number
  time: string
  label?: string
  pips: readonly CheckpointLayoutEntry[]
  eventBands: readonly EventBand[]
}

function projectU(u: number, centerU: number, trackWidthPx: number): number {
  return VIEWPORT_WIDTH_PX / 2 + (u - centerU) * trackWidthPx * MAGNIFIER_ZOOM
}

function inView(x: number): boolean {
  return x >= -EDGE_SLACK_PX && x <= VIEWPORT_WIDTH_PX + EDGE_SLACK_PX
}

export function TouchMagnifier({ clientX, clientY, trackWidthPx, centerU, time, label, pips, eventBands }: TouchMagnifierProps) {
  const halfPanelPx = PANEL_WIDTH_PX / 2 + EDGE_MARGIN_PX
  const clampedLeft =
    typeof window === 'undefined' ? clientX : clamp(clientX, halfPanelPx, Math.max(halfPanelPx, window.innerWidth - halfPanelPx))

  const visibleBands = eventBands
    .map((band) => ({ id: band.id, x0: projectU(band.uStart, centerU, trackWidthPx), x1: projectU(band.uEnd, centerU, trackWidthPx) }))
    .filter((band) => inView(band.x0) || inView(band.x1))

  const visiblePips = pips
    .map((entry) => ({ entry, x: projectU(entry.u, centerU, trackWidthPx) }))
    .filter(({ x }) => inView(x))

  return (
    <div
      aria-hidden
      data-touch-magnifier
      className={styles.magnifier}
      style={{ left: clampedLeft, top: clientY - BUBBLE_GAP_PX, maxWidth: PANEL_WIDTH_PX }}
    >
      <div className={styles.viewport} style={{ width: VIEWPORT_WIDTH_PX, height: VIEWPORT_HEIGHT_PX }}>
        <div className={styles.baseline} />
        {visibleBands.map((band) => (
          <div key={band.id} className={styles.band} style={{ left: band.x0, width: Math.max(band.x1 - band.x0, 2) }} />
        ))}
        {visiblePips.map(({ entry, x }) => (
          <div key={entry.id} className={entry.kind === 'pip' ? styles.pipDot : styles.clusterDot} style={{ left: x }} />
        ))}
        <div className={styles.crosshair} />
      </div>
      <div className={styles.readout} style={{ width: VIEWPORT_WIDTH_PX }}>
        {label && <span className={styles.label}>{label}</span>}
        <span className={styles.time}>{time}</span>
      </div>
    </div>
  )
}
