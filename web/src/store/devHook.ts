/**
 * Development-only automation hook: exposes the time store on `window.__earthtime` so a
 * browser-driven check (the ONESHOT_SCOPE "Definition of done" pass) can set `t` precisely
 * and read state back, instead of approximating positions by dragging pixels.
 *
 * Gated on `process.env.NODE_ENV === 'development'`, which Next inlines at build time, so a
 * production build dead-code-eliminates the assignment and ships no debug surface.
 */

import { useTimeStore } from './time'

export interface EarthtimeDevHook {
  setT: (t: number) => void
  getState: typeof useTimeStore.getState
}

declare global {
  interface Window {
    __earthtime?: EarthtimeDevHook
  }
}

export function installDevHook(): void {
  if (process.env.NODE_ENV !== 'development') return
  window.__earthtime = {
    setT: (t) => useTimeStore.getState().setT(t),
    getState: useTimeStore.getState,
  }
}
