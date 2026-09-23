import { describe, expect, it } from 'vitest'

import type { Mix } from '@/lib/presentedMix'
import { stepMix } from '@/lib/presentedMix'
import type { PortraitPlate } from '@/types/layer'

import { PORTRAIT_TREE_DATA } from './portraitFixtures'
import { indexPortraits, MIN_PORTRAIT_TRANSITION_SECONDS, PORTRAIT_MIX_KEYING, portraitAt, portraitDrawState, portraitEase } from './portraits'
import { resolvePortraitRender, type PortraitRender, type RequestedPortraitSet } from './portraitRender'
import type { PortraitFlow, PortraitPair } from './usePortraitPair'

type Tex = PortraitPair['olderTex']
const tex = (name: string) => ({ name }) as unknown as Tex
const TEX: Record<string, Tex> = { a: tex('a'), b: tex('b'), c: tex('c'), d: tex('d'), fwd: tex('fwd'), back: tex('back') }

function bound(older: string | null, younger: string | null, flow = false): PortraitPair {
  return {
    olderTex: older ? TEX[older]! : null,
    youngerTex: younger ? TEX[younger]! : null,
    forwardTex: flow ? TEX.fwd! : null,
    backwardTex: flow ? TEX.back! : null,
    boundOlderUrl: older && `${older}.png`,
    boundYoungerUrl: younger && `${younger}.png`,
    boundForwardUrl: flow ? 'b-fwd.png' : null,
    boundBackwardUrl: flow ? 'b-back.png' : null,
    ready: older !== null,
  }
}

const FLOW: PortraitFlow = { forwardUrl: 'b-fwd.png', backwardUrl: 'b-back.png', forwardRange: 0.2, backwardRange: 0.1 }
const TARGET = { alpha: 0.5, forwardRange: 0.2, backwardRange: 0.1 }

function requested(older: string, younger: string, flow: PortraitFlow | null = null): RequestedPortraitSet {
  return { olderUrl: `${older}.png`, youngerUrl: `${younger}.png`, flow }
}

function alone(t: Tex) {
  return { olderTex: t, youngerTex: t, forwardTex: null, backwardTex: null, alpha: 0, forwardRange: 0, backwardRange: 0, hasFlow: false }
}

describe('resolvePortraitRender', () => {
  it('is null before anything has bound', () => {
    expect(resolvePortraitRender(requested('a', 'b'), bound(null, null), TARGET, null)).toBeNull()
  })

  it('passes the target through when the bound set matches the request, with or without flow', () => {
    expect(resolvePortraitRender(requested('a', 'b'), bound('a', 'b'), TARGET, null)).toEqual({
      olderTex: TEX.a,
      youngerTex: TEX.b,
      forwardTex: null,
      backwardTex: null,
      ...TARGET,
      hasFlow: false,
    })
    expect(resolvePortraitRender(requested('a', 'b', FLOW), bound('a', 'b', true), TARGET, null)).toMatchObject({
      forwardTex: TEX.fwd,
      backwardTex: TEX.back,
      hasFlow: true,
    })
  })

  it.each([
    ['reversing into an unbound older pair', ['b', 'c'], ['a', 'b'], 'b'],
    ['moving past the bound pair', ['a', 'b'], ['b', 'c'], 'b'],
    ['settling onto the bound younger plate', ['a', 'b'], ['b', 'b'], 'b'],
    ['keeping only the younger end', ['a', 'b'], ['c', 'b'], 'b'],
    ['keeping only the older end', ['a', 'b'], ['a', 'c'], 'a'],
  ] as const)('shows the shared plate alone when %s', (_label, [bo, by], [ro, ry], shared) => {
    expect(resolvePortraitRender(requested(ro, ry, FLOW), bound(bo, by), TARGET, null)).toEqual(alone(TEX[shared]!))
  })

  it('freezes on the last drawn plate when nothing is shared, falling back to the bound older plate', () => {
    expect(resolvePortraitRender(requested('x', 'y'), bound('a', 'b'), TARGET, TEX.d!)).toEqual(alone(TEX.d!))
    expect(resolvePortraitRender(requested('x', 'y'), bound('a', 'b'), TARGET, null)).toEqual(alone(TEX.a!))
  })

  it('never regresses to an older plate than the one just drawn while the bound pair lags', () => {
    const index = indexPortraits(PORTRAIT_TREE_DATA)!
    const plate = (id: string) => index.plates.find((p) => p.nodeId === id)!
    const url = (p: PortraitPlate) => `/media/${p.image}`
    const texOf = (p: PortraitPlate) => ({ name: p.nodeId }) as unknown as Tex
    // Bound once mid-morph (tetrapod → primate) and never resynced while playback runs to the present.
    const lagging: PortraitPair = {
      ...bound(null, null),
      olderTex: texOf(plate('tetrapod')),
      youngerTex: texOf(plate('primate')),
      boundOlderUrl: url(plate('tetrapod')),
      boundYoungerUrl: url(plate('primate')),
      ready: true,
    }
    let presented: Mix<PortraitPlate> = portraitAt(index, 6.6e7)!
    const target = portraitAt(index, 0)!
    let last: Tex = null
    const drawn: number[] = []
    for (const dt of [0.7, 0.3, 0.3, 0.3, 0.3, 0.3]) {
      presented = stepMix(presented, target, dt, MIN_PORTRAIT_TRANSITION_SECONDS, PORTRAIT_MIX_KEYING)
      const draw = portraitDrawState(presented)
      const render: PortraitRender = resolvePortraitRender(
        { olderUrl: url(draw.older), youngerUrl: url(draw.younger), flow: null },
        lagging,
        { alpha: portraitEase(draw.alpha), forwardRange: 0, backwardRange: 0 },
        last,
      )!
      last = render.alpha < 0.5 ? render.olderTex : render.youngerTex
      drawn.push(plate((last as unknown as { name: string }).name).tDivergence)
    }
    for (let i = 1; i < drawn.length; i++) expect(drawn[i]).toBeLessThanOrEqual(drawn[i - 1]!)
    expect(drawn.at(-1)).toBe(plate('primate').tDivergence)
  })
})
