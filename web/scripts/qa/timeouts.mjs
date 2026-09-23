/**
 * The harness's blind waits, isolated here rather than scattered through `shots.mjs`/`run.mjs`.
 * Each exists because `window.__earthtime.ready()` (`devHook.ts`) only covers network/decode
 * readiness: the local animation state these wait out has no DOM or store reflection to poll.
 */

/**
 * `scene/presentation.ts`'s `usePresentedSceneMix` rate-limits how fast the *displayed* scene
 * crossfade follows `t` (ADR-012): a full transition never completes in under
 * `MIN_TRANSITION_SECONDS` (1.6s there), however abruptly `t` jumps. Mirrored here as a plain
 * number, since this harness has no TypeScript/build step; if that constant changes, this one
 * needs a matching bump.
 *
 * Once settled the presented mix stops moving entirely (`moveToward` snaps onto the target and
 * its `requestAnimationFrame` loop stops), so waiting this long after a `t` jump is a
 * deterministic settle: any shorter and a screenshot can land mid-dissolve, two scenes' art
 * overlaid under the outgoing scene's caption.
 * @param {import('playwright').Page} page
 * @param {number} [alreadyElapsedMs] time already passed since the `t` jump, when the caller knows
 *   it — only the remainder is waited.
 */
export function waitForSceneCrossfadeSettle(page, alreadyElapsedMs = 0) {
  return page.waitForTimeout(Math.max(0, SCENE_CROSSFADE_SETTLE_MS - alreadyElapsedMs))
}

const MIN_TRANSITION_SECONDS_MIRROR = 1.6
const SCENE_CROSSFADE_SETTLE_MS = Math.round(MIN_TRANSITION_SECONDS_MIRROR * 1000 + 150)

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
