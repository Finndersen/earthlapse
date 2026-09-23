'use client'

/**
 * Measures the real vertical space between the bottom edge of `topRef`'s element and the top
 * edge of `bottomRef`'s element, and writes it onto `hostRef`'s element as CSS custom
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
 *
 * `reserveBottomPx` (issue 3 follow-up, user report: "the globe/map toggle is overlayed on top
 * of the globe... globe needs to be made a bit smaller") carves additional pixels off the
 * *bottom* of `--chrome-gap-height` alone, without moving `--chrome-gap-top` or the boundary
 * `--chrome-gap-height` is measured *from* — for chrome that isn't `bottomRef`'s own element and
 * so can't just be nested inside it (`ShellLayout.tsx`'s own call site: the expanded globe's own
 * Globe/Map toggle, rendered by `Globe.tsx` inside its own fullscreen backdrop, a sibling
 * subtree `ShellLayout` has no ref into). Also written out separately as `--chrome-gap-bottom-raw`
 * (the *unreserved* `bottomTop`) so a consumer positioning itself relative to the real lower
 * boundary — the toggle itself, sitting in the band this reservation frees up — doesn't have to
 * reconstruct that boundary from the now-smaller `--chrome-gap-height` plus its own copy of
 * whatever was reserved from it; `Globe.module.css`'s `.viewModeGroup` is exactly this consumer.
 * Recomputes whenever `reserveBottomPx` itself changes (no separate `ResizeObserver` needed for
 * it — a plain reactive number, unlike `topRef`/`bottomRef`'s own elements, so a change is always
 * already a re-render).
 *
 * `--chrome-gap-bottom-inset` is that same lower boundary expressed as a distance up from the
 * bottom of the viewport, for the fixed/absolute overlays that anchor themselves with `bottom`
 * rather than `top` (the event strip, the zoom rocker, the Globe/Map toggle). They cannot derive
 * it themselves: `calc(100vh - var(--chrome-gap-bottom-raw))` looks equivalent and is not, because
 * on a mobile browser `100vh` is the *large* viewport — the height the page would have with the
 * address bar scrolled away — while `getBoundingClientRect` above reports against the layout
 * viewport the bar is currently shrinking. The difference is the toolbar's own height, and it
 * lands as overlays floating exactly that far above where they were aimed. `clientHeight` is the
 * layout viewport, the same basis the measurements and the fixed containing block already use, so
 * the arithmetic closes in one coordinate space instead of two.
 *
 * `--chrome-title-right` is `topRef`'s own right edge, for the short-landscape layout, where the
 * expanded sphere/map sits beside the title's column rather than below it.
 */

import { useEffect } from 'react'
import type { RefObject } from 'react'

export function useChromeGap(
  hostRef: RefObject<HTMLElement | null>,
  topRef: RefObject<HTMLElement | null>,
  bottomRef: RefObject<HTMLElement | null>,
  reserveBottomPx = 0,
): void {
  useEffect(() => {
    const host = hostRef.current
    const top = topRef.current
    const bottom = bottomRef.current
    if (host === null || top === null || bottom === null) return undefined

    const recompute = (): void => {
      const topRect = top.getBoundingClientRect()
      const topBottom = topRect.bottom
      const bottomTop = bottom.getBoundingClientRect().top
      host.style.setProperty('--chrome-gap-top', `${Math.max(0, topBottom)}px`)
      host.style.setProperty('--chrome-title-right', `${Math.max(0, topRect.right)}px`)
      host.style.setProperty('--chrome-gap-height', `${Math.max(0, bottomTop - topBottom - reserveBottomPx)}px`)
      host.style.setProperty('--chrome-gap-bottom-raw', `${Math.max(0, bottomTop)}px`)
      const viewportHeight = document.documentElement.clientHeight
      host.style.setProperty('--chrome-gap-bottom-inset', `${Math.max(0, viewportHeight - bottomTop)}px`)
    }

    recompute()
    window.addEventListener('resize', recompute)
    // Showing or hiding a mobile address bar resizes the layout viewport without necessarily
    // firing `resize` on `window`, and every offset above is measured against it.
    window.visualViewport?.addEventListener('resize', recompute)
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(recompute)
      observer.observe(top)
      observer.observe(bottom)
    }
    return () => {
      window.removeEventListener('resize', recompute)
      window.visualViewport?.removeEventListener('resize', recompute)
      observer?.disconnect()
    }
  }, [hostRef, topRef, bottomRef, reserveBottomPx])
}
