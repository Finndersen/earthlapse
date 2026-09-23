import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createNodeLayer } from '../factories'
import { ANCESTOR_DATA, ANCESTOR_MANIFEST } from '../fixtures'
import { indexPortraits } from '../portraits'
import { PORTRAIT_MANIFEST, PORTRAIT_TREE_DATA } from '../portraitFixtures'
import { AncestorPanel } from './AncestorPanel'

// jsdom has no WebGL context, so a portrait render here takes the crossfade fallback.

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('<AncestorPanel>', () => {
  it('stacks the portrait above the readout under one testid, and keeps the readout without portraits', () => {
    const layer = createNodeLayer(PORTRAIT_MANIFEST, PORTRAIT_TREE_DATA)
    render(<AncestorPanel layer={layer} t={1e4} assetBase="/media" portraits={indexPortraits(PORTRAIT_TREE_DATA)} />)
    const panel = screen.getByTestId('ancestor-readout')
    expect(panel.children[0]).toBe(panel.querySelector('[data-testid="ancestor-portrait"]'))
    expect(panel.textContent).toContain('Homo sapiens')
    cleanup()
    render(<AncestorPanel layer={createNodeLayer(ANCESTOR_MANIFEST, ANCESTOR_DATA)} t={5e7} assetBase="/media" portraits={null} />)
    expect(screen.getByTestId('ancestor-readout').querySelector('[data-testid="ancestor-portrait"]')).toBeNull()
    expect(screen.getByTestId('ancestor-readout').textContent).toContain('First primate')
  })
})
