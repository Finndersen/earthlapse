import { describe, expect, it } from 'vitest'

import { bindsNow, chooseSceneLayer, RAPID_REQUEST_MS, sharpening } from './sceneLayer'

const FULL = { name: 'full' }
const THUMB = { name: 'thumb' }

describe('chooseSceneLayer', () => {
  it('draws the full image once loaded, the thumbnail until then once the grace has passed or requests come fast, and nothing new without either; only a sharpening of the same scene fades', () => {
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

    const layer = (url: string, full: object | null) => ({ url, full, thumb: THUMB })
    const bound = { from: layer('a', FULL), to: layer('a', FULL) }
    const deliberate = { elapsed: false, sincePreviousRequestMs: Infinity }

    expect(bindsNow(bound, layer('a', FULL), layer('b', null), deliberate)).toBe(false)
    expect(bindsNow(bound, layer('a', FULL), layer('b', FULL), deliberate)).toBe(true)
    expect(bindsNow(bound, layer('a', FULL), layer('b', null), { ...deliberate, elapsed: true })).toBe(true)
    expect(bindsNow(bound, layer('a', FULL), layer('b', null), { elapsed: false, sincePreviousRequestMs: RAPID_REQUEST_MS - 1 })).toBe(true)
    expect(bindsNow({ ...bound, to: layer('b', null) }, layer('b', null), layer('b', null), deliberate)).toBe(true)
    expect(bindsNow(null, layer('b', null), layer('b', null), deliberate)).toBe(true)
    expect(bindsNow(bound, layer('a', FULL), null, { ...deliberate, elapsed: true })).toBe(false)
  })
})
