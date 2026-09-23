import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { budgetedDpr, SCENE_DPR_BUDGET_PIXELS } from './canvasBudget'
import { REST_DRIFT } from './drift'
import type { SceneCrop } from './framing'
import { SceneCanvasView } from './SceneCanvasView'

// `<Canvas>` throws under jsdom (no real WebGL context — see `globe/Globe.test.tsx`'s own doc
// comment for why that suite avoids it too), so it's replaced here with a stub that renders none
// of its children but exposes the two props under test (`frameloop`, `dpr`) as `data-*`
// attributes. This exercises the real `SceneCanvasView`/`SceneQuad` prop-threading logic — only
// the WebGL renderer itself is stubbed out. `vi.mock` factories are hoisted above every import
// above (vitest, same as jest), so this still applies before `SceneCanvasView` itself resolves
// its own `@react-three/fiber` import.
vi.mock('@react-three/fiber', async () => {
  const actual = await vi.importActual<typeof import('@react-three/fiber')>('@react-three/fiber')
  return {
    ...actual,
    Canvas: (props: { frameloop?: unknown; dpr?: unknown }) => (
      <div data-testid="mock-canvas" data-frameloop={String(props.frameloop)} data-dpr={String(props.dpr)} />
    ),
  }
})

// Nothing here needs a texture to finish loading, only the initial `<Canvas>` props, so the
// image fetch never settles rather than reaching the network.
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
  decodeUrls: [] as readonly string[],
  fetchUrls: [] as readonly string[],
  mix: 0,
  fromDrift: REST_DRIFT,
  toDrift: REST_DRIFT,
  imageAspect: 16 / 9,
  cropByUrl: new Map<string, SceneCrop>(),
}

describe('SceneCanvasView — frameloop', () => {
  it('renders on demand, drawing a frame only when a uniform prop actually changes', () => {
    render(<SceneCanvasView {...baseProps} />)
    expect(screen.getByTestId('mock-canvas').dataset.frameloop).toBe('demand')
  })
})

describe('SceneCanvasView — dpr budget (issue: dpr={[1, 2]} has no pixel ceiling)', () => {
  it('passes the full device pixel ratio at an ordinary laptop viewport', () => {
    vi.stubGlobal('devicePixelRatio', 2)
    vi.stubGlobal('innerWidth', 1440)
    vi.stubGlobal('innerHeight', 900)
    render(<SceneCanvasView {...baseProps} />)
    const dpr = Number(screen.getByTestId('mock-canvas').dataset.dpr)
    expect(dpr).toBeCloseTo(budgetedDpr(2, 1440, 900, SCENE_DPR_BUDGET_PIXELS), 1)
    expect(dpr).toBeCloseTo(2, 1)
  })

  it('tapers the dpr below the device pixel ratio on a large, dense (5K-class) display', () => {
    vi.stubGlobal('devicePixelRatio', 2)
    vi.stubGlobal('innerWidth', 2560)
    vi.stubGlobal('innerHeight', 1440)
    render(<SceneCanvasView {...baseProps} />)
    const dpr = Number(screen.getByTestId('mock-canvas').dataset.dpr)
    expect(dpr).toBeCloseTo(budgetedDpr(2, 2560, 1440, SCENE_DPR_BUDGET_PIXELS))
    expect(dpr).toBeLessThan(2)
    expect(dpr).toBeGreaterThan(1)
  })

  it('never upscales past 1 on a non-retina display', () => {
    vi.stubGlobal('devicePixelRatio', 1)
    vi.stubGlobal('innerWidth', 2560)
    vi.stubGlobal('innerHeight', 1440)
    render(<SceneCanvasView {...baseProps} />)
    expect(Number(screen.getByTestId('mock-canvas').dataset.dpr)).toBeCloseTo(1)
  })
})
