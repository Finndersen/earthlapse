/**
 * `localStorage` read/write for the sound toggle's on/off and master-volume state (DECIDED
 * DEFAULTS: "persisted per viewer in localStorage (try/catch)"). A private window or blocked
 * site data must not crash the toggle — every access is wrapped and falls back to the
 * off-by-default in-memory state, the one deliberate broad catch in this package: `localStorage`
 * can throw several different `DOMException` names (`SecurityError`, `QuotaExceededError`,
 * a plain access denial) depending on browser and privacy mode, and every one of them has the
 * exact same, already-decided recovery — fall back to the default — so catching the whole
 * access rather than enumerating error names is the right scope for this specific case.
 */

const ENABLED_KEY = 'earthtime.audio.enabled'
const MASTER_VOLUME_KEY = 'earthtime.audio.masterVolume'

export const DEFAULT_MASTER_VOLUME = 0.6

export interface AudioPrefs {
  enabled: boolean
  masterVolume: number
}

function clampVolume(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** Reads persisted prefs once, on mount. Never throws — any failure (or absent/malformed
 *  storage) reads back as the off-by-default in-memory state. */
export function loadAudioPrefs(): AudioPrefs {
  try {
    const enabled = window.localStorage.getItem(ENABLED_KEY) === 'true'
    const rawVolume = window.localStorage.getItem(MASTER_VOLUME_KEY)
    const parsedVolume = rawVolume === null ? NaN : Number(rawVolume)
    const masterVolume = Number.isFinite(parsedVolume) ? clampVolume(parsedVolume) : DEFAULT_MASTER_VOLUME
    return { enabled, masterVolume }
  } catch {
    return { enabled: false, masterVolume: DEFAULT_MASTER_VOLUME }
  }
}

export function saveAudioEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(ENABLED_KEY, String(enabled))
  } catch {
    // Storage unavailable (private window, blocked site data): the toggle still works for
    // this tab's lifetime, it just won't be remembered — never crash the click that got us here.
  }
}

export function saveAudioMasterVolume(volume: number): void {
  try {
    window.localStorage.setItem(MASTER_VOLUME_KEY, String(clampVolume(volume)))
  } catch {
    // See saveAudioEnabled.
  }
}
