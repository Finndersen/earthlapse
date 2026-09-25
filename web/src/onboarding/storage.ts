/**
 * The per-browser "has seen this tour" flags, one per tour (IMPLEMENTATION § Backlog — onboarding).
 * `localStorage` is per-browser and unavailable in a private window, so a viewer can meet the
 * tour more than once — accepted, since the cost of that is one dismissable overlay rather than
 * anything lost.
 *
 * Every access is wrapped: `localStorage` can throw several different `DOMException` names
 * (`SecurityError`, `QuotaExceededError`, a plain access denial) depending on browser and privacy
 * mode, and all of them have the same already-decided recovery — treat the flag as absent — so
 * catching the whole access rather than enumerating error names is the right scope here, exactly
 * as `audio/persistence.ts` argues for its own reads. A storage failure must never stop the app
 * rendering.
 */

/** `main` is the first-visit tour; `globe` the one shown the first time the globe is expanded. */
export type TourId = 'main' | 'globe'

const SEEN_KEYS: Record<TourId, readonly string[]> = {
  // The second key is where the flag lived before the rename, still read so a returning viewer
  // isn't re-toured.
  main: ['earthlapse.onboarding.seen', 'earthtime.onboarding.seen'],
  globe: ['earthlapse.onboarding.globe.seen'],
}

/** `false` for a miss, malformed data, or a storage access that throws — all three mean
 *  "not seen", so the tour shows. */
export function hasSeenTour(tour: TourId = 'main'): boolean {
  try {
    return SEEN_KEYS[tour].some((key) => window.localStorage.getItem(key) === 'true')
  } catch {
    return false
  }
}

export function markTourSeen(tour: TourId = 'main'): void {
  try {
    window.localStorage.setItem(SEEN_KEYS[tour][0]!, 'true')
  } catch {
    // Storage unavailable: the tour still dismisses for this session, it just won't be
    // remembered on the next visit — never crash the press that got us here.
  }
}
