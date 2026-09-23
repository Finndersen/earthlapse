/**
 * One shot per published scene at a phone portrait viewport: a contact sheet for reviewing each
 * scene's ADR-045 crop by eye, not a regression guard, so it stays out of the default list. Run it
 * with `--extra-shots scripts/qa/shots.scene-framing.mjs --grep scene-framing`. Generated from the
 * published manifest, so it always covers exactly the scenes `earthlapse publish` wrote.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { boxOf } from './measure.mjs'
import { SCENE_CANVAS_SELECTOR } from './selectors.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(path.join(here, '../../public/media/manifest.json'), 'utf8'))

const VIEWPORT = { width: 390, height: 844 }

export default manifest.scenes.map((scene) => ({
  name: `scene-framing-${scene.id}`,
  description: `Portrait crop (ADR-045) for "${scene.id}" at its own t=${scene.t}.`,
  viewport: VIEWPORT,
  t: scene.t,
  measure: async ({ page }) => ({ canvasWidth: (await boxOf(page, SCENE_CANVAS_SELECTOR)).width }),
  expect: { canvasWidth: [VIEWPORT.width, VIEWPORT.width] },
}))
