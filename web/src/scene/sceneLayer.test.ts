import { describe, expect, it } from 'vitest'

import { chooseSceneLayer, sharpening } from './sceneLayer'

const FULL = { name: 'full' }
const THUMB = { name: 'thumb' }

describe('chooseSceneLayer', () => {
  it('draws the full image once loaded, the thumbnail until then, and nothing new without either; only a sharpening of the same scene fades', () => {
    expect(chooseSceneLayer('a', FULL, THUMB)).toEqual({ url: 'a', full: FULL, thumb: THUMB })
    expect(chooseSceneLayer('a', FULL, undefined)).toEqual({ url: 'a', full: FULL, thumb: null })
    expect(chooseSceneLayer('a', undefined, THUMB)).toEqual({ url: 'a', full: null, thumb: THUMB })
    expect(chooseSceneLayer('a', undefined, undefined)).toBeNull()

    const soft = { url: 'a', full: null, thumb: THUMB }
    const sharp = { url: 'a', full: FULL, thumb: THUMB }
    expect(sharpening(soft, sharp, 'crossfade')).toBe('fade')
    expect(sharpening(soft, sharp, 'cut')).toBe('cut')
    expect(sharpening(sharp, sharp, 'crossfade')).toBe('none')
    expect(sharpening(soft, soft, 'crossfade')).toBe('none')
    expect(sharpening(soft, { ...sharp, url: 'b' }, 'crossfade')).toBe('none')
    expect(sharpening(null, sharp, 'crossfade')).toBe('none')
  })
})
