'use client'

/** How far the timeline's own top edge sits above the bottom of the viewport, in CSS pixels —
 *  what `EventBrowser` reserves at its own bottom so the timeline stays visible and scrubbable
 *  underneath it, on both desktop and a phone sheet. Measured independently of `shell/useChromeGap`
 *  (which computes the same boundary for the shell's own layout) rather than reaching into that
 *  package's internals: this package stays self-contained, and the two can't drift apart since
 *  both measure the same real element (`[data-testid="timeline-root"]`), not a shared assumption
 *  about its height. `0` until the timeline exists in the DOM. */

import { useEffect, useState } from 'react'

const TIMELINE_SELECTOR = '[data-testid="timeline-root"]'

function readInset(): number {
  const el = document.querySelector(TIMELINE_SELECTOR)
  if (el === null) return 0
  return Math.max(0, window.innerHeight - el.getBoundingClientRect().top)
}

export function useTimelineBottomInset(): number {
  const [inset, setInset] = useState(readInset)

  useEffect(() => {
    const measure = (): void => setInset(readInset())
    measure()
    const frame = requestAnimationFrame(measure)

    window.addEventListener('resize', measure)
    // Showing/hiding a mobile address bar resizes the layout viewport without necessarily firing
    // `resize` on `window` — same reasoning `shell/useChromeGap.ts` gives for the same listener.
    window.visualViewport?.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    const target = document.querySelector(TIMELINE_SELECTOR)
    if (target !== null) observer?.observe(target)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [])

  return inset
}
