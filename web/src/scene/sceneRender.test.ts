import { describe, expect, it } from 'vitest'

import type { DriftUniforms } from './drift'
import { REST_DRIFT } from './drift'
import { resolveSceneRender } from './sceneRender'
import type { BoundSceneLayer, ScenePair } from './useScenePair'

function layer(url: string): BoundSceneLayer {
  return { url, full: { name: url } as unknown as BoundSceneLayer['full'], thumb: null }
}

function drift(zoom: number): DriftUniforms {
  return { zoom, dx: 0, dy: 0 }
}

function pair(from: string | null, to: string | null): ScenePair {
  return { from: from === null ? null : layer(from), to: to === null ? null : layer(to), ready: from !== null }
}

const fromDrift = drift(1.02)
const toDrift = drift(1.04)
const target = { mix: 0.5, fromDrift, toDrift }

describe('resolveSceneRender', () => {
  const alone = (url: string, mix: number, d: DriftUniforms) => ({ from: layer(url), to: layer(url), mix, fromDrift: d, toDrift: d })

  it('is null before anything has bound', () => {
    expect(resolveSceneRender({ fromUrl: 'a.png', toUrl: 'b.png' }, pair(null, null), target)).toBeNull()
  })

  it('passes the target through when the bound pair matches the request', () => {
    expect(resolveSceneRender({ fromUrl: 'a.png', toUrl: 'b.png' }, pair('a.png', 'b.png'), target)).toEqual({
      from: layer('a.png'),
      to: layer('b.png'),
      ...target,
    })
  })

  it.each([
    ['moving on past the bound pair', ['a.png', 'b.png'], ['b.png', 'c.png'], alone('b.png', 0, fromDrift)],
    ['reversing into an unbound pair', ['b.png', 'c.png'], ['a.png', 'b.png'], alone('b.png', 1, toDrift)],
    ['keeping only the bound trailing scene', ['a.png', 'b.png'], ['c.png', 'b.png'], alone('b.png', 1, toDrift)],
    ['keeping only the bound leading scene', ['a.png', 'b.png'], ['a.png', 'c.png'], alone('a.png', 0, fromDrift)],
    ['sharing nothing with the bound pair', ['a.png', 'b.png'], ['x.png', 'y.png'], alone('b.png', 0, REST_DRIFT)],
  ] as const)('shows one bound scene alone at its own drift when %s', (_label, [bf, bt], [rf, rt], expected) => {
    expect(resolveSceneRender({ fromUrl: rf, toUrl: rt }, pair(bf, bt), target)).toEqual(expected)
  })
})
