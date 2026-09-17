/**
 * Reconciles the requested older/younger plate pair's `alpha` — computed in `AncestorPortrait`,
 * a pure function of `t` alone via `usePresentedMix`/`portraitDrawState` — against whichever
 * set `usePortraitPair` has actually bound textures for. The two can disagree: `usePortraitPair`
 * keeps the previously bound set on screen until a newly requested set's textures have *all*
 * finished loading (its own doc comment), but `alpha`/`forwardRange`/`backwardRange` are
 * computed for the pair actually being *requested*, not for whatever is bound. Drawing the
 * bound textures under the requested uniforms unconditionally flashes a frame of the wrong
 * ancestor the instant a morph boundary is crossed with the new pair's texture still loading
 * (fast playback, rapid scrubs, a cold cache) — including at the settled end of every morph,
 * where `presentedMix.ts`'s `stepMix` rebases a settled `(older, younger)` pair to `(younger,
 * younger)` alone: the stale bound `(older, younger)` set at `alpha 0` would draw the *older*
 * plate, a flash of the previous ancestor — except `usePortraitPair`'s render-phase bind
 * already closes that particular case (the younger plate was already cached, being what was
 * just on screen), so what remains for this module is the genuinely cold path: a set whose
 * texture load hasn't caught up to `t` yet.
 *
 * `resolvePortraitRender` is the fix, structurally identical to `scene/sceneRender.ts`'s
 * `resolveSceneRender`: it always returns uniforms that describe the pair actually bound, never
 * the pending one. It is not the same function, and not a generic shared one, because the two
 * shapes genuinely differ — a portrait set is two plate textures *plus* an optional forward/
 * backward flow pair gated by its own `uHasFlow`, where a scene set is just two textures and a
 * `mix`; forcing them through one generic would either lose the flow gating or reintroduce it as
 * a bolt-on the scene side never needs. The reconciliation logic they share is the *shape* of
 * the case table below, not code — see that module's doc comment for the full derivation this
 * one mirrors, re-expressed here for `older`/`younger`/`alpha` (`alpha` 0 is older alone, 1
 * younger alone — the inverse sense of `sceneRender.ts`'s `mix`, where 0 is `from`/younger-
 * equivalent alone) in place of `from`/`to`/`mix`, in the order the code below checks them:
 *
 * - **Exact match**: `target` passes through unchanged, `hasFlow` true only when the bound set
 *   actually has flow textures (i.e. the requested pair has a computed morph and it is fully
 *   bound).
 * - **Bound older survives as requested younger** (a scrub reversing direction into a pair not
 *   yet bound — bound `(B, C)`, requested `(A, B)` with `A` not yet loaded): render the bound
 *   set's older plate (`B`) alone.
 * - **Bound younger survives as requested older** (the common "just finished, or just started,
 *   a morph" case — bound `(A, B)`, requested `(B, B)` at the settled end, or `(B, C)` at the
 *   start of the next morph): render `B` (the bound set's younger plate) alone, `alpha` pinned
 *   to `0` so only the `uOlder` sampler is read — pixel-exact per `portraitShaders.ts`, and
 *   correct regardless of which sampler holds `B` since both are set to it. No flow: a single
 *   plate has nothing to warp.
 * - **Bound younger survives as requested younger**: a big jump landing on a settled, on-screen
 *   plate replaces only the older end — render the bound younger plate alone.
 * - **Bound older survives as requested older**: the mirror — render the bound older plate
 *   alone.
 * - **No plate in common**: no bound texture is correct for this pairing at all. Rather than
 *   picking a fixed side of the *bound* set (which can lag several frames behind a fast jump,
 *   so its "older" texture may be an ancestor further back than anything actually on screen
 *   recently), freezes on `lastDrawnTex` — whichever single plate the caller most recently
 *   rendered, tracked outside this pure function (`PortraitCanvas`'s ref) precisely because it
 *   is state, not something derivable from `requested`/`pair`/`target` alone.
 */

import type * as THREE from 'three'

import type { PortraitFlow, PortraitPair } from './usePortraitPair'

export interface RequestedPortraitSet {
  olderUrl: string
  youngerUrl: string
  /** `null` crossfades without warping — no forward/backward texture is requested. */
  flow: PortraitFlow | null
}

export interface PortraitRenderTarget {
  /** 0 the older plate alone, 1 the younger. */
  alpha: number
  forwardRange: number
  backwardRange: number
}

export interface PortraitRender {
  olderTex: THREE.Texture
  youngerTex: THREE.Texture
  forwardTex: THREE.Texture | null
  backwardTex: THREE.Texture | null
  alpha: number
  forwardRange: number
  backwardRange: number
  hasFlow: boolean
}

/**
 * `null` before `pair` has ever bound a set (mirrors `PortraitPair.ready`) — the caller already
 * has its own placeholder path for that first-load case, unchanged by this reconciliation.
 *
 * `lastDrawnTex` is the single plate texture the caller actually rendered last frame (or `null`
 * before any frame has drawn) — used only by the "no plate in common" fallback below. It is the
 * one piece of state this otherwise-pure function needs, because "what was just on screen" is
 * not recoverable from `requested`/`pair`/`target` alone: `pair` describes the *bound* set,
 * which can itself be several plates behind whatever was last drawn while it was still catching
 * up (see `PortraitCanvas`'s tracking of it).
 */
export function resolvePortraitRender(
  requested: RequestedPortraitSet,
  pair: PortraitPair,
  target: PortraitRenderTarget,
  lastDrawnTex: THREE.Texture | null,
): PortraitRender | null {
  if (pair.olderTex === null || pair.youngerTex === null) return null
  const { olderTex, youngerTex, forwardTex, backwardTex, boundOlderUrl, boundYoungerUrl, boundForwardUrl, boundBackwardUrl } = pair
  const requestedForwardUrl = requested.flow?.forwardUrl ?? null
  const requestedBackwardUrl = requested.flow?.backwardUrl ?? null

  if (
    boundOlderUrl === requested.olderUrl &&
    boundYoungerUrl === requested.youngerUrl &&
    boundForwardUrl === requestedForwardUrl &&
    boundBackwardUrl === requestedBackwardUrl
  ) {
    return {
      olderTex,
      youngerTex,
      forwardTex,
      backwardTex,
      alpha: target.alpha,
      forwardRange: target.forwardRange,
      backwardRange: target.backwardRange,
      hasFlow: forwardTex !== null && backwardTex !== null,
    }
  }

  const alone = (tex: THREE.Texture): PortraitRender => ({
    olderTex: tex,
    youngerTex: tex,
    forwardTex: null,
    backwardTex: null,
    alpha: 0,
    forwardRange: 0,
    backwardRange: 0,
    hasFlow: false,
  })

  if (boundOlderUrl === requested.youngerUrl) return alone(olderTex)
  if (boundYoungerUrl === requested.olderUrl) return alone(youngerTex)
  if (boundYoungerUrl === requested.youngerUrl) return alone(youngerTex)
  if (boundOlderUrl === requested.olderUrl) return alone(olderTex)
  return alone(lastDrawnTex ?? olderTex)
}
