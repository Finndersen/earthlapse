'use client'

/**
 * Measures the real vertical space between the bottom edge of `topRef`'s element and the top
 * edge of `bottomRef`'s element, and writes it onto `hostRef`'s element as two CSS custom
 * properties — `--chrome-gap-top` (the top edge's own distance from the viewport top) and
 * `--chrome-gap-height` (the gap itself). `Globe.module.css`'s expanded panel sizing reads both,
 * so the box it fits into is the shell's *actual*, live title-to-timeline gap rather than a
 * guessed pixel allowance subtracted from `100vh` (the bug this replaces — see that file's own
 * doc comment on `--expanded-size` for the measured, real-browser mismatch a guessed constant
 * produced).
 *
 * Written directly onto the DOM (`el.style.setProperty`), bypassing React state/re-render — the
 * same non-reactive "write a style property straight to the DOM on every measurement" pattern
 * `Globe.tsx`'s own `setPoleLabelOpacity` uses for a similarly resize-driven value not worth a
 * render for. `ShellLayout` re-renders on every playback frame (the title text changes with
 * `t`), so routing this through `useState` would mean either recomputing on every one of those
 * renders for no reason, or a second effect just to avoid it — writing the property directly
 * sidesteps both.
 *
 * A `ResizeObserver` on `topRef`/`bottomRef` alone would miss a pure viewport-height change that
 * resizes neither element (both are auto-height, sized by their own content — the title's text,
 * the caption's own text — not by the space around them): the middle grid row absorbs that
 * change instead (`ShellLayout.module.css`'s `.hud` grid), which is exactly the free space this
 * hook is measuring. `window`'s own `resize` event is what actually shifts `bottomRef`'s position
 * in that case, so both are wired to the same recompute.
 *
 * `bottomRef` must be the element whose own natural height reflects only what a viewer can
 * actually see — never a container that also sizes itself to a hidden sibling's content
 * (`ShellLayout.tsx`'s own call site has the full story: an earlier version passed `.bottom`
 * itself, whose height a hidden-but-still-laid-out scene caption could inflate well past the
 * timeline's own top edge, undershooting the real free area).
 */

import { useEffect } from 'react'
import type { RefObject } from 'react'

export function useChromeGap(
  hostRef: RefObject<HTMLElement | null>,
  topRef: RefObject<HTMLElement | null>,
  bottomRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const host = hostRef.current
    const top = topRef.current
    const bottom = bottomRef.current
    if (host === null || top === null || bottom === null) return undefined

    const recompute = (): void => {
      const topBottom = top.getBoundingClientRect().bottom
      const bottomTop = bottom.getBoundingClientRect().top
      host.style.setProperty('--chrome-gap-top', `${Math.max(0, topBottom)}px`)
      host.style.setProperty('--chrome-gap-height', `${Math.max(0, bottomTop - topBottom)}px`)
    }

    recompute()
    window.addEventListener('resize', recompute)
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(recompute)
      observer.observe(top)
      observer.observe(bottom)
    }
    return () => {
      window.removeEventListener('resize', recompute)
      observer?.disconnect()
    }
  }, [hostRef, topRef, bottomRef])
}
