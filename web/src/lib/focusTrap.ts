'use client'

/**
 * Shared focus-trap + focus-restore behaviour for a dialog-like overlay mounted only while open
 * — the same contract `shell/Panel` and `timeline/components/ClusterPopover` both already use.
 * On mount, captures whatever had focus beforehand and moves focus in; on unmount, hands it
 * back. Returns a `Tab`-only `onKeyDown` handler that cycles focus within the overlay's own
 * focusable elements instead of letting it leak to the rest of the page.
 *
 * `Panel` and `ClusterPopover` used to each carry a byte-for-byte copy of this (a re-review
 * finding, 2026-09-15) — two bespoke focus traps where the brief asked for one shared primitive.
 * It lives here, in `lib`, rather than either package importing the other's component, the same
 * reason `resolveAssetUrl`/`usePresentedMix`/`supportsWebGL` do (see those files' own doc
 * comments): `shell` and `timeline` stay decoupled from each other, and a third future overlay
 * gets this for free too.
 *
 * Escape is deliberately not this hook's concern: every caller closes on Escape, but each wants
 * it to also `stopPropagation()` before its own `onClose()` (so it isn't also seen by whatever's
 * listening further up), and the exact ordering relative to this hook's own `onKeyDown` is
 * simplest left to the caller. Wire Escape up alongside the returned handler, as both existing
 * callers do.
 */

import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'

const DEFAULT_FOCUSABLE_SELECTOR = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export interface UseFocusTrapOptions {
  /** Element to focus on mount instead of the root itself. Defaults to the root, which must be
   *  focusable (`tabIndex={-1}`) for that default to actually receive focus. */
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Overridden only when an overlay's focusable elements aren't every one of
   *  `DEFAULT_FOCUSABLE_SELECTOR`'s tags (`ClusterPopover`'s content is buttons only). */
  focusableSelector?: string
}

/** Captures focus on mount, restores it on unmount, and returns a `Tab`-only `onKeyDown` handler
 *  that cycles focus within `rootRef`'s subtree. Call from a component that is only ever mounted
 *  while the overlay is open (the same "conditionally rendered, not hidden" contract every
 *  caller already follows) — mounting is what captures focus, unmounting is what restores it. */
export function useFocusTrap(
  rootRef: RefObject<HTMLElement | null>,
  { initialFocusRef, focusableSelector = DEFAULT_FOCUSABLE_SELECTOR }: UseFocusTrapOptions = {},
): (e: ReactKeyboardEvent<HTMLElement>) => void {
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ;(initialFocusRef?.current ?? rootRef.current)?.focus()
    return () => {
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount/unmount only
  }, [])

  return (e: ReactKeyboardEvent<HTMLElement>): void => {
    if (e.key !== 'Tab') return
    const focusable = rootRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []
    if (focusable.length === 0) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    const active = document.activeElement
    if (e.shiftKey) {
      if (active === first || active === rootRef.current) {
        e.preventDefault()
        last.focus()
      }
    } else if (active === last) {
      e.preventDefault()
      first.focus()
    }
  }
}
