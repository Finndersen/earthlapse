/**
 * The per-browser "has seen the first-visit tour" flag (IMPLEMENTATION § Backlog — onboarding).
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

const SEEN_KEY = 'earthlapse.onboarding.seen'
/** Where the flag lived before the rename, still read so a returning viewer isn't re-toured. */
const LEGACY_SEEN_KEY = 'earthtime.onboarding.seen'

/** `false` for a miss, malformed data, or a storage access that throws — all three mean
 *  "not seen", so the tour shows. */
export function hasSeenTour(): boolean {
  try {
    return (window.localStorage.getItem(SEEN_KEY) ?? window.localStorage.getItem(LEGACY_SEEN_KEY)) === 'true'
  } catch {
    return false
  }
}

export function markTourSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, 'true')
  } catch {
    // Storage unavailable: the tour still dismisses for this session, it just won't be
    // remembered on the next visit — never crash the press that got us here.
  }
}
