/**
 * Persistence for the first-use hint (brief §2: "shown until the first successful hover,
 * remembered in sessionStorage behind try/catch"). `sessionStorage` can throw (private
 * browsing, a blocked-storage policy, or simply not existing in a test/SSR environment) — every
 * access is wrapped so a storage failure degrades to "show the hint" rather than crashing the
 * timeline.
 */

const STORAGE_KEY = 'earthtime:timeline-hint-dismissed'

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** Whether the hint was already dismissed earlier this session (by an explicit dismiss, or a
 *  prior successful hover over the track — the gesture that reveals the fisheye lens).
 *  Defaults to `false` (show the hint) whenever storage is unavailable or throws. */
export function readHintDismissed(): boolean {
  const storage = getSessionStorage()
  if (!storage) return false
  try {
    return storage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** Records the hint as dismissed for the rest of this session. A storage failure here is
 *  silently ignored — the hint simply reappears on the next page load, which is an acceptable
 *  degradation, not a functional break. */
export function writeHintDismissed(): void {
  const storage = getSessionStorage()
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, '1')
  } catch {
    // Storage unavailable or full — nothing to recover, nothing to crash.
  }
}
