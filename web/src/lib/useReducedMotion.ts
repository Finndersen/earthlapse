'use client'

/** Tracks the OS-level `prefers-reduced-motion` preference. Shared by every top-level package
 *  that gates its own UI-chrome motion on it (`globe`'s unfold tween and auto-rotate, `scene`'s
 *  camera drift, `timeline`'s eased window/scale changes) — previously three near-identical
 *  copies of the same `matchMedia` listener (`globe/useReducedMotion.ts`, `scene/
 *  useReducedMotion.ts`, `timeline/usePrefersReducedMotion.ts`), one per
 *  package on the theory that each top-level package should stay import-free of its siblings.
 *  That theory doesn't actually hold here: `timeline/usePrefersReducedMotion` is already
 *  re-exported through `timeline/index.ts` and imported cross-package by
 *  `events/components/EventFeed.tsx`, so "shared browser-preference plumbing" was never actually
 *  package-specific state — it belongs here, in `lib/`, alongside `webgl.ts`'s own
 *  one-shot-capability-check convention. `timeline/usePrefersReducedMotion.ts` now re-exports
 *  this under its own established name rather than being deleted outright, so `events`' existing
 *  import keeps working unchanged; `globe` and `scene` import this directly since neither
 *  exposed its own copy through a public package barrel. */

import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function readPreference(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia(QUERY).matches
  } catch {
    return false
  }
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readPreference)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mql = window.matchMedia(QUERY)
    const handleChange = (): void => setReduced(mql.matches)
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [])

  return reduced
}
