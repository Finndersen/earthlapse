/**
 * The `--smoke` subset (≤ 60 s, CLAUDE.md "Testing policy"): the real page load, the desktop and
 * phone resting layouts, the phone expanded globe, and pointer hit-testing and zoom on the desktop
 * expanded globe. Names only (`run.mjs --shots` filters `shots.mjs` by name), so `shots.mjs` stays
 * the one place shots are written; a new measurement extends one of these shots rather than
 * adding a name here.
 */
export default [
  'loading-screen',
  'layout-1440x900-resting',
  'layout-390x844-resting',
  'layout-390x844-expanded',
  'globe-interactions',
]
