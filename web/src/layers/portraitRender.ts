/**
 * Reconciles the requested older/younger plate pair's `alpha`/`forwardRange`/`backwardRange`
 * (computed in `AncestorPortrait`, pure in `t`) against whichever pair `usePortraitPair` has
 * actually bound textures for. The two can disagree: `usePortraitPair` keeps the previous bound
 * set on screen until the newly requested set's textures *all* finish loading, so drawing the
 * bound textures under the requested uniforms unconditionally would flash a frame of the wrong
 * ancestor whenever a morph boundary is crossed before the new pair is ready.
 *
 * Structurally mirrors `scene/sceneRender.ts`'s `resolveSceneRender` (see its doc comment for
 * the full case-table derivation) — always returns uniforms describing the pair actually
 * bound, never the pending one — but isn't the same function: a portrait set carries an
 * optional forward/backward flow pair gated by `uHasFlow`, where a scene set is just two
 * textures and a `mix`. `alpha` here is the inverse sense of `sceneRender.ts`'s `mix`: 0 is
 * older alone, 1 is younger alone.
 *
 * Cases, in the order checked below:
 * - exact match: pass `target` through unchanged; `hasFlow` only when the bound set has flow
 *   textures too
 * - bound older survives as requested younger (a scrub reverses into a not-yet-bound pair):
 *   render the bound older plate alone
 * - bound younger survives as requested older (settled end of a morph, or start of the next):
 *   render the bound younger plate alone, `alpha` pinned to 0 (pixel-exact per
 *   `portraitShaders.ts`; `usePortraitPair`'s render-phase bind already guarantees that plate
 *   was cached, so this can't itself flash the previous ancestor)
 * - bound younger survives as requested younger: render the bound younger plate alone
 * - bound older survives as requested older: render the bound older plate alone
 * - no plate in common: freeze on `lastDrawnTex` rather than picking a side of the bound set,
 *   which can lag a fast jump by several frames and show a plate that wasn't recently on screen
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
 * `null` before `pair` has ever bound a set (mirrors `PortraitPair.ready`) — the caller has its
 * own placeholder path for that first-load case.
 *
 * `lastDrawnTex` is the single plate texture the caller actually rendered last frame (`null`
 * before any frame has drawn), used only by the "no plate in common" fallback. It's the one
 * piece of state this otherwise-pure function needs: `pair` describes the *bound* set, which can
 * itself lag several plates behind whatever was last drawn while still catching up.
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
