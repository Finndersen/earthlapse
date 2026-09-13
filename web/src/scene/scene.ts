/**
 * Scene sequencing and cross-dissolve mixing (DESIGN §5, v1 note / ADR-009).
 *
 * v1 renders stills — no depth maps, no displacement — but the transition between them is a
 * real shader dissolve (see `transition.ts`), not a flat opacity ramp. `sceneAt` is the pure
 * heart of it: given the manifest's scenes and a time cursor, it says which two scenes to
 * show and how far to dissolve between them. Everything downstream (`<SceneView>` and its
 * WebGL/fallback renderers) is a thin consumer of this.
 */

import type { GeoTime } from '@/types/layer'
import type { Scene } from '@/types/manifest'

/**
 * The pair of scenes to render at `t`, and how much of `to` to dissolve over `from`.
 *
 * `from` is always drawn at full opacity; `to` is drawn at `mix` opacity on top of it.
 * `mix` 0 means only `from` is visible. Never drive both layers' opacity down at once —
 * that dips to the background between two real images, which this shape makes impossible
 * by construction (`from`'s opacity is never a function of `mix`).
 */
export interface SceneMix {
  from: Scene
  to: Scene
  mix: number
}

/**
 * Width of the dissolve, as a fraction of the log1p gap between two consecutive scenes,
 * centred on the gap's midpoint. Each scene is held clear for `1 - DISSOLVE_WIDTH` of the
 * gap; the brief cross-dissolve happens only in the narrow band around the midpoint. One
 * tunable, reused everywhere a dissolve window is needed — there is no separate within- vs
 * cross-chapter distinction any more (a 50/50 blend of two generated worlds reads as a muddy
 * double exposure regardless of which side of a chapter boundary it falls on; the shader
 * dissolve in `transition.ts` is what keeps the *brief* blend itself from reading as one).
 */
export const DISSOLVE_WIDTH = 0.14

/** Smoothstep of `x` (clamped) across `[edge0, edge1]`, 0 before it and 1 after. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (x <= edge0) return 0
  if (x >= edge1) return 1
  const u = (x - edge0) / (edge1 - edge0)
  return u * u * (3 - 2 * u)
}

/** `bisect.bisect_left` over scenes ascending by `t`: first index whose `t` is >= target. */
function bisectLeft(scenes: readonly Scene[], t: GeoTime): number {
  let lo = 0
  let hi = scenes.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (scenes[mid]!.t < t) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

function alone(scene: Scene): SceneMix {
  return { from: scene, to: scene, mix: 0 }
}

/**
 * Which two scenes to show at `t`, and how far to dissolve between them.
 *
 * `scenes` must be sorted ascending by `t` — newest (closest to present) first, oldest last.
 * Outside `[scenes[0].t, scenes[last].t]` this clamps to the nearer end scene alone, mix 0.
 * At exactly a scene's own `t` it returns that scene alone, mix 0. Between two consecutive
 * scenes `a` (newer) and `b` (older) it computes position `p` in `log1p(t)` space — matching
 * the symlog timeline warp (DESIGN §3) so a dissolve spans a proportional *screen* distance
 * rather than a proportional span of years — then dissolves through a `DISSOLVE_WIDTH`-wide
 * smoothstep window centred on the midpoint (`p = 0.5`): held at `a` alone for most of the
 * gap, a brief dissolve, held at `b` alone for the rest.
 */
export function sceneAt(scenes: readonly Scene[], t: GeoTime): SceneMix {
  if (scenes.length === 0) {
    throw new Error('sceneAt: no scenes')
  }

  const first = scenes[0]!
  const last = scenes[scenes.length - 1]!
  if (t <= first.t) return alone(first)
  if (t >= last.t) return alone(last)

  const i = bisectLeft(scenes, t)
  const b = scenes[i]!
  if (b.t === t) return alone(b)

  // bisectLeft guarantees scenes[i - 1].t < t < b.t here (the exact-match cases above already
  // took every t equal to a boundary), so a.t < b.t always holds and the division below is safe.
  const a = scenes[i - 1]!

  const p = (Math.log1p(t) - Math.log1p(a.t)) / (Math.log1p(b.t) - Math.log1p(a.t))
  const halfWidth = DISSOLVE_WIDTH / 2
  return { from: a, to: b, mix: smoothstep(0.5 - halfWidth, 0.5 + halfWidth, p) }
}

/** The scene that reads as "current" for UI that can only show one, e.g. a caption. */
export function dominantScene({ from, to, mix }: SceneMix): Scene {
  return mix < 0.5 ? from : to
}

/**
 * Caption cross-fade opacity for whichever scene is currently dominant, a pure function of
 * the same `mix` that drives the image dissolve — so the caption text fades out and back in
 * exactly in sync with it, dipping to 0 right at `mix = 0.5`, the instant `dominantScene`
 * switches which scene's caption is being shown, and back to 1 by the time `mix` settles at
 * either end. No separate width constant: `mix` is already 0 or 1 outside the dissolve band
 * around a gap's midpoint (see `DISSOLVE_WIDTH`), so this only ever moves within that band.
 */
export function captionOpacity(mix: number): number {
  const distanceFromSwitch = Math.abs(mix - 0.5) * 2
  return smoothstep(0, 1, distanceFromSwitch)
}

/** Resolves a manifest-relative media path against `Manifest.assetBase`. Leaves an already
 *  absolute URL (has a scheme, or is protocol-relative) untouched. */
export function resolveAssetUrl(assetBase: string, path: string): string {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(path)) return path
  const base = assetBase.endsWith('/') ? assetBase : `${assetBase}/`
  const rel = path.startsWith('/') ? path.slice(1) : path
  return `${base}${rel}`
}
