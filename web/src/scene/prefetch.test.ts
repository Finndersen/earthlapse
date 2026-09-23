import { describe, expect, it } from 'vitest'

import type { GeoTime } from '@/types/layer'
import type { Scene } from '@/types/manifest'

import { DECODE_AHEAD_SCENES, FETCH_AHEAD_SCENES, planScenePrefetch, sceneByteWants, type PlaybackHeading } from './prefetch'
import { sceneAt } from './scene'

/** 60 scenes ten years apart: 0, 10, ..., 590. */
const scenes: Scene[] = Array.from({ length: 60 }, (_, i) => ({
  id: `s${i}`,
  t: i * 10,
  chapterId: 'ch',
  image: `s${i}.webp`,
  thumbnail: `s${i}-thumb.webp`,
  shot: 'WIDE_RIDGE',
  title: `s${i}`,
  caption: '',
  width: 2752,
  height: 1536,
}))

function planAt(t: GeoTime, heading: PlaybackHeading | null) {
  const { from, to } = sceneAt(scenes, t)
  return planScenePrefetch(scenes, scenes.indexOf(from), scenes.indexOf(to), heading)
}

describe('planScenePrefetch', () => {
  it('reads ahead in the direction of playback, capped, and falls back to one either side while paused', () => {
    expect(planAt(300, null)).toEqual({ decode: [29, 31], fetch: [], pairFirst: true })
    expect(planAt(300, { t: 300, horizonT: 300 })).toEqual({ decode: [29, 31], fetch: [], pairFirst: true })

    expect(planAt(300, { t: 300, horizonT: 250 })).toEqual({ decode: [29, 28, 27, 31], fetch: [26, 25, 32], pairFirst: false })
    expect(planAt(300, { t: 300, horizonT: 350 })).toEqual({ decode: [31, 32, 33, 29], fetch: [34, 35, 28], pairFirst: false })

    const far = planAt(590, { t: 590, horizonT: 0 })
    const ahead = [...far.decode, ...far.fetch].filter((index) => index < 59)
    expect(ahead).toHaveLength(DECODE_AHEAD_SCENES + FETCH_AHEAD_SCENES)
    expect(new Set(ahead).size).toBe(ahead.length)
    expect(ahead[0]).toBe(58)
  })

  it('wants both pairs urgently and holds the plan back behind a pending pair only when pairFirst', () => {
    const pending = {
      requested: ['req'],
      bound: ['bound', 'req'],
      decode: ['dec'],
      fetch: ['fet'],
      nearThumbs: ['near-thumb'],
      allThumbs: ['thumb'],
    }
    expect(sceneByteWants(pending, false)).toEqual({ urgent: ['req', 'bound', 'near-thumb'], background: ['dec', 'fet', 'thumb'] })
    expect(sceneByteWants(pending, true).background).toEqual(['thumb'])
    expect(sceneByteWants({ ...pending, requested: [] }, true).background).toEqual(['dec', 'fet', 'thumb'])
  })
})
