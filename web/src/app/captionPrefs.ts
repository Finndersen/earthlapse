/**
 * Whether the viewer has folded the scene caption down to its title, remembered per browser.
 * Every access is wrapped for the reason `audio/persistence.ts` gives: any storage failure reads
 * back as the default (the passage shown) and a failed write is only forgotten, never fatal.
 */

const COLLAPSED_KEY = 'earthlapse.caption.collapsed'

export function loadCaptionCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

export function saveCaptionCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, String(collapsed))
  } catch {
    // Storage unavailable: the fold still applies for this tab's lifetime.
  }
}
