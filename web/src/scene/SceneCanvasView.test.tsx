import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { budgetedDpr, SCENE_DPR_BUDGET_PIXELS } from './canvasBudget'
import { REST_DRIFT } from './drift'
import type { SceneCrop } from './framing'
import { SceneCanvasView } from './SceneCanvasView'

// `<Canvas>` needs WebGL, so a stub exposes the props under test as data attributes.
vi.mock('@react-three/fiber', async () => {
  const actual = await vi.importActual<typeof import('@react-three/fiber')>('@react-three/fiber')
  return {
    ...actual,
    Canvas: (props: { frameloop?: unknown; dpr?: unknown }) => (
      <div data-testid="mock-canvas" data-frameloop={String(props.frameloop)} data-dpr={String(props.dpr)} />
    ),
  }
})

// Image fetches never settle; only the initial Canvas props matter here.
vi.mock('@/lib/fetchImage', () => ({
  fetchImage: () => new Promise<never>(() => {}),
  fetchImageBlob: () => new Promise<never>(() => {}),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const baseProps = {
  baseUrl: 'a.png',
  overlayUrl: 'b.png',
  baseThumbUrl: 'a-thumb.png',
  overlayThumbUrl: 'b-thumb.png',
  decodeUrls: [] as readonly string[],
  fetchUrls: [] as readonly string[],
  thumbUrls: { near: [], all: [] },
  pairFirst: false,
  regime: 'crossfade' as const,
  mix: 0,
  fromDrift: REST_DRIFT,
  toDrift: REST_DRIFT,
  imageAspect: 16 / 9,
  cropByUrl: new Map<string, SceneCrop>(),
}

describe('SceneCanvasView', () => {
  it('renders on demand with the budgeted device pixel ratio', () => {
    vi.stubGlobal('devicePixelRatio', 2)
    vi.stubGlobal('innerWidth', 2560)
    vi.stubGlobal('innerHeight', 1440)
    render(<SceneCanvasView {...baseProps} />)
    const canvas = screen.getByTestId('mock-canvas')
    expect(canvas.dataset.frameloop).toBe('demand')
    expect(Number(canvas.dataset.dpr)).toBeCloseTo(budgetedDpr(2, 2560, 1440, SCENE_DPR_BUDGET_PIXELS))
    expect(Number(canvas.dataset.dpr)).toBeLessThan(2)
  })
})
