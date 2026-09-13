'use client'

/** Shared by every UI-chrome animation in this package (the symlog/linear toggle, eased
 *  window changes) so `prefers-reduced-motion: reduce` is honoured consistently everywhere
 *  rather than per-component. `t` itself never animates regardless — this only ever gates
 *  chrome, per the package's animation rule. */

import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/** Feature-detects `matchMedia` (absent in some test environments) rather than assuming a
 *  browser DOM, so this hook degrades to "motion allowed" instead of throwing. */
function readsPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(QUERY).matches
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readsPrefersReducedMotion)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(QUERY)
    const onChange = (): void => setReduced(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return reduced
}
