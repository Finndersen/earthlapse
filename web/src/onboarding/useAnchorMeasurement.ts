'use client'

/** The live viewport-relative position of a tour step's target, re-read whenever it can have
 *  moved. Every anchor is measured rather than assumed: the Globe/Map toggle, the era shortcuts
 *  and the zoom rocker all sit somewhere different in the phone layout, and a hardcoded
 *  coordinate would point at empty space on one breakpoint or the other. */

import { useEffect, useState } from 'react'

import type { Rect, Size } from './callout'

export interface AnchorMeasurement {
  /** `null` while the target isn't in the DOM — the tour then shows the step's copy with no
   *  highlight ring rather than ringing an arbitrary spot. */
  rect: Rect | null
  viewport: Size
}

function readViewport(): Size {
  return { width: window.innerWidth, height: window.innerHeight }
}

function readRect(selector: string): Rect | null {
  const element = document.querySelector(selector)
  if (element === null) return null
  const { x, y, width, height } = element.getBoundingClientRect()
  return { x, y, width, height }
}

function sameMeasurement(a: AnchorMeasurement, b: AnchorMeasurement): boolean {
  if (a.viewport.width !== b.viewport.width || a.viewport.height !== b.viewport.height) return false
  if (a.rect === null || b.rect === null) return a.rect === b.rect
  return a.rect.x === b.rect.x && a.rect.y === b.rect.y && a.rect.width === b.rect.width && a.rect.height === b.rect.height
}

export function useAnchorMeasurement(selector: string): AnchorMeasurement {
  const [measurement, setMeasurement] = useState<AnchorMeasurement>(() => ({ rect: null, viewport: { width: 0, height: 0 } }))

  useEffect(() => {
    const measure = (): void => {
      const next: AnchorMeasurement = { rect: readRect(selector), viewport: readViewport() }
      setMeasurement((current) => (sameMeasurement(current, next) ? current : next))
    }
    measure()
    // One follow-up frame: `shell/useChromeGap.ts` writes the bottom band's inset from a
    // measurement of its own after the first paint, which moves the timeline targets under it.
    const frame = requestAnimationFrame(measure)

    window.addEventListener('resize', measure)
    // Absent in jsdom, the same environment gap `@/lib/useReducedMotion` guards `matchMedia` for;
    // the resize listener and the follow-up frame still cover every case a test exercises.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(document.documentElement)
    const target = document.querySelector(selector)
    if (target !== null) observer?.observe(target)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [selector])

  return measurement
}
