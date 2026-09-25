/**
 * Whether each tour is on screen right now, held as a tiny external store per tour
 * (`useSyncExternalStore`) rather than component state.
 *
 * It lives outside the components because `store/devHook.ts` has to open and dismiss the tours for
 * the visual-QA harness, which loads the page exactly once and drives everything else through
 * that hook (`web/scripts/qa/run.mjs`) — there is no reload in which a fresh mount could re-read
 * the persisted flag. Session-scoped and never persisted itself; remembering the dismissal is
 * `storage.ts`'s job, and each tour's `setOpen` is the single path that does both, shared by
 * the tour's own Skip button and by the harness.
 */

import { markTourSeen, type TourId } from './storage'

type Listener = () => void

export interface TourVisibility {
  subscribe: (listener: Listener) => () => void
  /** `0` while the tour is closed, otherwise the number of times it has been opened. A count
   *  rather than a boolean so the component can use it as a React key: opening a tour that is
   *  already open then genuinely restarts it at step one, which is what "open the tour" has to
   *  mean for a caller that resolves the whole state it wants on every shot (`run.mjs`'s
   *  `applyState`) rather than diffing against what is already on screen. */
  getToken: () => number
  /** Opens the tour, or dismisses it and records it as seen so it never reappears. Dismissing is
   *  one path, whether it came from Skip, Escape, finishing the last step, or the QA harness. */
  setOpen: (open: boolean) => void
}

function createTourVisibility(tour: TourId): TourVisibility {
  let openToken = 0
  const listeners = new Set<Listener>()
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getToken: () => openToken,
    setOpen: (nextOpen) => {
      if (!nextOpen) markTourSeen(tour)
      if (!nextOpen && openToken === 0) return
      openToken = nextOpen ? openToken + 1 : 0
      for (const listener of listeners) listener()
    },
  }
}

export const mainTour = createTourVisibility('main')
export const globeTour = createTourVisibility('globe')

/** Always closed: this is a static export, so the prerendered HTML never carries a tour and the
 *  first client paint has to agree with it. The flags are read in an effect, after hydration. */
export function getServerTourOpenToken(): number {
  return 0
}

export const subscribeTourOpen = mainTour.subscribe
export const getTourOpenToken = mainTour.getToken
export const setOnboardingTourOpen = mainTour.setOpen
export const setGlobeTourOpen = globeTour.setOpen
