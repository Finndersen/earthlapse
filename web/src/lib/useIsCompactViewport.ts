'use client'

/** Whether the viewport is small enough that the HUD should use its compact chrome: a phone in
 *  portrait (under 760px wide) or any short landscape window (under 500px tall, ADR-048). Mirrors
 *  the union of `ShellLayout.module.css`'s phone-portrait and landscape layouts rather than a
 *  size threshold invented separately, so every consumer goes compact exactly when the rest of
 *  the HUD does. A viewport query, not a consumer's own measured element width: several
 *  consumers (`events`' feed, `globe`'s legend) are deliberately narrow at every size, so
 *  measuring themselves would read as "always compact".
 *
 *  Shared, not duplicated: `events/useIsCompactViewport.ts` and `globe/deviceTier.ts`'s
 *  `useIsPhoneViewport` used to each carry their own identical copy of this `matchMedia`
 *  listener, on the theory that top-level packages should stay import-free of each other's
 *  internals — a theory `lib/useReducedMotion.ts`'s own doc comment found didn't actually hold
 *  for that hook either. Both packages now re-export this under their own established name
 *  rather than being pointed at directly everywhere, so neither package's existing public API
 *  surface or call-site vocabulary ("compact" for `events`, "phone" for `globe`) needs to
 *  change. */

import { useEffect, useState } from 'react'

const QUERY = '(max-width: 760px), (orientation: landscape) and (max-height: 500px)'

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
