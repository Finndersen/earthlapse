/**
 * Reconciles the requested scene pair's mix/drift — computed in `SceneView`, a pure function of
 * `t` alone (`presentation.ts`, `drift.ts`) — against whichever pair `useScenePair` has actually
 * bound textures for. The two can disagree: `useScenePair` keeps the previously bound pair on
 * screen until a newly requested pair's textures have *both* finished loading, but
 * `mix`/`fromDrift`/`toDrift` are computed for the pair actually being *requested*. Rendering
 * the bound textures under the requested uniforms unconditionally flashes a frame of the wrong
 * scene the instant a checkpoint is crossed with the new pair's texture still loading (fast
 * playback, rapid scrubs, a cold cache). `resolveSceneRender` always returns uniforms that
 * describe the pair actually bound, never the pending one.
 *
 * The full case table, re-derived from every shape `presentation.ts`'s `step()` can hand
 * `SceneView` relative to whatever `useScenePair` has bound (each checked before the next —
 * `pair` is bound atomically to one URL pair, so requested and bound can share at most one
 * scene per end without it being the exact match already handled first):
 *
 * - **Exact match** (the common case, once loading has caught up): `target` passes through
 *   unchanged.
 * - **Forward** — bound trailing scene is requested leading scene (`(A, B)` bound, `(B, C)`
 *   requested: ordinary playback/scrubbing past a checkpoint, outrunning the load): render `B`
 *   alone at `target.fromDrift`, `mix` pinned to `0` so only the `from` channel is sampled —
 *   pixel-exact per `shaders.ts`.
 * - **Backward** — the mirror image (`(B, C)` bound, `(A, B)` requested: a scrub reversing
 *   direction into a pair not yet bound): render `B` alone at `target.toDrift`, `mix` pinned to
 *   `1`.
 * - **Bound `from` survives** — `(A, B)` bound, `(A, C)` requested, `C` unrelated to `B`:
 *   `step()`'s direct-transition branch (a big jump landing on a settled, on-screen scene with
 *   nothing in common with the target pair) starts a fresh transition from whatever is on
 *   screen, so the bound leading scene can stay the requested leading scene while the trailing
 *   scene is replaced outright. Render `A` alone at `target.fromDrift`, `mix` pinned to `0` —
 *   without this branch the case would fall through to the freeze below and hard-cut to `B`
 *   even though `A` was already loaded and bound.
 * - **Bound `to` survives** — `(A, B)` bound, `(C, B)` requested, `C` unrelated to `A`. Render
 *   `B` alone at `target.toDrift`, `mix` pinned to `1`. Rarer, and not a single-hop mirror of
 *   the previous case: `step()` always starts a fresh transition as `from: onScreen, to: dest`,
 *   so requesting `(C, B)` needs two jumps while `(A, B)` stays bound — first onto an unrelated
 *   scene `C`, then a second landing back on `B`.
 * - **No scene in common** — a jump too big to share an end at all: `target`'s drift describes
 *   scenes neither bound texture is for, so there is no correct motion to apply. Freezes the
 *   bound pair's `to` texture at rest rather than moving it under borrowed drift.
 */

import type { DriftUniforms } from './drift'
import { REST_DRIFT } from './drift'
import type { ScenePair } from './useScenePair'

export interface RequestedScenePair {
  fromUrl: string
  toUrl: string
}

export interface SceneRenderTarget {
  mix: number
  fromDrift: DriftUniforms
  toDrift: DriftUniforms
}

export interface SceneRender {
  fromTex: NonNullable<ScenePair['fromTex']>
  toTex: NonNullable<ScenePair['toTex']>
  /** The URLs `fromTex`/`toTex` were loaded from, so per-image properties (the crop focus,
   *  `framing.ts`) follow the texture actually drawn rather than the pair requested. */
  fromUrl: string
  toUrl: string
  mix: number
  fromDrift: DriftUniforms
  toDrift: DriftUniforms
}

/** `null` before `pair` has ever bound a pair (mirrors `ScenePair.ready`) — the caller already
 *  has its own placeholder path for that first-load case, unchanged by this reconciliation. */
export function resolveSceneRender(
  requested: RequestedScenePair,
  pair: ScenePair,
  target: SceneRenderTarget,
): SceneRender | null {
  if (pair.fromTex === null || pair.toTex === null) return null
  const { fromTex, toTex, boundFromUrl, boundToUrl } = pair
  if (boundFromUrl === null || boundToUrl === null) {
    throw new Error('resolveSceneRender: a bound texture has no bound URL')
  }
  const from = { fromTex, fromUrl: boundFromUrl }
  const to = { toTex, toUrl: boundToUrl }
  const fromAlone = { fromTex, toTex: fromTex, fromUrl: boundFromUrl, toUrl: boundFromUrl }
  const toAlone = { fromTex: toTex, toTex, fromUrl: boundToUrl, toUrl: boundToUrl }

  if (boundFromUrl === requested.fromUrl && boundToUrl === requested.toUrl) {
    return { ...from, ...to, ...target }
  }
  if (boundToUrl === requested.fromUrl) {
    return { ...toAlone, mix: 0, fromDrift: target.fromDrift, toDrift: target.fromDrift }
  }
  if (boundFromUrl === requested.toUrl) {
    return { ...fromAlone, mix: 1, fromDrift: target.toDrift, toDrift: target.toDrift }
  }
  if (boundFromUrl === requested.fromUrl) {
    return { ...fromAlone, mix: 0, fromDrift: target.fromDrift, toDrift: target.fromDrift }
  }
  if (boundToUrl === requested.toUrl) {
    return { ...toAlone, mix: 1, fromDrift: target.toDrift, toDrift: target.toDrift }
  }
  return { ...toAlone, mix: 0, fromDrift: REST_DRIFT, toDrift: REST_DRIFT }
}
