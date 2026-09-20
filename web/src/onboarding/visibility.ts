/**
 * Whether the tour is on screen right now, held as a tiny external store (`useSyncExternalStore`)
 * rather than component state.
 *
 * It lives outside the component because `store/devHook.ts` has to open and dismiss the tour for
 * the visual-QA harness, which loads the page exactly once and drives everything else through
 * that hook (`web/scripts/qa/run.mjs`) — there is no reload in which a fresh mount could re-read
 * the persisted flag. Session-scoped and never persisted itself; remembering the dismissal is
 * `storage.ts`'s job, and `setOnboardingTourOpen` is the single path that does both, shared by
 * the tour's own Skip button and by the harness.
 */

import { markTourSeen } from './storage'

type Listener = () => void

/** `0` while the tour is closed, otherwise the number of times it has been opened. A count
 *  rather than a boolean so the component can use it as a React key: opening a tour that is
 *  already open then genuinely restarts it at step one, which is what "open the tour" has to
 *  mean for a caller that resolves the whole state it wants on every shot (`run.mjs`'s
 *  `applyState`) rather than diffing against what is already on screen. */
let openToken = 0
const listeners = new Set<Listener>()

export function subscribeTourOpen(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getTourOpenToken(): number {
  return openToken
}

/** Always closed: this is a static export, so the prerendered HTML never carries the tour and the
 *  first client paint has to agree with it. The flag is read in an effect, after hydration. */
export function getServerTourOpenToken(): number {
  return 0
}

/** Opens the tour, or dismisses it and records it as seen so it never reappears. Dismissing is
 *  one path, whether it came from Skip, Escape, finishing the last step, or the QA harness. */
export function setOnboardingTourOpen(nextOpen: boolean): void {
  if (!nextOpen) markTourSeen()
  if (!nextOpen && openToken === 0) return
  openToken = nextOpen ? openToken + 1 : 0
  for (const listener of listeners) listener()
}
