import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Scene } from '@/types/manifest'

import { crossfadeAlpha } from './transition'
import { SceneView } from './SceneView'

// jsdom has no WebGL context, so `supportsWebGL()` is false throughout this suite and every
// render below exercises `SceneFallbackView`, via the shared `SceneView` dispatcher.

// jsdom does not implement requestAnimationFrame; `usePresentedSceneMix` only needs it when a
// render moves the target away from what's already presented (a single `render()` call starts
// presented exactly at target — presentation.ts's "no animation on mount" — so most tests here
// never touch this at all).
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    return setTimeout(() => cb(performance.now()), 16) as unknown as number
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function scene(id: string, t: number): Scene {
  return {
    id,
    t,
    chapterId: 'ch',
    image: `${id}.png`,
    thumbnail: `${id}-thumb.png`,
    shot: 'WIDE_RIDGE',
    title: `title ${id}`,
    caption: `caption ${id}`,
    width: 1920,
    height: 1080,
  }
}

const s0 = scene('s0', 0)
const s1 = scene('s1', 100)
const s2 = scene('s2', 400)
const s3 = scene('s3', 1e6)
const scenes: Scene[] = [s0, s1, s2, s3]

// p=0.5 of log1p(0)..log1p(100) -> mix 0.5, independent of DISSOLVE_WIDTH (the smoothstep
// window is symmetric around the midpoint regardless of its width).
const midT = Math.expm1(0.5 * Math.log1p(100))

/** Inverts sceneAt's log1p interpolation to pick a `t` landing at a known `p` in [a, b]. */
function tAtP(a: number, b: number, p: number): number {
  return Math.expm1(Math.log1p(a) + (Math.log1p(b) - Math.log1p(a)) * p)
}

describe('SceneView', () => {
  it('draws the base layer at full opacity regardless of mix, and the overlay at the eased crossfade alpha', () => {
    render(<SceneView t={midT} scenes={scenes} assetBase="https://cdn.example.com/build" />)
    const base = screen.getByTestId('scene-base') as HTMLImageElement
    const overlay = screen.getByTestId('scene-overlay') as HTMLImageElement
    expect(base.style.opacity).toBe('1')
    expect(Number(overlay.style.opacity)).toBeCloseTo(crossfadeAlpha(0.5))
  })

  it('draws the base layer at full opacity even when mix is 0 (never fades both to nothing)', () => {
    render(<SceneView t={s0.t} scenes={scenes} assetBase="https://cdn.example.com/build" />)
    const base = screen.getByTestId('scene-base') as HTMLImageElement
    const overlay = screen.getByTestId('scene-overlay') as HTMLImageElement
    expect(base.style.opacity).toBe('1')
    expect(overlay.style.opacity).toBe('0')
  })

  it('renders the same scene when covered, which only lowers the rate the pair is recomputed at', () => {
    render(<SceneView t={s0.t} scenes={scenes} assetBase="https://cdn.example.com/build" covered />)
    const base = screen.getByTestId('scene-base') as HTMLImageElement
    expect(base.style.opacity).toBe('1')
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

  it('mounts with the presentation already settled at the target — no animation on the first frame', () => {
    // Landing exactly mid-dissolve on mount must show that mix immediately, not ease in from
    // scratch (presentation.ts: "the first presented state equals the target").
    const t = tAtP(s0.t, s1.t, 0.5)
    render(<SceneView t={t} scenes={scenes} assetBase="https://cdn.example.com/build" />)
    const overlay = screen.getByTestId('scene-overlay') as HTMLImageElement
    expect(Number(overlay.style.opacity)).toBeCloseTo(crossfadeAlpha(0.5))
  })

  it(
    'does not jump instantly to a scene several gaps away — it keeps showing the previous pair immediately after t moves, and only catches up over subsequent frames',
    async () => {
      // `alt` reflects the presented caption directly (unlike `src`, which `SceneFallbackView`
      // only swaps once the browser has decoded the image — see its `useDecodedSrc` — and
      // jsdom never fires that decode; this is the same reason Experience.test.tsx asserts on
      // `alt`, not `src`, for the same kind of check).
      const { rerender } = render(<SceneView t={s0.t} scenes={scenes} assetBase="https://cdn.example.com/build" />)
      expect((screen.getByTestId('scene-base') as HTMLImageElement).alt).toBe('caption s0')

      act(() => {
        rerender(<SceneView t={s3.t} scenes={scenes} assetBase="https://cdn.example.com/build" />)
      })

      // No wall-clock time has passed yet — still showing s0, not s3.
      expect((screen.getByTestId('scene-base') as HTMLImageElement).alt).toBe('caption s0')

      // It does eventually reach s3, once the minimum transition duration has had time to
      // play — settling alone on s3 (an exact scene `t`), so both layers show it and the
      // overlay's crossfade alpha returns to 0, same as the mount-time "alone" case above.
      await waitFor(
        () => {
          expect((screen.getByTestId('scene-base') as HTMLImageElement).alt).toBe('caption s3')
          expect((screen.getByTestId('scene-overlay') as HTMLImageElement).alt).toBe('caption s3')
          expect(screen.getByTestId('scene-base').style.opacity).toBe('1')
          expect(screen.getByTestId('scene-overlay').style.opacity).toBe('0')
        },
        { timeout: 3000, interval: 50 },
      )
    },
    10000,
  )

  it(
    'regime="cut" (ADR-029) switches to a distant scene on the next rendered frame, not over several seconds',
    async () => {
      const { rerender } = render(<SceneView t={s0.t} scenes={scenes} assetBase="https://cdn.example.com/build" regime="cut" />)
      expect((screen.getByTestId('scene-base') as HTMLImageElement).alt).toBe('caption s0')

      act(() => {
        rerender(<SceneView t={s3.t} scenes={scenes} assetBase="https://cdn.example.com/build" regime="cut" />)
      })

      // One stubbed rAF tick (16ms) away, not the multi-second `MIN_TRANSITION_SECONDS` catch-up
      // the crossfade case immediately above needs — a tight timeout is the point of this test.
      await waitFor(
        () => {
          expect((screen.getByTestId('scene-base') as HTMLImageElement).alt).toBe('caption s3')
          expect((screen.getByTestId('scene-overlay') as HTMLImageElement).alt).toBe('caption s3')
          expect(screen.getByTestId('scene-base').style.opacity).toBe('1')
          expect(screen.getByTestId('scene-overlay').style.opacity).toBe('0')
        },
        { timeout: 200, interval: 10 },
      )
    },
    2000,
  )
})
