'use client'

import { useEffect, useState } from 'react'

/** Every input that counts as the viewer being present. Listened for in the capture phase on
 *  `window`, so a component that stops propagation (a drag handler, orbit controls) still
 *  counts as activity. */
const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel'] as const

export interface UseIdleOptions {
  /** Idle is only ever reported while armed (e.g. during playback); disarming resets it. */
  armed: boolean
  /** How long without any activity before the viewer counts as idle. */
  timeoutMs: number
}

/**
 * Whether the viewer has been idle — no pointer, touch, wheel or keyboard input — for
 * `timeoutMs` while `armed`. Any activity restores `false` immediately and restarts the
 * countdown. Drives the shell's "idle calm", which quiets the periphery HUD so a playing
 * timeline reads as a film rather than a dashboard.
 */
export function useIdle({ armed, timeoutMs }: UseIdleOptions): boolean {
  const [idle, setIdle] = useState(false)

  useEffect(() => {
    if (!armed) return

    let timer = window.setTimeout(() => setIdle(true), timeoutMs)
    const onActivity = (): void => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), timeoutMs)
    }

    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, onActivity, { capture: true, passive: true })
    }
    return () => {
      window.clearTimeout(timer)
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, onActivity, { capture: true })
      }
      setIdle(false)
    }
  }, [armed, timeoutMs])

  return armed && idle
}
