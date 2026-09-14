/**
 * Touch/pen gesture arbitration for a press that starts on a checkpoint pip/cluster marker's own
 * touch target (ADR-021 follow-up). The marker buttons' own `pointerdown` used to `stopPropagation`
 * unconditionally, which on a phone — where markers' own ~44px-tall touch targets (`@media
 * (pointer: coarse)`, `ScrubTrack.module.css`) cover most of the track — meant a real drag that
 * happened to start on one never reached `ScrubTrack`'s own scrub handling at all: the press
 * committed straight to "select this marker" before the gesture had a chance to become a drag.
 *
 * `ScrubTrack` now defers that commitment: a touch/pen press on a marker starts in a pending
 * state (the marker it landed on, plus where it started) rather than selecting or scrubbing
 * immediately. `hasExceededTapSlop` is consulted on every subsequent move — once movement passes
 * `MARKER_TAP_SLOP_PX`, the press resolves into an ordinary track scrub (same continuity rules as
 * a drag that started on empty track) and stays that way for the rest of the gesture; short of
 * that, lifting resolves it into a tap — select the pip / open the cluster, exactly as a mouse
 * click already does. Mouse is unaffected: its own `pointerdown` still stops propagation before
 * any of this runs, so a mouse click on a marker keeps selecting immediately.
 *
 * A long, motionless press does not lose its tap outcome here — as long as it never exceeds the
 * slop, lifting it still selects/opens, the same way a slow tap on a real touchscreen does. Per
 * the brief's own long-press allowance ("may show the magnifier too... implement if simple and
 * consistent, otherwise document"): the magnifier already shows for *any* pressed touch/pen
 * pointer regardless of arbitration state (`ScrubTrack`'s `touchPoint`, set on every non-mouse
 * pointerdown/move), so a long motionless press already previews the magnifier for free — no
 * separate long-press mode is implemented, since one would only add a second, redundant timing
 * threshold alongside the slop this module already tracks.
 */

/** CSS px of movement, from where a touch/pen press on a marker began, before that press commits
 *  to a track scrub instead of a potential tap — small enough that a real tap's own incidental
 *  jitter stays under it, large enough that an intentional drag clears it almost immediately. */
export const MARKER_TAP_SLOP_PX = 8

/**
 * Whether a press that began at `(0, 0)` and has since moved `(dxPx, dyPx)` (both CSS px, in
 * screen/client space) has moved far enough to no longer be a candidate tap. Euclidean, not
 * axis-separate, since the track scrubs horizontally but a real finger's incidental drift is
 * never purely horizontal.
 */
export function hasExceededTapSlop(dxPx: number, dyPx: number, slopPx: number = MARKER_TAP_SLOP_PX): boolean {
  return Math.hypot(dxPx, dyPx) > slopPx
}
