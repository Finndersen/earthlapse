import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createNodeLayer } from '../factories'
import { ANCESTOR_DATA, ANCESTOR_MANIFEST } from '../fixtures'
import { indexPortraits } from '../portraits'
import { PORTRAIT_MANIFEST, PORTRAIT_TREE_DATA } from '../portraitFixtures'
import { AncestorPortrait } from './AncestorPortrait'

// jsdom has no WebGL context, so every render here takes the crossfade fallback: two <img>s,
// the older plate at full opacity and the younger over it at the eased alpha.

const layer = createNodeLayer(PORTRAIT_MANIFEST, PORTRAIT_TREE_DATA)
const portraits = indexPortraits(PORTRAIT_TREE_DATA)

function images(container: HTMLElement) {
  const older = container.querySelector<HTMLImageElement>('[data-testid="portrait-older"]')
  const younger = container.querySelector<HTMLImageElement>('[data-testid="portrait-younger"]')
  if (older === null || younger === null) throw new Error('portrait images not rendered')
  return { older, younger }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'performance', 'Date'] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('<AncestorPortrait>', () => {
  it('renders nothing without portraits or before the oldest plate', () => {
    const plain = render(<AncestorPortrait layer={createNodeLayer(ANCESTOR_MANIFEST, ANCESTOR_DATA)} t={5e7} assetBase="/media" portraits={null} />)
    expect(plain.container.innerHTML).toBe('')
    cleanup()
    expect(render(<AncestorPortrait layer={layer} t={4.4e9} assetBase="/media" portraits={portraits} />).container.innerHTML).toBe('')
  })

  it('crossfades the two plates of a morph band as a decorative figure', () => {
    const { container, getByTestId } = render(<AncestorPortrait layer={layer} t={6.6e7} assetBase="/media" portraits={portraits} />)
    const { older, younger } = images(container)
    expect(older.getAttribute('src')).toBe('/media/portraits/tetrapod.png')
    expect(younger.getAttribute('src')).toBe('/media/portraits/primate.png')
    expect(older.style.opacity).toBe('1')
    expect(Number(younger.style.opacity)).toBeCloseTo(0.5)
    expect(getByTestId('ancestor-portrait').getAttribute('aria-hidden')).toBe('true')
  })

  it('rate-limits a jump across a boundary to a visible transition before settling', () => {
    const { container, rerender } = render(<AncestorPortrait layer={layer} t={1e8} assetBase="/media" portraits={portraits} />)
    act(() => rerender(<AncestorPortrait layer={layer} t={1e6} assetBase="/media" portraits={portraits} />))
    act(() => {
      vi.advanceTimersByTime(250)
    })
    const opacity = Number(images(container).younger.style.opacity)
    expect(opacity).toBeGreaterThan(0)
    expect(opacity).toBeLessThan(1)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(images(container).older.getAttribute('src')).toBe('/media/portraits/primate.png')
  })
})
