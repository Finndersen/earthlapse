'use client'

/** Whether the viewport is narrow enough that `<EventFeed>` should render as the "compact
 *  single-card strip" the brief calls for, rather than its default stack of cards. Mirrors
 *  `ShellLayout.module.css`'s own `@media (max-width: 760px)` breakpoint — the point the shell
 *  itself restacks into the phone layout — rather than a size threshold invented separately, so
 *  the feed goes compact exactly when the rest of the HUD does. A viewport query, not the
 *  feed's own measured element width: the card column is deliberately narrow at every size, so
 *  measuring itself would read as "always compact". */

import { useEffect, useState } from 'react'

const QUERY = '(max-width: 760px)'

function readsCompact(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(QUERY).matches
}

export function useIsCompactViewport(): boolean {
  const [compact, setCompact] = useState(readsCompact)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(QUERY)
    const onChange = (): void => setCompact(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return compact
}
