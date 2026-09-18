import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ROOT_SECTION_ID, type SectionId } from '@/timeline'

import { ShellLayout } from './ShellLayout'
import styles from './ShellLayout.module.css'

// No global test setup file is configured for this project (see vitest.config.ts), so
// @testing-library/react does not auto-clean between tests — do it explicitly or multiple
// renders in one file collide.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// The About & credits panel loads the manifest itself (`CreditsList`) once opened; stub `fetch`
// so opening it in a test never makes a real network request. The exact credits content is
// `CreditsList.test.tsx`'s concern — these tests only need the panel's own chrome to render.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response),
  )
})

function renderShell({
  globeExpanded = false,
  chart = <div>CHART_SLOT</div> as ReactNode,
  globeCaption = '',
  sectionId = ROOT_SECTION_ID as SectionId,
  onSelectSection = vi.fn<(id: SectionId) => void>(),
} = {}) {
  return render(
    <ShellLayout
      scene={<div>SCENE_SLOT</div>}
      globe={<div>GLOBE_SLOT</div>}
      globeCaption={globeCaption}
      readouts={<div>READOUTS_SLOT</div>}
      feed={<div>FEED_SLOT</div>}
      title={<div>TITLE_SLOT</div>}
      badge={<div>BADGE_SLOT</div>}
      sectionId={sectionId}
      onSelectSection={onSelectSection}
      ancestor={<div>ANCESTOR_SLOT</div>}
      caption={<div>CAPTION_SLOT</div>}
      chart={chart}
      timeline={<div>TIMELINE_SLOT</div>}
      globeExpanded={globeExpanded}
    />,
  )
}

describe('ShellLayout', () => {
  it('renders every slot exactly once', () => {
    renderShell()
    // getByText throws if the text is absent or duplicated, so a successful call is itself
    // the assertion; no @testing-library/jest-dom matcher is installed in this project.
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

  it.each([
    [<div key="chart">CHART_SLOT</div>, 'true'],
    [null, 'false'],
  ])('exposes whether a chart is open, so the caption can yield its place (chart %#)', (chart, expected) => {
    const { container } = renderShell({ chart })
    expect((container.firstElementChild as HTMLElement).dataset.chartOpen).toBe(expected)
  })

  it.each([true, false])('exposes globeExpanded=%s on the root', (globeExpanded) => {
    const { container } = renderShell({ globeExpanded })
    expect((container.firstElementChild as HTMLElement).dataset.globeExpanded).toBe(String(globeExpanded))
  })

  it('labels the globe orb "Paleogeography" with no caption active', () => {
    renderShell()
    const label = screen.getByText('GLOBE_SLOT').closest(`.${styles.globe}`)?.querySelector(`.${styles.globeLabel}`)
    expect(label?.textContent).toBe('Paleogeography')
  })

  it("replaces the orb's label with the globe's own caption when one is active, never overlapping the orb's own picture (regression: no label on top of the globe)", () => {
    renderShell({ globeCaption: 'Snowball Earth · extent contested' })
    const orb = screen.getByText('GLOBE_SLOT').closest(`.${styles.orb}`)
    const label = screen.getByText('GLOBE_SLOT').closest(`.${styles.globe}`)?.querySelector(`.${styles.globeLabel}`)
    expect(label?.textContent).toBe('Snowball Earth · extent contested')
    expect(orb?.contains(label ?? null)).toBe(false)
    expect(screen.getByText('GLOBE_SLOT').closest(`.${styles.globe}`)?.textContent).not.toContain('Paleogeography')
  })

  it("also shows the globe caption in the expanded stage slot — above the timeline, where Globe's own backdrop can't safely place it itself", () => {
    renderShell({ globeCaption: 'Impact winter', globeExpanded: true })
    const stageCaption = document.querySelector(`.${styles.expandedGlobeCaption}`)
    expect(stageCaption?.textContent).toBe('Impact winter')
    // Not inside the .stage's scene-caption slot (which yields to it while the globe is
    // expanded) or inside the orb itself.
    const sceneCaptionSlot = screen.getByText('CAPTION_SLOT').closest(`.${styles.caption}`)
    expect(sceneCaptionSlot?.contains(stageCaption ?? null)).toBe(false)
    const orb = screen.getByText('GLOBE_SLOT').closest(`.${styles.orb}`)
    expect(orb?.contains(stageCaption ?? null)).toBe(false)
  })

  it.each([
    [false, 'polite', null],
    [true, null, 'polite'],
  ])('announces the globe caption from exactly one live region (globeExpanded=%s)', (globeExpanded, orbLive, stageLive) => {
    renderShell({ globeCaption: 'Impact winter', globeExpanded })
    const orbLabel = document.querySelector(`.${styles.globeLabel}`)
    const stageCaption = document.querySelector(`.${styles.expandedGlobeCaption}`)
    expect(orbLabel?.getAttribute('aria-live')).toBe(orbLive)
    expect(stageCaption?.getAttribute('aria-live')).toBe(stageLive)
    expect(document.querySelectorAll('[aria-live]').length).toBe(1)
  })

  it('renders nothing in the expanded stage slot with no globe caption active', () => {
    renderShell({ globeExpanded: true })
    const stageCaption = document.querySelector(`.${styles.expandedGlobeCaption}`)
    expect(stageCaption?.textContent).toBe('')
  })
})

// About & credits (VISUAL_SPEC §9, ADR-012 amendment, follow-up item 5): the artistic-
// reconstruction disclosure and the credits list live in an in-experience panel, opened from a
// small top-left corner button, instead of the old always-on footer row and `/credits`
// navigation. No idle-fade of any kind is involved (follow-up item 8) — opening/closing is a
// direct click/Escape/outside-click, never on a timer.
describe('ShellLayout — About & credits panel', () => {
  it('shows a small "About & credits" button and no dialog before it is opened', () => {
    renderShell()
    const button = screen.getByRole('button', { name: /about & credits/i })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the panel on click, leading with the artistic-reconstruction disclosure', () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /about & credits/i }))
    expect(screen.getByRole('button', { name: /about & credits/i }).getAttribute('aria-expanded')).toBe('true')
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toMatch(/artistic reconstruction/i)
  })

  it('closes on Escape and returns focus to the button (no route change, no route navigated to)', () => {
    renderShell()
    const button = screen.getByRole('button', { name: /about & credits/i })
    // A real click focuses the button before the handler runs (native button activation
    // behaviour); `fireEvent.click` alone doesn't simulate that in jsdom, so focus it first —
    // `Panel` captures whatever has focus at mount and restores it on unmount.
    button.focus()
    fireEvent.click(button)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('places the button in the top-left globe column, not colliding with the ancestor corner', () => {
    renderShell()
    const button = screen.getByRole('button', { name: /about & credits/i })
    expect(button.closest(`.${styles.globe}`)).not.toBeNull()
    expect(button.closest(`.${styles.ancestor}`)).toBeNull()
  })
})

// jsdom applies no layout or media queries, so a rendered assertion can't see which grid area
// or breakpoint rule wins — these read the module's own source instead. Regression coverage
// for the "ancestor sits centred mid-screen on a phone, hiding the scene" bug: the phone rule
// used to give `.ancestor` its own full-width row (`'ancestor ancestor ancestor'`) with
// `justify-self: center`, rather than sharing row 1 with the globe orb and title the way the
// desktop layout already does.
describe('ShellLayout phone ancestor placement (max-width: 760px)', () => {
  const css = readFileSync(path.join(import.meta.dirname, 'ShellLayout.module.css'), 'utf-8')
  const phoneQueryIndex = css.indexOf('@media (max-width: 760px)')
  const phoneBlock = css.slice(phoneQueryIndex, css.indexOf('@media', phoneQueryIndex + 1))

  it('is present in the stylesheet', () => {
    expect(phoneQueryIndex).toBeGreaterThan(-1)
  })

  it('puts the ancestor panel in row 1 beside the globe and title, not its own full-width row', () => {
    const areasMatch = phoneBlock.match(/grid-template-areas:\s*([\s\S]*?);/)
    expect(areasMatch).not.toBeNull()
    const rows = areasMatch![1]!.match(/'[^']*'/g)!.map((row) => row.slice(1, -1).trim())
    expect(rows[0]!.split(/\s+/)).toEqual(['globe', 'title', 'ancestor'])
    expect(rows).not.toContain('ancestor ancestor ancestor')
  })

  it('right-aligns the ancestor corner (mirroring the globe orb top-left) instead of centring it', () => {
    const ancestorRule = phoneBlock.match(/(?<![\w.])\.ancestor\s*\{([^}]*)\}/)
    expect(ancestorRule).not.toBeNull()
    expect(ancestorRule![1]!).toMatch(/justify-self:\s*end/)
    expect(ancestorRule![1]!).not.toMatch(/justify-self:\s*center/)
  })

  // Regression coverage for a follow-up QA pass on the fix above: a long lineage label (e.g.
  // "Homo heidelbergensis / LCA with Neanderthals") spilled out of the corner because the
  // panel's own width was never capped, so its `max-width: 100%` / ellipsis rules (hud.
  // module.css) had nothing to measure against. jsdom applies no layout, so this can only check
  // that the capping rule is present in source, not that text actually elides at a given
  // width — that needs a real browser (Playwright rect check, run ad hoc; not part of this
  // repo's committed toolchain).
  it("caps the ancestor readout panel's own width to the corner, not just its text", () => {
    const panelRule = phoneBlock.match(/\.ancestor\s*>\s*\[data-testid=(['"])ancestor-readout\1\]\s*\{([^}]*)\}/)
    expect(panelRule).not.toBeNull()
    expect(panelRule![2]!).toMatch(/max-width:\s*100%/)
    expect(panelRule![2]!).toMatch(/min-width:\s*0/)
  })

  // Regression coverage for the row-height jump between "no ancestor yet" (before the lineage
  // starts, `<AncestorPortrait>` renders nothing) and "portrait present": row 1 used to grow by
  // the portrait's full height the moment one first appeared, pushing the readouts/feed rows
  // below it down.
  it('holds the ancestor corner at a fixed height so the readouts below it never jump when a portrait first appears', () => {
    const ancestorRule = phoneBlock.match(/(?<![\w.])\.ancestor\s*\{([^}]*)\}/)
    expect(ancestorRule).not.toBeNull()
    expect(ancestorRule![1]!).toMatch(/min-height:/)
  })
})

// The Earth/Dinosaurs/Humans shortcut group (user ask, 2026-09-18): a prominent, always-present
// control beside the title, distinct from the timeline's own section bands and breadcrumb. Every
// entry is a plain alias for `onSelectSection(id)` — see `eraShortcuts.ts` for why those three
// ids and no others.
describe('ShellLayout — era shortcuts', () => {
  it('renders exactly the Earth, Dinosaurs and Humans shortcuts, inside the title header', () => {
    renderShell()
    const group = screen.getByRole('group', { name: 'Jump to an era' })
    expect(group.closest('header')?.textContent).toContain('TITLE_SLOT')
    for (const nickname of ['Earth', 'Dinosaurs', 'Humans']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${nickname} — `) })).not.toBeNull()
    }
  })

  it("names each shortcut's real geological unit, not just its nickname", () => {
    renderShell()
    expect(screen.getByRole('button', { name: /^Dinosaurs — the Mesozoic/ })).not.toBeNull()
    expect(screen.getByRole('button', { name: /^Humans — the Holocene/ })).not.toBeNull()
    expect(screen.getByRole('button', { name: /^Earth — the Earth/ })).not.toBeNull()
  })

  it('marks only the shortcut matching the current section as current, exact-root for Earth', () => {
    renderShell({ sectionId: ROOT_SECTION_ID })
    expect(screen.getByRole('button', { name: /^Earth —/ }).getAttribute('aria-current')).toBe('location')
    expect(screen.getByRole('button', { name: /^Dinosaurs —/ }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('button', { name: /^Humans —/ }).getAttribute('aria-current')).toBeNull()
  })

  it('marks Dinosaurs current for the Mesozoic itself and for a descendant section', () => {
    renderShell({ sectionId: 'cretaceous' as SectionId })
    expect(screen.getByRole('button', { name: /^Dinosaurs —/ }).getAttribute('aria-current')).toBe('location')
    expect(screen.getByRole('button', { name: /^Earth —/ }).getAttribute('aria-current')).toBeNull()
  })

  it('marks Humans current for the Holocene itself and for a human-history child', () => {
    renderShell({ sectionId: 'industrial-age' as SectionId })
    expect(screen.getByRole('button', { name: /^Humans —/ }).getAttribute('aria-current')).toBe('location')
  })

  it('calls onSelectSection with the aliased section id, not the nickname, when clicked', () => {
    const onSelectSection = vi.fn<(id: SectionId) => void>()
    renderShell({ onSelectSection })
    fireEvent.click(screen.getByRole('button', { name: /^Dinosaurs —/ }))
    expect(onSelectSection).toHaveBeenCalledTimes(1)
    expect(onSelectSection).toHaveBeenCalledWith('mesozoic')
  })

  it('is keyboard-reachable as ordinary buttons (native Tab order, no bespoke handler)', () => {
    renderShell()
    for (const nickname of ['Earth', 'Dinosaurs', 'Humans']) {
      const button = screen.getByRole('button', { name: new RegExp(`^${nickname} — `) })
      expect(button.tagName).toBe('BUTTON')
      expect(button.getAttribute('type')).toBe('button')
      expect(button.hasAttribute('disabled')).toBe(false)
    }
  })
})
