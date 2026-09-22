import { cleanup, render, screen } from '@testing-library/react'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { budgetedDpr, SCENE_DPR_BUDGET_PIXELS } from './canvasBudget'
import { REST_DRIFT } from './drift'
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

/** Avoids a real (and, under jsdom, always-failing) image decode — mirrors
 *  `textureCache.test.ts`'s own `stubLoader`, minus resolving `onLoad`: nothing here needs the
 *  texture to actually finish loading, only the initial `<Canvas>` props. */
function stubLoader(): void {
  vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(function () {
    return new THREE.Texture<HTMLImageElement>()
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const baseProps = {
  baseUrl: 'a.png',
  overlayUrl: 'b.png',
  preloadUrls: [] as readonly string[],
  mix: 0,
  fromDrift: REST_DRIFT,
  toDrift: REST_DRIFT,
  imageAspect: 16 / 9,
  focusByUrl: new Map<string, readonly [number, number]>(),
}

describe('SceneCanvasView — frameloop', () => {
  it('renders on demand, drawing a frame only when a uniform prop actually changes', () => {
    stubLoader()
    render(<SceneCanvasView {...baseProps} />)
    expect(screen.getByTestId('mock-canvas').dataset.frameloop).toBe('demand')
  })
})

describe('SceneCanvasView — dpr budget (issue: dpr={[1, 2]} has no pixel ceiling)', () => {
  it('passes the full device pixel ratio at an ordinary laptop viewport', () => {
    stubLoader()
    vi.stubGlobal('devicePixelRatio', 2)
    vi.stubGlobal('innerWidth', 1440)
    vi.stubGlobal('innerHeight', 900)
    render(<SceneCanvasView {...baseProps} />)
    const dpr = Number(screen.getByTestId('mock-canvas').dataset.dpr)
    expect(dpr).toBeCloseTo(budgetedDpr(2, 1440, 900, SCENE_DPR_BUDGET_PIXELS), 1)
    expect(dpr).toBeCloseTo(2, 1)
  })

  it('tapers the dpr below the device pixel ratio on a large, dense (5K-class) display', () => {
    stubLoader()
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
    stubLoader()
    vi.stubGlobal('devicePixelRatio', 1)
    vi.stubGlobal('innerWidth', 2560)
    vi.stubGlobal('innerHeight', 1440)
    render(<SceneCanvasView {...baseProps} />)
    expect(Number(screen.getByTestId('mock-canvas').dataset.dpr)).toBeCloseTo(1)
  })
})
