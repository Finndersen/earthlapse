'use client'

/**
 * Device-pixel-ratio budget for the scene canvas — mirrors `globe/camera.ts`'s `budgetedDpr`.
 * Duplicated rather than imported: `scene` and `globe` are independent packages (DESIGN §7,
 * "the only thing it shares with the scene view is `t`"), and `budgetedDpr` isn't part of
 * `globe`'s public API (`globe/index.ts`) either.
 *
 * The rationale is the same in both places: a flat `dpr={[1, 2]}` pin bounds nothing — soft on a
 * small buffer, still unbounded on a large one (a 5K display's buffer at `dpr: 1` is worse than
 * an ordinary laptop's at full retina). Budgeting the drawing buffer's actual pixel count
 * (`widthPx * heightPx * dpr^2`) holds at any display size, tapering via `sqrt` — pixel count
 * grows with the *square* of a linear DPR change — only once the full device pixel ratio would
 * cross the budget.
 */

import { useEffect, useState } from 'react'

/** Keeps a 1440x900 viewport at `dpr: 2` (~5.18M px, an ordinary laptop's retina case) at full
 *  sharpness; a larger or denser display tapers down to fit the same budget instead of paying
 *  for several times the pixels. Same value as `globe/camera.ts`'s `EXPANDED_DPR_BUDGET_PIXELS`
 *  — both are full-viewport canvases, so the same cap bites in the same place for the same
 *  reason. */
export const SCENE_DPR_BUDGET_PIXELS = 5_200_000

/** Never below `1` (a `dpr` under 1 would upscale an already under-resolved buffer, not save
 *  anything meaningful at this scene's pixel counts) and never above the display's own
 *  `devicePixelRatio` (this only ever trades sharpness for pixels, never invents resolution the
 *  display can't show). */
export function budgetedDpr(devicePixelRatio: number, widthPx: number, heightPx: number, budgetPixels: number): number {
  const areaPx = widthPx * heightPx
  if (areaPx <= 0) return 1
  return Math.max(1, Math.min(devicePixelRatio, Math.sqrt(budgetPixels / areaPx)))
}

/**
 * The scene canvas's own budgeted DPR, tracked against the real window size. The canvas is
 * always `position: absolute; inset: 0` inside the shell's `position: fixed; inset: 0` root
 * (`ShellLayout.module.css`'s `.scene`), so it always exactly matches the viewport — known
 * synchronously on the first render, no "not measured yet" fallback state to get wrong. No
 * `ResizeObserver` needed, just a `resize` listener (mirrors `globe/Globe.tsx`'s
 * `useExpandedCanvasDpr`, which makes the same observation about its own always-full-bleed
 * expanded canvas). Unlike that hook, this one is unconditional — the scene canvas is always
 * full-viewport, never a small minimised state.
 */
export function useSceneCanvasDpr(): number {
  const [size, setSize] = useState<{ width: number; height: number }>(() =>
    typeof window === 'undefined' ? { width: 0, height: 0 } : { width: window.innerWidth, height: window.innerHeight },
  )
  useEffect(() => {
    const recompute = (): void => setSize({ width: window.innerWidth, height: window.innerHeight })
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [])
  const devicePixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio
  return budgetedDpr(devicePixelRatio, size.width, size.height, SCENE_DPR_BUDGET_PIXELS)
}
