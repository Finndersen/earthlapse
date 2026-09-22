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
  it('returns null before any pair has ever bound (the first-load case)', () => {
    const notReady = pair(null, null, null, null)
    expect(resolveSceneRender({ fromUrl: 'a.png', toUrl: 'b.png' }, notReady, target)).toBeNull()
  })

  it('passes target through unchanged when the bound pair exactly matches what is requested', () => {
    const bound = pair('a.png', 'b.png', aTex, bTex)
    const render = resolveSceneRender({ fromUrl: 'a.png', toUrl: 'b.png' }, bound, target)
    expect(render).toEqual({ fromTex: aTex, toTex: bTex, fromUrl: 'a.png', toUrl: 'b.png', mix: 0.5, fromDrift, toDrift })
  })

  it(
    'forward: renders the bound pair\'s trailing scene alone, at its own drift, when the ' +
      "requested pair has moved on to (that scene, something not yet loaded) — e.g. bound " +
      '(a, b), requested (b, c) mid-playback with c still loading',
    () => {
      const bound = pair('a.png', 'b.png', aTex, bTex)
      const render = resolveSceneRender({ fromUrl: 'b.png', toUrl: 'c.png' }, bound, target)
      // b alone, mix pinned to 0 (pixel-exact per shaders.ts), drift is target.fromDrift.
      expect(render).toEqual({ fromTex: bTex, toTex: bTex, fromUrl: 'b.png', toUrl: 'b.png', mix: 0, fromDrift, toDrift: fromDrift })
    },
  )

  it(
    'backward: renders the bound pair\'s leading scene alone, at its own drift, when a scrub ' +
      'reverses into a pair not yet bound — e.g. bound (b, c), requested (a, b) with a not ' +
      'yet loaded',
    () => {
      const bound = pair('b.png', 'c.png', bTex, texture('c'))
      const render = resolveSceneRender({ fromUrl: 'a.png', toUrl: 'b.png' }, bound, target)
      // b alone, mix pinned to 1, drift is target.toDrift.
      expect(render).toEqual({ fromTex: bTex, toTex: bTex, fromUrl: 'b.png', toUrl: 'b.png', mix: 1, fromDrift: toDrift, toDrift })
    },
  )

  it(
    "bound `from` survives: renders it alone, at its own drift, when the requested pair has " +
      'kept the bound leading scene but replaced the trailing one outright — e.g. bound ' +
      '(a, b), requested (a, c) via step()\'s direct-transition branch (a big jump landing on ' +
      'a settled on-screen scene unrelated to the old target, c still loading)',
    () => {
      const bound = pair('a.png', 'b.png', aTex, bTex)
      const render = resolveSceneRender({ fromUrl: 'a.png', toUrl: 'c.png' }, bound, target)
      // a alone, mix pinned to 0, drift is target.fromDrift.
      expect(render).toEqual({ fromTex: aTex, toTex: aTex, fromUrl: 'a.png', toUrl: 'a.png', mix: 0, fromDrift, toDrift: fromDrift })
    },
  )

  it(
    "bound `to` survives: renders it alone, at its own drift, when the requested pair has " +
      'kept the bound trailing scene but replaced the leading one outright — bound (a, b), ' +
      "requested (c, b): two successive direct-transition jumps in step(), first onto an " +
      'unrelated scene c and then back onto b, while (a, b) is still the bound pair',
    () => {
      const bound = pair('a.png', 'b.png', aTex, bTex)
      const render = resolveSceneRender({ fromUrl: 'c.png', toUrl: 'b.png' }, bound, target)
      // b alone, mix pinned to 1, drift is target.toDrift.
      expect(render).toEqual({ fromTex: bTex, toTex: bTex, fromUrl: 'b.png', toUrl: 'b.png', mix: 1, fromDrift: toDrift, toDrift })
    },
  )

  it('freezes at the bound pair, at rest, when the requested pair shares no scene with it at all', () => {
    const bound = pair('a.png', 'b.png', aTex, bTex)
    const render = resolveSceneRender({ fromUrl: 'x.png', toUrl: 'y.png' }, bound, target)
    expect(render).toEqual({
      fromTex: bTex,
      toTex: bTex,
      fromUrl: 'b.png',
      toUrl: 'b.png',
      mix: 0,
      fromDrift: REST_DRIFT,
      toDrift: REST_DRIFT,
    })
  })
})
