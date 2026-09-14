/**
 * Tiny numeric helpers shared by every effect envelope in this directory. No three.js, no
 * React — every function here is pure in its arguments, mirroring the GLSL `smoothstep` the
 * shader side uses for the same curves (`shaders.ts`), so the CPU-computed weights and the
 * GPU-rendered look agree.
 */

import type { GeoTime } from '@/types/layer'

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

/** Clamped Hermite interpolation, identical to GLSL's `smoothstep`: 0 at/below `edge0`, 1
 *  at/above `edge1`, eased between. `edge0` must be less than `edge1`. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const f = clamp01((x - edge0) / (edge1 - edge0))
  return f * f * (3 - 2 * f)
}

/**
 * Mirrors `timeline/scale.ts`'s `SYMLOG_C` by value (not by importing `@/timeline` — this
 * package stays self-contained in its own `t` math, the same convention `scene/pacing.ts`
 * follows for the same reason, down to reimplementing `log1p` locally rather than reaching for
 * a `TimeScale`). Only the warp's *shape* matters to every user below (how far apart two times
 * read on the symlog timeline), so a hand-kept drift between the two constants would only
 * mistune an ease width, never break correctness.
 */
export const SYMLOG_C = 1e4

/**
 * The timeline's own symlog warp (`timeline/scale.ts`'s `warpSymlog`), reimplemented here so
 * every ease/crossfade width in this package can be sized in on-screen (warped) space rather
 * than raw years. A fixed-year width goes sub-pixel deep in time — `log1p` compresses the
 * symlog timeline so hard that, say, the Sturtian glaciation's 56 Myr span reads as a sliver at
 * full zoom-out — so anything that must stay visible as `t` moves needs to be sized against
 * `symlogWarp(t)`, not against `t` itself (docs/GLOBE.md §4.3's "gradual transition" fix).
 */
export function symlogWarp(t: GeoTime): number {
  return Math.log1p(t / SYMLOG_C)
}

/** `smoothstep` over the warped distance between `t` and `edge` — 0 at `edge` itself, 1 once
 *  the *warped* distance reaches `easeWidthWarp`. `easeWidthWarp` therefore reads as a constant
 *  on-screen width at any era, unlike a plain year count (see `symlogWarp`'s doc comment). */
export function warpedEdgeProgress(t: GeoTime, edge: GeoTime, easeWidthWarp: number): number {
  return smoothstep(0, easeWidthWarp, Math.abs(symlogWarp(t) - symlogWarp(edge)))
}
