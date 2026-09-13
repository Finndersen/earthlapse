import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ShellLayout } from './ShellLayout'

// No global test setup file is configured for this project (see vitest.config.ts), so
// @testing-library/react does not auto-clean between tests — do it explicitly or multiple
// renders in one file collide.
afterEach(() => {
  cleanup()
})

function renderShell() {
  return render(
    <ShellLayout
      globe={<div>GLOBE_SLOT</div>}
      hud={<div>HUD_SLOT</div>}
      ancestor={<div>ANCESTOR_SLOT</div>}
      caption={<div>CAPTION_SLOT</div>}
      scene={<div>SCENE_SLOT</div>}
      timeline={<div>TIMELINE_SLOT</div>}
      chart={<div>CHART_SLOT</div>}
    />,
  )
}

describe('ShellLayout', () => {
  it('renders every slot exactly once', () => {
    renderShell()
    // getByText throws if the text is absent or duplicated, so a successful call is itself
    // the assertion; no @testing-library/jest-dom matcher is installed in this project.
    for (const text of [
      'GLOBE_SLOT',
      'HUD_SLOT',
      'ANCESTOR_SLOT',
      'CAPTION_SLOT',
      'SCENE_SLOT',
      'TIMELINE_SLOT',
      'CHART_SLOT',
    ]) {
      expect(screen.getByText(text).textContent).toBe(text)
    }
  })

  it('always shows the artistic-reconstruction note (VISUAL_SPEC §9)', () => {
    renderShell()
    expect(screen.getByText(/artistic reconstruction/i).textContent).toMatch(/artistic reconstruction/i)
  })

  it('links to the credits page', () => {
    renderShell()
    const link = screen.getByText('Credits')
    expect(link.getAttribute('href')).toBe('/credits')
  })
})
