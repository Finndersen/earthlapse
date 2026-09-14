import { describe, expect, it } from 'vitest'

import type { Scene } from '@/types/manifest'

import { sceneCaptionedEventIds } from './sceneLink'

function scene(overrides: Partial<Scene>): Scene {
  return {
    id: 'scene',
    t: 0,
    chapterId: 'chapter',
    image: 'image.jpg',
    shot: 'WATER_EDGE',
    caption: '',
    width: 1,
    height: 1,
    ...overrides,
  }
}

describe('sceneCaptionedEventIds', () => {
  it('returns nothing when there are no scenes', () => {
    expect(sceneCaptionedEventIds([], 100)).toEqual(new Set())
  })

  it('returns nothing for a scene with no linked events', () => {
    const scenes = [scene({ id: 'solo', t: 500 })]
    expect(sceneCaptionedEventIds(scenes, 500)).toEqual(new Set())
  })

  it('returns the ids of the scene currently captioned at t, not any other scene', () => {
    // Ascending by t, matching sceneAt's own contract.
    const scenes = [
      scene({ id: 'new', t: 0, events: ['apollo-11-launch'] }),
      scene({ id: 'old', t: 1000, events: ['moon-forming-impact'] }),
    ]
    expect(sceneCaptionedEventIds(scenes, 0)).toEqual(new Set(['apollo-11-launch']))
    expect(sceneCaptionedEventIds(scenes, 1000)).toEqual(new Set(['moon-forming-impact']))
  })
})
