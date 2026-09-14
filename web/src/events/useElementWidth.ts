'use client'

/** Tracks a DOM node's rendered pixel width via `ResizeObserver` — the local twin of
 *  `timeline/useTrackWidth.ts` (not exported from `@/timeline`'s public API, and small enough
 *  that reaching past a package's own barrel for it would be worse than the few lines here).
 *  `<EventFeed>` needs its own container's real width to convert `DEFAULT_LOOKBACK_PX` into
 *  time the same way the scrub track converts its own pixel constants. */

import { useEffect, useRef, useState } from 'react'

export function useElementWidth<T extends HTMLElement>(): readonly [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof ResizeObserver === 'undefined') {
      setWidth(el.getBoundingClientRect().width)
      return
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}
