import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { Scene } from '@/types/manifest'

import { SceneView } from './SceneView'

afterEach(cleanup)

// jsdom has no WebGL context, so `supportsWebGL()` is false throughout this suite and every
// render below exercises `SceneFallbackView` — the same testids and opacity contract as
// before, now driven through the shared `SceneView` dispatcher.

function scene(id: string, t: number): Scene {
  return {
    id,
    t,
    chapterId: 'ch',
    image: `${id}.png`,
    shot: 'WIDE_RIDGE',
    caption: `caption ${id}`,
    width: 1920,
    height: 1080,
  }
}

const s0 = scene('s0', 0)
const s1 = scene('s1', 100)
const s2 = scene('s2', 400)
const scenes: Scene[] = [s0, s1, s2]

// p=0.5 of log1p(0)..log1p(100) -> mix 0.5, independent of DISSOLVE_WIDTH (the smoothstep
// window is symmetric around the midpoint regardless of its width).
const midT = Math.expm1(0.5 * Math.log1p(100))

/** Inverts sceneAt's log1p interpolation to pick a `t` landing at a known `p` in [a, b]. */
function tAtP(a: number, b: number, p: number): number {
  return Math.expm1(Math.log1p(a) + (Math.log1p(b) - Math.log1p(a)) * p)
}

describe('SceneView', () => {
  it('draws the base layer at full opacity regardless of mix, and the overlay at mix', () => {
    render(<SceneView t={midT} scenes={scenes} assetBase="https://cdn.example.com/build" />)
    const base = screen.getByTestId('scene-base') as HTMLImageElement
    const overlay = screen.getByTestId('scene-overlay') as HTMLImageElement
    expect(base.style.opacity).toBe('1')
    expect(Number(overlay.style.opacity)).toBeCloseTo(0.5)
  })

  it('draws the base layer at full opacity even when mix is 0 (never fades both to nothing)', () => {
    render(<SceneView t={s0.t} scenes={scenes} assetBase="https://cdn.example.com/build" />)
    const base = screen.getByTestId('scene-base') as HTMLImageElement
    const overlay = screen.getByTestId('scene-overlay') as HTMLImageElement
    expect(base.style.opacity).toBe('1')
    expect(overlay.style.opacity).toBe('0')
  })

  it('resolves image src against assetBase', () => {
    render(<SceneView t={s0.t} scenes={scenes} assetBase="https://cdn.example.com/build" />)
    const base = screen.getByTestId('scene-base') as HTMLImageElement
    expect(base.src).toBe('https://cdn.example.com/build/s0.png')
  })

  it('calls renderCaption with the dominant scene and its cross-fade opacity, and renders its result', () => {
    render(
      <SceneView
        t={s0.t}
        scenes={scenes}
        assetBase="https://cdn.example.com/build"
        renderCaption={(scene, opacity) => (
          <p>
            caption: {scene.caption} @ {opacity}
          </p>
        )}
      />,
    )
    // mix is 0 at an exact scene t, so captionOpacity(0) === 1.
    expect(screen.getByText('caption: caption s0 @ 1')).toBeTruthy()
  })

  it('fades the caption toward 0 as mix approaches the dissolve midpoint, in sync with the image dissolve', () => {
    const opacities: number[] = []
    render(
      <SceneView
        t={tAtP(s0.t, s1.t, 0.5)}
        scenes={scenes}
        assetBase="https://cdn.example.com/build"
        renderCaption={(_scene, opacity) => {
          opacities.push(opacity)
          return null
        }}
      />,
    )
    expect(opacities[0]).toBeCloseTo(0)
  })

  it('never renders a stale base under a collapsed overlay when scrubbing across a scene boundary', () => {
    // Just below s1.t: mix is near 1 (well past the narrow dissolve band, overlay ~ full).
    const justBefore = tAtP(s0.t, s1.t, 0.99)
    const { rerender } = render(<SceneView t={justBefore} scenes={scenes} assetBase="https://cdn.example.com/build" />)
    // Warm the shared decode cache the same way real scrubbing would: the overlay (s1) has
    // now been displayed, so it is a known-decoded URL by the time we cross past it.
    expect((screen.getByTestId('scene-overlay') as HTMLImageElement).src).toContain('s1.png')

    // Just above s1.t: mix resets near 0 for the next pair (s1, s2), so the overlay's opacity
    // collapses in this same render. The base must have already become s1, not still be s0 —
    // otherwise the composite reads as "back to s0" for a frame.
    const justAfter = tAtP(s1.t, s2.t, 0.01)
    rerender(<SceneView t={justAfter} scenes={scenes} assetBase="https://cdn.example.com/build" />)

    const base = screen.getByTestId('scene-base') as HTMLImageElement
    const overlay = screen.getByTestId('scene-overlay') as HTMLImageElement
    expect(base.src).toContain('s1.png')
    expect(base.style.opacity).toBe('1')
    expect(Number(overlay.style.opacity)).toBeLessThan(0.5)
  })
})
