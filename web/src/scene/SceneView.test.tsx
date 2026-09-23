import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Scene } from '@/types/manifest'

import { crossfadeAlpha } from './transition'
import { SceneView } from './SceneView'

// jsdom has no WebGL, so these exercise SceneFallbackView through the SceneView dispatcher.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'performance', 'Date'] })
  vi.stubGlobal('fetch', vi.fn(() => new Promise<never>(() => {})))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function scene(id: string, t: number): Scene {
  return { id, t, chapterId: 'ch', image: `${id}.png`, thumbnail: `${id}-t.png`, shot: 'WIDE_RIDGE', title: `title ${id}`, caption: `caption ${id}`, width: 1920, height: 1080 }
}

const s0 = scene('s0', 0)
const s1 = scene('s1', 100)
const s3 = scene('s3', 1e6)
const scenes: Scene[] = [s0, s1, scene('s2', 400), s3]
const BASE = 'https://cdn.example.com/build'
// Mix 0.5 between s0 and s1.
const midT = Math.expm1(0.5 * Math.log1p(100))

const base = () => screen.getByTestId('scene-base') as HTMLImageElement
const overlay = () => screen.getByTestId('scene-overlay') as HTMLImageElement

function expectSettledOn(s: Scene): void {
  expect(base().alt).toBe(s.caption)
  expect(overlay().alt).toBe(s.caption)
  expect(base().style.opacity).toBe('1')
  expect(overlay().style.opacity).toBe('0')
}

describe('SceneView', () => {
  it('keeps the base layer opaque and draws the overlay at the eased crossfade alpha from the first frame', () => {
    render(<SceneView t={midT} scenes={scenes} assetBase={BASE} />)
    expect(base().style.opacity).toBe('1')
    expect(Number(overlay().style.opacity)).toBeCloseTo(crossfadeAlpha(0.5))
    cleanup()
    render(<SceneView t={s0.t} scenes={scenes} assetBase={BASE} />)
    expectSettledOn(s0)
    expect(base().src).toBe(`${BASE}/s0.png`)
  })

  it('renders the caption for the dominant scene at its crossfade opacity', () => {
    render(<SceneView t={s0.t} scenes={scenes} assetBase={BASE} renderCaption={(sc, opacity) => <p>{`${sc.caption} @ ${opacity}`}</p>} />)
    expect(screen.getByText('caption s0 @ 1')).toBeTruthy()
  })

  it('follows a distant t change over several frames rather than jumping', () => {
    const { rerender } = render(<SceneView t={s0.t} scenes={scenes} assetBase={BASE} />)
    act(() => rerender(<SceneView t={s3.t} scenes={scenes} assetBase={BASE} />))
    advance(200)
    expect(base().alt).toBe('caption s0')
    advance(3000)
    expectSettledOn(s3)
  })

  it('cuts to a distant scene within a few frames in the cut regime', () => {
    const { rerender } = render(<SceneView t={s0.t} scenes={scenes} assetBase={BASE} regime="cut" />)
    act(() => rerender(<SceneView t={s3.t} scenes={scenes} assetBase={BASE} regime="cut" />))
    advance(50)
    expectSettledOn(s3)
  })

  it("crops each layer around its own scene's focus on a portrait box", () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 390, height: 844 } as DOMRect)
    const still = { width: 2752, height: 1536 }
    const framed: Scene = { ...s0, ...still, framing: { focus: [0.05, 0.5], pan: 0 } }
    render(<SceneView t={midT} scenes={[framed, { ...s1, ...still }, s3]} assetBase={BASE} />)
    expect(base().style.objectPosition).toBe('0% 50%')
    expect(overlay().style.objectPosition).toBe('50% 50%')
  })
})
