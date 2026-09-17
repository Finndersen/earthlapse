import { describe, expect, it } from 'vitest'

import type { Mix } from '@/lib/presentedMix'
import { stepMix } from '@/lib/presentedMix'
import type { PortraitPlate } from '@/types/layer'

import { PORTRAIT_TREE_DATA } from './portraitFixtures'
import { indexPortraits, MIN_PORTRAIT_TRANSITION_SECONDS, PORTRAIT_MIX_KEYING, portraitAt, portraitDrawState, portraitEase } from './portraits'
import { resolvePortraitRender, type PortraitRender, type RequestedPortraitSet } from './portraitRender'
import type { PortraitFlow, PortraitPair } from './usePortraitPair'

function texture(name: string): { name: string } {
  return { name }
}

function pair(
  boundOlderUrl: string | null,
  boundYoungerUrl: string | null,
  olderTex: unknown,
  youngerTex: unknown,
  boundForwardUrl: string | null = null,
  boundBackwardUrl: string | null = null,
  forwardTex: unknown = null,
  backwardTex: unknown = null,
): PortraitPair {
  return {
    olderTex: olderTex as PortraitPair['olderTex'],
    youngerTex: youngerTex as PortraitPair['youngerTex'],
    forwardTex: forwardTex as PortraitPair['forwardTex'],
    backwardTex: backwardTex as PortraitPair['backwardTex'],
    boundOlderUrl,
    boundYoungerUrl,
    boundForwardUrl,
    boundBackwardUrl,
    ready: boundOlderUrl !== null,
  }
}

const aTex = texture('a')
const bTex = texture('b')
const cTex = texture('c')
const dTex = texture('d')
const fwdTex = texture('fwd')
const backTex = texture('back')

const flow: PortraitFlow = { forwardUrl: 'b-fwd.png', backwardUrl: 'b-back.png', forwardRange: 0.2, backwardRange: 0.1 }
const target = { alpha: 0.5, forwardRange: 0.2, backwardRange: 0.1 }

function requested(olderUrl: string, youngerUrl: string, requestedFlow: PortraitFlow | null = null): RequestedPortraitSet {
  return { olderUrl, youngerUrl, flow: requestedFlow }
}

describe('resolvePortraitRender', () => {
  it('returns null before any set has ever bound (the first-load case)', () => {
    const notReady = pair(null, null, null, null)
    expect(resolvePortraitRender(requested('a.png', 'b.png'), notReady, target, null)).toBeNull()
  })

  it('passes target through unchanged when the bound set exactly matches what is requested, with no flow', () => {
    const bound = pair('a.png', 'b.png', aTex, bTex)
    const render = resolvePortraitRender(requested('a.png', 'b.png'), bound, target, null)
    expect(render).toEqual({
      olderTex: aTex,
      youngerTex: bTex,
      forwardTex: null,
      backwardTex: null,
      alpha: 0.5,
      forwardRange: 0.2,
      backwardRange: 0.1,
      hasFlow: false,
    })
  })

  it('passes target through unchanged, with flow textures and hasFlow true, when the bound set exactly matches a requested morph', () => {
    const bound = pair('a.png', 'b.png', aTex, bTex, flow.forwardUrl, flow.backwardUrl, fwdTex, backTex)
    const render = resolvePortraitRender(requested('a.png', 'b.png', flow), bound, target, null)
    expect(render).toEqual({
      olderTex: aTex,
      youngerTex: bTex,
      forwardTex: fwdTex,
      backwardTex: backTex,
      alpha: 0.5,
      forwardRange: 0.2,
      backwardRange: 0.1,
      hasFlow: true,
    })
  })

  it(
    "renders the bound set's older plate alone when a scrub reverses direction into a pair " +
      'not yet bound — bound (older=b, younger=c), requested (older=a, younger=b) with a not yet loaded',
    () => {
      const bound = pair('b.png', 'c.png', bTex, cTex)
      const render = resolvePortraitRender(requested('a.png', 'b.png'), bound, target, null)
      expect(render).toEqual({
        olderTex: bTex,
        youngerTex: bTex,
        forwardTex: null,
        backwardTex: null,
        alpha: 0,
        forwardRange: 0,
        backwardRange: 0,
        hasFlow: false,
      })
    },
  )

  it(
    'renders the bound set\'s younger plate alone, alpha pinned to 0 and no flow, when the ' +
      'requested pair has moved on past it — e.g. bound (older=a, younger=b), requested ' +
      '(older=b, younger=c) mid-playback with c still loading',
    () => {
      const bound = pair('a.png', 'b.png', aTex, bTex)
      const render = resolvePortraitRender(requested('b.png', 'c.png', flow), bound, target, null)
      // b alone: both channels sample b's texture, alpha pinned to 0 (pixel-exact per
      // portraitShaders.ts), no flow — a single plate has nothing to warp.
      expect(render).toEqual({
        olderTex: bTex,
        youngerTex: bTex,
        forwardTex: null,
        backwardTex: null,
        alpha: 0,
        forwardRange: 0,
        backwardRange: 0,
        hasFlow: false,
      })
    },
  )

  it(
    'renders the same bound younger plate alone when the requested pair has settled onto it ' +
      'exactly — the end-of-morph rebase: bound (older=a, younger=b), requested (older=b, ' +
      'younger=b) with the stale (a, b) set still bound',
    () => {
      const bound = pair('a.png', 'b.png', aTex, bTex)
      const render = resolvePortraitRender(requested('b.png', 'b.png'), bound, { alpha: 0, forwardRange: 0, backwardRange: 0 }, null)
      expect(render).toEqual({
        olderTex: bTex,
        youngerTex: bTex,
        forwardTex: null,
        backwardTex: null,
        alpha: 0,
        forwardRange: 0,
        backwardRange: 0,
        hasFlow: false,
      })
    },
  )

  it(
    "younger survives: renders the bound set's younger plate alone when the requested pair " +
      'kept it but replaced the older end with something unrelated — bound (a, b), requested (c, b)',
    () => {
      const bound = pair('a.png', 'b.png', aTex, bTex)
      const render = resolvePortraitRender(requested('c.png', 'b.png'), bound, target, null)
      expect(render).toEqual({
        olderTex: bTex,
        youngerTex: bTex,
        forwardTex: null,
        backwardTex: null,
        alpha: 0,
        forwardRange: 0,
        backwardRange: 0,
        hasFlow: false,
      })
    },
  )

  it(
    "older survives: renders the bound set's older plate alone when the requested pair kept " +
      'it but replaced the younger end with something unrelated — bound (a, b), requested (a, c)',
    () => {
      const bound = pair('a.png', 'b.png', aTex, bTex)
      const render = resolvePortraitRender(requested('a.png', 'c.png'), bound, target, null)
      expect(render).toEqual({
        olderTex: aTex,
        youngerTex: aTex,
        forwardTex: null,
        backwardTex: null,
        alpha: 0,
        forwardRange: 0,
        backwardRange: 0,
        hasFlow: false,
      })
    },
  )

  describe('no plate in common (the fallback)', () => {
    it('freezes on `lastDrawnTex` — the plate actually on screen last frame — rather than a fixed side of the bound set', () => {
      // The bound set is (a, b), but the caller last actually drew `d` (e.g. the bound set
      // itself lagged several frames behind a fast jump that has already passed through it —
      // see this module's own doc comment). Freezing on the bound set's `a` here would be a
      // flash back to an ancestor further in the past than what was already on screen.
      const bound = pair('a.png', 'b.png', aTex, bTex)
      const render = resolvePortraitRender(requested('x.png', 'y.png'), bound, target, dTex as unknown as PortraitPair['olderTex'])
      expect(render).toEqual({
        olderTex: dTex,
        youngerTex: dTex,
        forwardTex: null,
        backwardTex: null,
        alpha: 0,
        forwardRange: 0,
        backwardRange: 0,
        hasFlow: false,
      })
    })

    it("falls back to the bound set's older plate only when nothing has been drawn yet (lastDrawnTex null)", () => {
      const bound = pair('a.png', 'b.png', aTex, bTex)
      const render = resolvePortraitRender(requested('x.png', 'y.png'), bound, target, null)
      expect(render).toEqual({
        olderTex: aTex,
        youngerTex: aTex,
        forwardTex: null,
        backwardTex: null,
        alpha: 0,
        forwardRange: 0,
        backwardRange: 0,
        hasFlow: false,
      })
    })
  })
})

describe('resolvePortraitRender integration: continuity under a lagging bound pair', () => {
  // Drives the real pipeline a caller would — stepMix's presentation limiter, then
  // portraitDrawState — against a `pair` that never resyncs for the whole run (the cold-cache
  // case: `usePortraitPair` request in flight the entire time), and asserts the plate
  // resolvePortraitRender actually hands back never regresses relative to the scrub direction —
  // the property the `lastDrawnTex` fallback exists to guarantee once no bound texture is a
  // correct choice for the requested pair any more.
  const treeIndex = indexPortraits(PORTRAIT_TREE_DATA)!
  const urlOf = (p: PortraitPlate): string => `/media/${p.image}`
  const texOf = (p: PortraitPlate): PortraitPair['olderTex'] => ({ name: p.nodeId }) as unknown as PortraitPair['olderTex']
  const plateOf = (nodeId: string): PortraitPlate => treeIndex.plates.find((p) => p.nodeId === nodeId)!

  /**
   * Reproduces this module's own worked example precisely (its doc comment, and the bug
   * report's "fast playback (B, C) -> (C, D) with C cold -> freezes on A, two ancestors back"):
   * `bound` is synced exactly once, mid-morph between `tetrapod` (older) and `primate`
   * (younger) — `t` = primate's own divergence, where `portraitAt` centres the band, so
   * `presented` mounts there directly (`dtSteps[0]` then fully settles it onto primate alone in
   * one oversized step). Every step after that drives `presented` toward a fixed target of
   * `human` alone (`t = 0`) without `bound` ever resyncing:
   * - settled on primate, stepMix starts a *direct transition* `(primate, human)` — bound still
   *   shares its younger end (primate) with this, so it draws correctly ("shows B").
   * - once that transition itself fully settles, `portraitDrawState` reports `(human, human)` —
   *   bound `(tetrapod, primate)` now shares nothing with it at all ("settles to (X, X) with X
   *   cold"). Without the fix this freezes on `tetrapod` (`alone(olderTex)`, a fixed side of the
   *   *bound* set) — an ancestor further in the past than anything actually shown ("fallback
   *   shows A"). With it, `lastDrawnTex` keeps it on `primate`.
   */
  function reproduceWorkedExample(dtSteps: readonly number[]): number[] {
    let presented: Mix<PortraitPlate> = portraitAt(treeIndex, 6.6e7)! // primate's own divergence
    const pair: PortraitPair = {
      olderTex: texOf(plateOf('tetrapod')),
      youngerTex: texOf(plateOf('primate')),
      forwardTex: null,
      backwardTex: null,
      boundOlderUrl: urlOf(plateOf('tetrapod')),
      boundYoungerUrl: urlOf(plateOf('primate')),
      boundForwardUrl: null,
      boundBackwardUrl: null,
      ready: true,
    }
    const target = portraitAt(treeIndex, 0)! // present: alone(human)
    let lastDrawnTex: PortraitPair['olderTex'] = null
    const drawnDivergences: number[] = []

    for (const dt of dtSteps) {
      presented = stepMix(presented, target, dt, MIN_PORTRAIT_TRANSITION_SECONDS, PORTRAIT_MIX_KEYING)
      const draw = portraitDrawState(presented)
      const render: PortraitRender = resolvePortraitRender(
        { olderUrl: urlOf(draw.older), youngerUrl: urlOf(draw.younger), flow: null },
        pair,
        { alpha: portraitEase(draw.alpha), forwardRange: 0, backwardRange: 0 },
        lastDrawnTex,
      )!
      lastDrawnTex = render.alpha < 0.5 ? render.olderTex : render.youngerTex
      const drawnNodeId = (lastDrawnTex as unknown as { name: string }).name
      drawnDivergences.push(treeIndex.plates.find((p) => p.nodeId === drawnNodeId)!.tDivergence)
    }
    return drawnDivergences
  }

  it('never regresses to an older plate than the one it just drew, even once the bound set shares nothing with the requested pair at all', () => {
    // Step 1 (dt 0.7, maxDelta 0.583 > the 0.5 needed): settles the (tetrapod, primate) morph
    // onto primate exactly. Steps 2-6 (dt 0.3, maxDelta 0.25 each) carry the direct transition
    // to human through mix 0.25, 0.5, 0.75, 1.0, then (step 6) rebase and settle onto human
    // alone — the frame that hits the "no plate in common" fallback.
    const drawn = reproduceWorkedExample([0.7, 0.3, 0.3, 0.3, 0.3, 0.3])
    for (let i = 1; i < drawn.length; i++) {
      expect(drawn[i]).toBeLessThanOrEqual(drawn[i - 1]!)
    }
    // The exact frame this fix targets: requested has settled on human alone while bound is
    // still (tetrapod, primate) — the drawn plate must still be primate, not tetrapod.
    expect(drawn[drawn.length - 1]).toBe(plateOf('primate').tDivergence)
  })
})
