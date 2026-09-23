/**
 * Which scene images to load ahead of the presented pair. Two tiers, each in priority order:
 *
 * - **decode**: decoded into `textureCache` (and uploaded, where the renderer can) so a cut to it
 *   binds in the same render. The scene either side of the pair, and up to `DECODE_AHEAD_SCENES`
 *   ahead of it (the nearer neighbour included) that playback reaches within the lookahead.
 * - **fetch**: encoded bytes only (`lib/imagePrefetcher.ts`), no decode and no GPU memory: the
 *   rest of the scenes playback reaches within `PREFETCH_LOOKAHEAD_SECONDS`, up to
 *   `FETCH_AHEAD_SCENES` of them, plus one more behind the pair.
 *
 * Paused or scrubbing, there is no direction to read ahead in, so both tiers fall back to one
 * scene either side of the pair, and the pair's own full images come first (`pairFirst`).
 *
 * `sceneByteWants` turns a plan into the byte store's wanted lists. Whatever they leave out is
 * aborted (`lib/imagePrefetcher.ts`), so a full image stops downloading once its scene is in
 * neither the requested nor the bound pair nor the plan.
 *
 * `horizonT` is where playback puts `t` after `PREFETCH_LOOKAHEAD_SECONDS`. The caller predicts it
 * with the same advance the playback loop uses, so steady mode's per-scene floor (ADR-029) and
 * scenes mode's pacing are already in it.
 */

import type { GeoTime } from '@/types/layer'
import type { Scene } from '@/types/manifest'

import { sceneAt } from './scene'

/** Long enough that a ~430 KB scene started this far ahead has arrived on a ~1.5 Mbps link
 *  (~2.3 s), short enough that a direction change or seek wastes few requests. */
export const PREFETCH_LOOKAHEAD_SECONDS = 3

/** Decoded scenes ahead of the pair. With the pair (2), a newly requested pair still loading (2)
 *  and one decoded neighbour behind, this fills `SCENE_CACHE_CAPACITY` (8) exactly. */
export const DECODE_AHEAD_SCENES = 3

/** Byte-only scenes beyond the decoded ones. At the ADR-029 floor (0.35 s a scene) the lookahead
 *  spans ~9 scenes; the cap bounds a run of zero-width territories that all cut at once. */
export const FETCH_AHEAD_SCENES = 12

export interface ScenePrefetchPlan {
  decode: number[]
  fetch: number[]
  /** No playback direction: the scene on screen is what the viewer is looking at, so no neighbour
   *  shares the link with it until its full images have arrived. */
  pairFirst: boolean
}

export interface PlaybackHeading {
  /** `t` now. */
  t: GeoTime
  /** `t` after `PREFETCH_LOOKAHEAD_SECONDS` of playback. */
  horizonT: GeoTime
}

function pairIndices(scenes: readonly Scene[], t: GeoTime): [number, number] {
  const { from, to } = sceneAt(scenes, t)
  const a = scenes.indexOf(from)
  const b = scenes.indexOf(to)
  return [Math.min(a, b), Math.max(a, b)]
}

/**
 * `fromIndex`/`toIndex` are the presented pair's indices in `scenes` (ascending `t`, as
 * `sceneAt` requires); `heading` is `null` unless playing. Neither tier repeats an index or
 * contains the pair's own.
 */
export function planScenePrefetch(
  scenes: readonly Scene[],
  fromIndex: number,
  toIndex: number,
  heading: PlaybackHeading | null,
): ScenePrefetchPlan {
  const lo = Math.min(fromIndex, toIndex)
  const hi = Math.max(fromIndex, toIndex)
  const inRange = (index: number): boolean => index >= 0 && index < scenes.length

  const direction = heading === null ? 0 : Math.sign(heading.horizonT - heading.t)
  if (heading === null || scenes.length === 0 || (direction !== 1 && direction !== -1)) {
    return { decode: [lo - 1, hi + 1].filter(inRange), fetch: [], pairFirst: true }
  }

  // Playback toward the present walks down the indices. The far end is the horizon pair's
  // leading scene, the one it is dissolving or about to cut to.
  const [horizonLo, horizonHi] = pairIndices(scenes, heading.horizonT)
  const nearest = direction < 0 ? lo - 1 : hi + 1
  const farthest = direction < 0 ? Math.min(horizonLo, nearest) : Math.max(horizonHi, nearest)
  const ahead: number[] = []
  const limit = DECODE_AHEAD_SCENES + FETCH_AHEAD_SCENES
  for (let index = nearest; inRange(index) && ahead.length < limit; index += direction) {
    if (direction < 0 ? index < farthest : index > farthest) break
    ahead.push(index)
  }

  const behind = direction < 0 ? hi + 1 : lo - 1
  const behindFetch = behind + (direction < 0 ? 1 : -1)
  return {
    decode: [...ahead.slice(0, DECODE_AHEAD_SCENES), behind].filter(inRange),
    fetch: [...ahead.slice(DECODE_AHEAD_SCENES), behindFetch].filter(inRange),
    pairFirst: false,
  }
}

/** Image URLs not loaded yet, each list in priority order. */
export interface PendingSceneImages {
  /** The pair `t` asks for, which the grace (ADR-051) waits on. */
  requested: readonly string[]
  /** The pair on screen, which lags `requested` while that has nothing to draw. */
  bound: readonly string[]
  decode: readonly string[]
  fetch: readonly string[]
  /** Thumbnails the pair and the plan could draw first. */
  nearThumbs: readonly string[]
  allThumbs: readonly string[]
}

/**
 * The byte store's `want` lists: both pairs' full images and the near thumbnails urgent, then the
 * plan's tiers and every other thumbnail. Under `pairFirst` the plan's full images are left out
 * until the requested pair's have arrived. Thumbnails are ~4 KB and always wanted.
 */
export function sceneByteWants(pending: PendingSceneImages, pairFirst: boolean): { urgent: string[]; background: string[] } {
  const holdPlan = pairFirst && pending.requested.length > 0
  return {
    urgent: [...new Set([...pending.requested, ...pending.bound, ...pending.nearThumbs])],
    background: [...(holdPlan ? [] : [...pending.decode, ...pending.fetch]), ...pending.allThumbs],
  }
}
