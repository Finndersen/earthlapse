import { describe, expect, it } from 'vitest'

import type { DriftUniforms } from './drift'
import { REST_DRIFT } from './drift'
import { resolveSceneRender } from './sceneRender'
import type { ScenePair } from './useScenePair'

function texture(name: string): { name: string } {
  return { name }
}

function drift(zoom: number): DriftUniforms {
  return { zoom, dx: 0, dy: 0 }
}

function pair(
  boundFromUrl: string | null,
  boundToUrl: string | null,
  fromTex: unknown,
  toTex: unknown,
): ScenePair {
  return {
    fromTex: fromTex as ScenePair['fromTex'],
    toTex: toTex as ScenePair['toTex'],
    boundFromUrl,
    boundToUrl,
    ready: boundFromUrl !== null,
  }
}

const aTex = texture('a')
const bTex = texture('b')
const fromDrift = drift(1.02)
const toDrift = drift(1.04)
const target = { mix: 0.5, fromDrift, toDrift }

describe('resolveSceneRender', () => {
  const bAlone = (mix: number, d: DriftUniforms) => ({ fromTex: bTex, toTex: bTex, fromUrl: 'b.png', toUrl: 'b.png', mix, fromDrift: d, toDrift: d })

  it('is null before anything has bound', () => {
    expect(resolveSceneRender({ fromUrl: 'a.png', toUrl: 'b.png' }, pair(null, null, null, null), target)).toBeNull()
  })

  it('passes the target through when the bound pair matches the request', () => {
    expect(resolveSceneRender({ fromUrl: 'a.png', toUrl: 'b.png' }, pair('a.png', 'b.png', aTex, bTex), target)).toEqual({
      fromTex: aTex,
      toTex: bTex,
      fromUrl: 'a.png',
      toUrl: 'b.png',
      ...target,
    })
  })

  it.each([
    ['moving on past the bound pair', ['a.png', 'b.png'], ['b.png', 'c.png'], bAlone(0, fromDrift)],
    ['reversing into an unbound pair', ['b.png', 'c.png'], ['a.png', 'b.png'], bAlone(1, toDrift)],
    ['keeping only the bound trailing scene', ['a.png', 'b.png'], ['c.png', 'b.png'], bAlone(1, toDrift)],
    [
      'keeping only the bound leading scene',
      ['a.png', 'b.png'],
      ['a.png', 'c.png'],
      { fromTex: aTex, toTex: aTex, fromUrl: 'a.png', toUrl: 'a.png', mix: 0, fromDrift, toDrift: fromDrift },
    ],
    ['sharing nothing with the bound pair', ['a.png', 'b.png'], ['x.png', 'y.png'], bAlone(0, REST_DRIFT)],
  ] as const)('shows one bound scene alone at its own drift when %s', (_label, [bf, bt], [rf, rt], expected) => {
    const bound = pair(bf, bt, bf === 'a.png' ? aTex : bTex, bt === 'b.png' ? bTex : texture('c'))
    const render = resolveSceneRender({ fromUrl: rf, toUrl: rt }, bound, target)
    expect(render).toEqual(expected)
  })
})
