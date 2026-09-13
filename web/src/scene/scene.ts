/**
 * Scene sequencing and cross-dissolve mixing (DESIGN §5, v1 note / ADR-009).
 *
 * v1 renders a plain cross-dissolve between flat stills — no depth maps, no displacement.
 * `sceneAt` is the pure heart of it: given the manifest's scenes and chapters and a time
 * cursor, it says which two scenes to show and how far to dissolve between them. Everything
 * downstream (the `<SceneView>` component) is a thin renderer of this.
 */

import type { GeoTime } from '@/types/layer'
import type { Chapter, Scene } from '@/types/manifest'

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

/** Within a chapter, composition is held constant (DESIGN §6): a wide window means each
 *  image reads as itself for most of its span before slowly giving way to the next. */
const WITHIN_CHAPTER_WINDOW: readonly [number, number] = [0.3, 0.7]

/** Crossing a chapter boundary changes composition, which should read as a cut: a narrow
 *  window compresses the dissolve relative to the hold on either side of it. */
const CROSS_CHAPTER_WINDOW: readonly [number, number] = [0.45, 0.55]

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

function chapterOf(chapters: readonly Chapter[], chapterId: string): Chapter {
  const chapter = chapters.find((c) => c.id === chapterId)
  if (chapter === undefined) {
    throw new Error(`sceneAt: scene references unknown chapter "${chapterId}"`)
  }
  return chapter
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
 * rather than a proportional span of years — then dissolves through a smoothstep window
 * around the midpoint: wide within a chapter, narrow across a chapter boundary.
 */
export function sceneAt(scenes: readonly Scene[], chapters: readonly Chapter[], t: GeoTime): SceneMix {
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

  const sameChapter = chapterOf(chapters, a.chapterId).id === chapterOf(chapters, b.chapterId).id
  const [lo, hi] = sameChapter ? WITHIN_CHAPTER_WINDOW : CROSS_CHAPTER_WINDOW

  const p = (Math.log1p(t) - Math.log1p(a.t)) / (Math.log1p(b.t) - Math.log1p(a.t))
  return { from: a, to: b, mix: smoothstep(lo, hi, p) }
}

/** The scene that reads as "current" for UI that can only show one, e.g. a caption. */
export function dominantScene({ from, to, mix }: SceneMix): Scene {
  return mix < 0.5 ? from : to
}

/** Resolves a manifest-relative media path against `Manifest.assetBase`. Leaves an already
 *  absolute URL (has a scheme, or is protocol-relative) untouched. */
export function resolveAssetUrl(assetBase: string, path: string): string {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(path)) return path
  const base = assetBase.endsWith('/') ? assetBase : `${assetBase}/`
  const rel = path.startsWith('/') ? path.slice(1) : path
  return `${base}${rel}`
}
