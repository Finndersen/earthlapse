'use client'

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

/**
 * Tracks the OS-level reduced-motion preference. This is the scene's one input besides `t`:
 * camera drift (`drift.ts`) is UI motion-sensitivity, not part of the `t -> pixels` contract,
 * so it is read here — the same category as the "UI chrome" wall-clock exception — rather
 * than threaded through as a prop.
 */
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
