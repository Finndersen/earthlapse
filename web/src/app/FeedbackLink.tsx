'use client'

/**
 * The About & credits panel's "Report a bug or give feedback" link — a real `<a>` to a prefilled
 * GitHub new-issue form, not a button that calls `window.open`, so it stays middle-clickable and
 * right-clickable ("copy link address") like any other link.
 *
 * `Experience` re-renders every playback frame, so the URL is never built from props or a hook
 * subscription — that would mean recomputing it, and throwing it away, on every frame it's
 * mounted. Instead the `href` starts as the bare `/issues/new` and is rewritten at the moment of
 * interaction: `onMouseDown` fires before `click` *and* before `auxclick` (the event a
 * middle-click actually dispatches), so by the time the browser acts on either one the `href`
 * already carries the fresh diagnostic body; `onClick` covers keyboard activation (Enter/Space on
 * a focused link), which fires with no preceding `mousedown` at all.
 */

import type { MouseEvent as ReactMouseEvent } from 'react'

import { useTimeStore } from '@/store/time'
import { eraNameForTime, formatGeoTime } from '@/timeline'

const REPO_URL = 'https://github.com/Finndersen/earthview'
const NEW_ISSUE_URL = `${REPO_URL}/issues/new`

function findAccessibleButton(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === text && button.hasAttribute('aria-pressed'),
  )
}

/** The expanded globe's Globe/Map toggle is deliberately local component state inside
 *  `Globe.tsx`, not lifted to the time store (see `store/devHook.ts`'s own doc comment on
 *  `getGlobeViewMode`, which reads it back the same way: by querying the real accessible
 *  control). `null` when the globe isn't expanded — the toggle doesn't exist then. */
function globeViewModeFromDom(): 'globe' | 'map' | null {
  const mapButton = findAccessibleButton('Map')
  if (mapButton === undefined) return null
  return mapButton.getAttribute('aria-pressed') === 'true' ? 'map' : 'globe'
}

function buildDiagnostics(): string {
  const { t, sectionId, playback, globeExpanded } = useTimeStore.getState()
  const globeLine = globeExpanded ? `expanded (${globeViewModeFromDom() ?? 'unknown'} view)` : 'collapsed'
  return [
    `t: ${t} (${formatGeoTime(t)})`,
    `Era: ${eraNameForTime(t)}`,
    `Section: ${sectionId}`,
    `Playback: ${playback.playing ? 'playing' : 'paused'}, mode=${playback.mode}, speed=${playback.speed}x, steady=${playback.yearsPerSecond} yr/s`,
    `Globe: ${globeLine}`,
    `Viewport: ${window.innerWidth}x${window.innerHeight}, devicePixelRatio=${window.devicePixelRatio}`,
    `User agent: ${navigator.userAgent}`,
  ].join('\n')
}

function buildFeedbackUrl(): string {
  const body = [
    '## What happened / what did you expect?',
    '',
    '',
    '## Diagnostics',
    '',
    '```',
    buildDiagnostics(),
    '```',
    '',
  ].join('\n')
  // No `template=` param, deliberately: GitHub only honours `title`/`body`/`labels` on the
  // classic blank editor. Naming a YAML issue form (`.github/ISSUE_TEMPLATE/bug_report.yml`)
  // would route here instead, and that form has no field named `body` to receive this text — it
  // would render the form empty rather than prefilled. Leaving `template` unset keeps this link
  // on the path that actually uses `body`; the YAML form still serves anyone who starts a new
  // issue by hand from GitHub's own UI.
  const params = new URLSearchParams({ title: 'Bug report', body, labels: 'bug' })
  return `${NEW_ISSUE_URL}?${params.toString()}`
}

function refreshHref(event: ReactMouseEvent<HTMLAnchorElement>): void {
  event.currentTarget.href = buildFeedbackUrl()
}

export function FeedbackLink() {
  return (
    <a href={NEW_ISSUE_URL} target="_blank" rel="noopener noreferrer" onMouseDown={refreshHref} onClick={refreshHref}>
      Report a bug or give feedback
    </a>
  )
}
