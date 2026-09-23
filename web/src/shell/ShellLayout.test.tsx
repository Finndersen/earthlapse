import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellLayout } from './ShellLayout'
import styles from './ShellLayout.module.css'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// The credits panel fetches the manifest when opened.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response),
  )
})

function renderShell({
  globeExpanded = false,
  chart = <div>CHART_SLOT</div> as ReactNode,
  viewModeToggleHeightPx = 0,
  feedbackLink = undefined as ReactNode,
} = {}) {
  return render(
    <ShellLayout
      scene={<div>SCENE_SLOT</div>}
      globe={<div>GLOBE_SLOT</div>}
      readouts={<div>READOUTS_SLOT</div>}
      feed={<div>FEED_SLOT</div>}
      title={<div>TITLE_SLOT</div>}
      badge={<div>BADGE_SLOT</div>}
      ancestor={<div>ANCESTOR_SLOT</div>}
      caption={<div>CAPTION_SLOT</div>}
      chart={chart}
      timeline={<div>TIMELINE_SLOT</div>}
      globeExpanded={globeExpanded}
      viewModeToggleHeightPx={viewModeToggleHeightPx}
      feedbackLink={feedbackLink}
    />,
  )
}

describe('ShellLayout', () => {
  it('renders every slot exactly once', () => {
    renderShell()
    // getByText throws when the text is absent or duplicated.
    for (const text of [
      'SCENE_SLOT',
      'GLOBE_SLOT',
      'READOUTS_SLOT',
      'FEED_SLOT',
      'TITLE_SLOT',
      'BADGE_SLOT',
      'ANCESTOR_SLOT',
      'CAPTION_SLOT',
      'CHART_SLOT',
      'TIMELINE_SLOT',
    ]) {
      expect(screen.getByText(text).textContent).toBe(text)
    }
  })

  // The slot anchors the expanded sphere's measured lower bound, so it stays mounted but empty.
  it('keeps the expanded caption slot mounted and empty', () => {
    renderShell({ globeExpanded: true })
    const stageCaption = document.querySelector(`.${styles.expandedGlobeCaption}`)
    expect(stageCaption).not.toBeNull()
    expect(stageCaption?.textContent).toBe('')
  })

  it('never actually has two live regions announcing at once', () => {
    for (const globeExpanded of [false, true]) {
      const { unmount } = renderShell({ globeExpanded })
      const liveWithText = Array.from(document.querySelectorAll('[aria-live]')).filter((el) => el.textContent !== '')
      expect(liveWithText.length).toBeLessThanOrEqual(1)
      unmount()
    }
  })
})

describe('ShellLayout — About & credits panel', () => {
  it('opens the panel on click, leading with the artistic-reconstruction disclosure', () => {
    renderShell()
    expect(screen.getByRole('button', { name: /about & credits/i }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /about & credits/i }))
    expect(screen.getByRole('button', { name: /about & credits/i }).getAttribute('aria-expanded')).toBe('true')
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toMatch(/artistic reconstruction/i)
  })

  it('closes on Escape and returns focus to the button', () => {
    renderShell()
    const button = screen.getByRole('button', { name: /about & credits/i })
    // A real click focuses the button first; jsdom's synthetic click does not.
    button.focus()
    fireEvent.click(button)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(button)
  })
})
