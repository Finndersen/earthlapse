'use client'

/** Tracks a DOM node's rendered pixel size via `ResizeObserver` — the local twin of
 *  `timeline/useTrackWidth.ts` (not exported from `@/timeline`'s public API, and small enough
 *  that reaching past a package's own barrel for it would be worse than the few lines here).
 *  `<EventFeed>` needs its container's real width to convert `DEFAULT_LOOKBACK_PX` into time the
 *  same way the scrub track converts its own pixel constants, and its real height to know how
 *  many cards its slot has room for. */

import { useEffect, useRef, useState } from 'react'

export interface ElementSize {
  width: number
  height: number
}

const UNMEASURED: ElementSize = { width: 0, height: 0 }

export function useElementSize<T extends HTMLElement>(): readonly [React.RefObject<T | null>, ElementSize] {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState<ElementSize>(UNMEASURED)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = (width: number, height: number): void =>
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }))
    const rect = el.getBoundingClientRect()
    update(rect.width, rect.height)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) update(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, size] as const
}
