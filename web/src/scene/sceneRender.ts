/**
 * Reconciles the requested scene pair's mix/drift — computed in `SceneView`, a pure function of
 * `t` alone (`presentation.ts`, `drift.ts`) — against whichever pair `useScenePair` has actually
 * bound textures for. The two can disagree: `useScenePair` keeps the previously bound pair on
 * screen until a newly requested pair's textures have *both* finished loading (its own doc
 * comment), but `mix`/`fromDrift`/`toDrift` are computed for the pair actually being
 * *requested*, not for whatever is bound. Rendering the bound textures under the requested
 * uniforms unconditionally flashes a frame of the wrong scene the instant a scene checkpoint is
 * crossed with the new pair's texture still loading (fast playback, rapid scrubs, a cold
 * cache).
 *
 * `resolveSceneRender` is the fix: it always returns uniforms that describe the pair actually
 * bound, never the pending one.
 *
 * The full case table, re-derived from every shape `presentation.ts`'s `step()` can hand
 * `SceneView` relative to whatever `useScenePair` has actually bound (each checked before the
 * next — `pair` is atomically bound to one URL pair, so requested and bound can share at most
 * one scene per end without the sharing being the exact match already handled first):
 *
 * - **Exact match** (the common case, once loading has caught up): `target` passes through
 *   unchanged.
 * - **Forward** — the bound pair's trailing scene is the requested pair's leading one (`(A, B)`
 *   bound, `(B, C)` requested: ordinary playback/scrubbing past a checkpoint, one scene at a
 *   time, outrunning the load): render `B` alone, at `target.fromDrift` (computed for that same
 *   scene), `mix` pinned to `0` so only the `from` channel is sampled — pixel-exact per
 *   `shaders.ts`.
 * - **Backward** — the mirror image (`(B, C)` bound, `(A, B)` requested: a scrub reversing
 *   direction into a pair not yet bound): render `B` alone at `target.toDrift`, `mix` pinned to
 *   `1`.
 * - **Bound `from` survives** — `(A, B)` bound, `(A, C)` requested, `C` unrelated to `B`:
 *   `step()`'s direct-transition branch (a big jump landing on a settled, on-screen scene with
 *   nothing in common with the target pair) starts a *fresh* transition straight from whatever
 *   is on screen, so the bound pair's leading scene can stay the requested pair's leading scene
 *   while its trailing scene is replaced outright. Render `A` alone at `target.fromDrift`,
 *   `mix` pinned to `0` — the same shape as forward, just keyed off `from`/`from` instead of
 *   `to`/`from`. Without this branch the case fell through to the freeze below and hard-cut to
 *   `B`, even though `A` — exactly what should keep showing — was already loaded and bound.
 * - **Bound `to` survives** — `(A, B)` bound, `(C, B)` requested, `C` unrelated to `A`. Render
 *   `B` alone at `target.toDrift`, `mix` pinned to `1`. Rarer than the previous case, not its
 *   single-hop mirror: `step()` always starts a fresh transition as `from: onScreen, to: dest`,
 *   so from a settled `(A, B)` one jump yields `(A, dest)` or `(B, dest)` (the forward case).
 *   Requesting `(C, B)` needs two jumps while `(A, B)` stays bound — first onto an unrelated
 *   scene `C`, then a second landing back on `B`. The old fallback rendered the right texture
 *   here only by coincidence (it always freezes on the bound `to` texture) but the wrong —
 *   frozen, zero — drift.
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

  if (boundFromUrl === requested.fromUrl && boundToUrl === requested.toUrl) {
    return { fromTex, toTex, ...target }
  }
  if (boundToUrl === requested.fromUrl) {
    return { fromTex: toTex, toTex, mix: 0, fromDrift: target.fromDrift, toDrift: target.fromDrift }
  }
  if (boundFromUrl === requested.toUrl) {
    return { fromTex, toTex: fromTex, mix: 1, fromDrift: target.toDrift, toDrift: target.toDrift }
  }
  if (boundFromUrl === requested.fromUrl) {
    return { fromTex, toTex: fromTex, mix: 0, fromDrift: target.fromDrift, toDrift: target.fromDrift }
  }
  if (boundToUrl === requested.toUrl) {
    return { fromTex: toTex, toTex, mix: 1, fromDrift: target.toDrift, toDrift: target.toDrift }
  }
  return { fromTex: toTex, toTex, mix: 0, fromDrift: REST_DRIFT, toDrift: REST_DRIFT }
}
