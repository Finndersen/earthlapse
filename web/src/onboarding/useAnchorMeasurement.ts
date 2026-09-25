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

/** Splits a selector list on its top-level commas only, leaving those inside `:is(...)` or an
 *  attribute value intact. */
function topLevelSelectors(selector: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i]
    if (ch === '(' || ch === '[') depth += 1
    else if (ch === ')' || ch === ']') depth -= 1
    else if (ch === ',' && depth === 0) {
      parts.push(selector.slice(start, i))
      start = i + 1
    }
  }
  parts.push(selector.slice(start))
  return parts
}

/** The first selector in the list, in the order written, whose element has a drawn box: a
 *  hidden fallback (the map frame while the globe shows) measures zero and is passed over. */
function findTarget(selector: string): Element | null {
  for (const part of topLevelSelectors(selector)) {
    const element = document.querySelector(part)
    if (element === null) continue
    const box = element.getBoundingClientRect()
    if (box.width > 0 && box.height > 0) return element
  }
  return document.querySelector(selector)
}

function readRect(selector: string): Rect | null {
  const element = findTarget(selector)
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
    const target = findTarget(selector)
    if (target !== null) observer?.observe(target)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [selector])

  return measurement
}
