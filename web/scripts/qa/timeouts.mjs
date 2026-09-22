/**
 * The two genuinely-unavoidable blind waits in this harness, isolated here rather than scattered
 * through `shots.mjs`/`run.mjs`. Both exist because `window.__earthtime.ready()` (`devHook.ts`)
 * only covers network/decode readiness — real local animation state in two components has no
 * clean external signal, and both were found by actually running the harness (see this package's
 * README, "why two timeouts"), not guessed in advance.
 */

/**
 * `scene/presentation.ts`'s `usePresentedSceneMix` rate-limits how fast the *displayed* scene
 * crossfade follows `t` (ADR-012): a full transition never completes in under
 * `MIN_TRANSITION_SECONDS` (1.6s there), however abruptly `t` jumps. Mirrored here as a plain
 * number rather than imported, since this harness runs under plain Node with no TypeScript/build
 * step (`web/scripts/**` is intentionally dependency-light) and `presentation.ts` is a `'use
 * client'` React module. If that constant changes, this one needs a matching bump.
 *
 * Once settled the presented mix stops moving entirely (`moveToward` snaps exactly onto the
 * target, and the driving `requestAnimationFrame` loop stops — see `presentation.ts`'s own doc
 * comment), so waiting this long, once, after any `t` jump is a deterministic settle rather than
 * a guess: shorter and the shot risks a screenshot mid-dissolve (two scenes' art visibly
 * overlaid, briefly with the *wrong* one's caption — this is exactly what an earlier run of this
 * harness caught: `present-day-default` at t=0 rendered a Shenzhen-Today/Magma-Ocean hybrid,
 * captioned "The Magma Ocean", because the harness screenshotted right after `setT` instead of
 * waiting for the crossfade this rate limit imposes).
 * @param {import('playwright').Page} page
 */
export function waitForSceneCrossfadeSettle(page) {
  const MIN_TRANSITION_SECONDS_MIRROR = 1.6
  const SAFETY_MARGIN_MS = 150
  return page.waitForTimeout(Math.round(MIN_TRANSITION_SECONDS_MIRROR * 1000 + SAFETY_MARGIN_MS))
}

/**
 * `Globe.tsx`'s sphere<->map "unfold" tween (docs/GLOBE.md's ADR-033) is local component
 * animation state with no DOM or store reflection (see `devHook.ts`'s own doc comment on why it
 * can't be read cleanly), so there is no condition to poll for "the tween is at progress p" —
 * only wall-clock time since the toggle was clicked. `fractionOfDuration` is
 * `elapsed / UNFOLD_DURATION_MS`; the caller picks the fraction.
 * @param {import('playwright').Page} page
 * @param {number} fractionOfDuration - 0..1
 */
export function waitForApproxUnfoldProgress(page, fractionOfDuration) {
  const UNFOLD_DURATION_MS = 800
  return page.waitForTimeout(Math.round(UNFOLD_DURATION_MS * fractionOfDuration))
}

/**
 * `sceneLocation.ts`'s `FOCUS_EASE_SECONDS` (ADR-034): how long the minimised orb's own
 * auto-rotate takes to centre a scene's location once it becomes the target. Local `useFrame`
 * animation state with no DOM/store reflection (the same reason `waitForApproxUnfoldProgress`
 * exists), mirrored as a plain number for the same "this harness has no TS/build step" reason
 * `waitForSceneCrossfadeSettle` gives — if `FOCUS_EASE_SECONDS` changes, this needs a matching
 * bump. Under `prefers-reduced-motion: reduce` the ease snaps instantly instead of animating
 * (`sceneLocation.ts`'s own rule), so this wait is a safe upper bound in both modes, not a
 * precise sync point.
 * @param {import('playwright').Page} page
 */
export function waitForFocusEaseSettle(page) {
  const FOCUS_EASE_SECONDS_MIRROR = 1.2
  const SAFETY_MARGIN_MS = 200
  return page.waitForTimeout(Math.round(FOCUS_EASE_SECONDS_MIRROR * 1000 + SAFETY_MARGIN_MS))
}

/**
 * `timeline/useAnimatedScale.ts`'s `WINDOW_ANIMATION_MS`: how long the scrub track's domain takes
 * to move to a newly selected section. Local animation state with no DOM/store reflection,
 * mirrored as a plain number for the same reason as the waits above.
 * @param {import('playwright').Page} page
 */
export function waitForSectionWindowSettle(page) {
  const WINDOW_ANIMATION_MS_MIRROR = 700
  const SAFETY_MARGIN_MS = 150
  return page.waitForTimeout(WINDOW_ANIMATION_MS_MIRROR + SAFETY_MARGIN_MS)
}
