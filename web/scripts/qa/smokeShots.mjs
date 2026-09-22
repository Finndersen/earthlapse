/**
 * The `--smoke` subset: enough of `shots.mjs` to catch a broken build without running the full
 * ~80-shot list. Names only (`run.mjs --shots` already filters `shots.mjs` by name), so this file
 * never duplicates a shot definition and `shots.mjs` stays the one place shots are written.
 * Desktop and phone, globe collapsed and expanded (both view modes), timeline controls and pip
 * hover, HUD sparkline/chart/event-feed, and a scene/globe-focus check — one shot per area rather
 * than one per bug, plus the two shots that guard the cross-shot state leaks `run.mjs`'s own
 * `applyState` resolves (`globe-click-on-backdrop-still-closes`, `timeline-pip-thumbnail-hover`).
 */
export default [
  'present-day-default',
  'viewport-390x844-phone-portrait',
  'globe-expanded-sphere',
  'globe-expanded-map',
  'globe-click-on-backdrop-still-closes',
  'globe-expanded-phone-strip-above-breadcrumb',
  'era-shortcuts-group',
  'timeline-controls-inset-to-track-wide',
  'population-sparkline-grows-with-t',
  'population-chart-ghost-future',
  'timeline-pip-thumbnail-hover',
  'event-feed-card-count-stable-across-captions',
  'globe-scene-focus-centred',
  'onboarding-tour-step-one-phone',
]
