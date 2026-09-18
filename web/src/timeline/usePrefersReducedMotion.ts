'use client'

/** Shared by every UI-chrome animation in this package (the symlog/linear toggle, eased
 *  window changes) so `prefers-reduced-motion: reduce` is honoured consistently everywhere
 *  rather than per-component. `t` itself never animates regardless — this only ever gates
 *  chrome, per the package's animation rule.
 *
 *  A thin re-export of `@/lib/useReducedMotion`: this package's own
 *  copy of the `matchMedia` listener was one of three near-identical implementations
 *  (`globe/useReducedMotion.ts`, `scene/useReducedMotion.ts` were the other two, both now
 *  deleted in favour of importing `@/lib/useReducedMotion` directly). Kept under this file's own
 *  name, rather than switched to a bare re-export from every call site, since `timeline/
 *  index.ts` already publishes `usePrefersReducedMotion` as this package's own public API and
 *  `events/components/EventFeed.tsx` imports it under that name across the package boundary. */

export { useReducedMotion as usePrefersReducedMotion } from '@/lib/useReducedMotion'
