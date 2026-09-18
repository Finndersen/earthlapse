'use client'

/** Whether the viewport is narrow enough that `<EventFeed>` should render as the "compact
 *  single-card strip" the brief calls for, rather than its default stack of cards.
 *
 *  A thin re-export of `@/lib/useIsCompactViewport` — this package's
 *  own copy of the `matchMedia` listener was one of two near-identical implementations
 *  (`globe/deviceTier.ts`'s `useIsPhoneViewport` was the other, also now a re-export). Kept
 *  under this file's own name/path since `events/index.ts` already publishes
 *  `useIsCompactViewport` as this package's own public API. */

export { useIsCompactViewport } from '@/lib/useIsCompactViewport'
