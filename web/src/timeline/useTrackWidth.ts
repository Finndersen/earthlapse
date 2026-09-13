'use client'

/** Tracks the rendered pixel width of a DOM node via `ResizeObserver`, for the layout math
 *  (tick generation, the minimap bracket) that needs real pixel widths rather than percentages.
 *  Shared by `AxisTicks` and `Minimap` so both measure their own track the same way. */

import { useEffect, useRef, useState } from 'react'

export function useTrackWidth<T extends HTMLElement>(): readonly [React.RefObject<T | null>, number] {
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
