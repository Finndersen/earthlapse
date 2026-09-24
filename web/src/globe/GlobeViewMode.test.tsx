import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EFFECT_EVENTS, REGIME_EVENTS } from './effects/fixtures'
import { Globe, type GlobeRasterLayers } from './index'

// The WebGL path, with the renderer itself stubbed: jsdom has no GPU.
vi.mock('@/lib/webgl', () => ({
  probeWebgl: () => ({ supported: true, maxTextureSize: 8192 }),
  supportsWebGL: () => true,
}))

vi.mock('@react-three/fiber', async () => {
  const actual = await vi.importActual<typeof import('@react-three/fiber')>('@react-three/fiber')
  return { ...actual, Canvas: () => <div data-testid="mock-canvas" /> }
})

afterEach(() => {
  cleanup()
})

const rasterLayers: GlobeRasterLayers = {
  paleodem: { id: 'paleodem', frames: [{ t: 0, ref: 'paleodem/000.png' }] },
  neoproterozoic: null,
  basemapT0: null,
  basemapT1: null,
  overlayRasters: new Map(),
}

function renderGlobe(expanded: boolean) {
  return render(
    <Globe
      t={1e8}
      rasterLayers={rasterLayers}
      assetBase="/media"
      regimeEvents={REGIME_EVENTS}
      effectEvents={EFFECT_EVENTS}
      iceAgeLayers={null}
      expanded={expanded}
      onToggleExpand={vi.fn()}
      onCaptionChange={vi.fn()}
      cities={null}
      empires={null}
      sceneLocation={null}
      playbackBaseRate={0.02}
      cityLabelFadeWindowAt={() => 150}
      feedEventIds={new Set()}
      hoveredFeedEventId={null}
    />,
  )
}

describe('Globe/Map view toggle', () => {
  it('is offered only while expanded, as a named group that switches the view mode', () => {
    renderGlobe(false)
    expect(screen.queryByRole('group', { name: 'Globe/Map view' })).toBeNull()
    cleanup()

    const { container } = renderGlobe(true)
    const group = screen.getByRole('group', { name: 'Globe/Map view' })
    const mapModeOf = () => container.querySelector('[data-map-mode]')!.getAttribute('data-map-mode')
    expect(within(group).getByRole('button', { name: 'Globe' }).getAttribute('aria-pressed')).toBe('true')
    expect(mapModeOf()).toBe('false')

    fireEvent.click(within(group).getByRole('button', { name: 'Map' }))
    expect(within(group).getByRole('button', { name: 'Map' }).getAttribute('aria-pressed')).toBe('true')
    expect(mapModeOf()).toBe('true')

    fireEvent.click(within(group).getByRole('button', { name: 'Globe' }))
    expect(mapModeOf()).toBe('false')
  })
})
