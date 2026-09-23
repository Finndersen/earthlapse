import { beforeEach, describe, expect, it } from 'vitest'

import { defaultSteadyRate } from '@/timeline/playbackRates'
import { sectionById } from '@/timeline/sections'
import { EARTH_FORMATION } from '@/types/layer'

import { useTimeStore } from './time'

const initial = useTimeStore.getState()

beforeEach(() => {
  useTimeStore.setState(initial, true)
})

const store = () => useTimeStore.getState()

describe('useTimeStore', () => {
  it('starts paused at the present, at the root section', () => {
    expect(store()).toMatchObject({
      t: 0,
      sectionId: 'earth',
      scaleKind: 'symlog',
      playback: { playing: false, baseRate: 0.02, speed: 1, yearsPerSecond: 1, mode: 'scenes' },
      globeExpanded: false,
      detailEventId: null,
    })
  })

  it('clamps t into the domain and rejects NaN', () => {
    store().setT(1e9)
    expect(store().t).toBe(1e9)
    store().setT(-100)
    expect(store().t).toBe(0)
    store().setT(EARTH_FORMATION * 2)
    expect(store().t).toBe(EARTH_FORMATION)
    expect(() => store().setT(Number.NaN)).toThrow(/NaN/)
  })

  it('changes one playback field at a time', () => {
    store().setSpeed(4)
    store().setPlaying(true)
    store().setYearsPerSecond(5000)
    expect(store().playback).toEqual({ playing: true, baseRate: 0.02, speed: 4, yearsPerSecond: 5000, mode: 'scenes' })
    store().togglePlaying()
    expect(store().playback.playing).toBe(false)
  })

  it('applies the steady context default until a rate is chosen, then keeps the chosen one', () => {
    store().setT(1200)
    store().setPlaybackMode('steady')
    expect(store().playback.yearsPerSecond).toBe(defaultSteadyRate(sectionById('earth').window, 1200))
    store().selectSection('cretaceous')
    const cretaceous = sectionById('cretaceous').window
    expect(store().playback.yearsPerSecond).toBe(defaultSteadyRate(cretaceous, cretaceous[1]))
    store().setYearsPerSecond(200)
    store().setPlaybackMode('scenes')
    store().selectSection('holocene')
    store().setPlaybackMode('steady')
    expect(store().playback.yearsPerSecond).toBe(200)
  })

  it('tracks the scale kind and open overlays', () => {
    store().setScaleKind('linear')
    store().setGlobeExpanded(true)
    store().setDetailEventId('k-pg-impact')
    expect(store()).toMatchObject({ scaleKind: 'linear', globeExpanded: true, detailEventId: 'k-pg-impact' })
  })
})

describe('era sections', () => {
  it('moves t to a selected section’s start only when it lies outside', () => {
    store().setT(66e6)
    store().selectSection('holocene')
    expect(store()).toMatchObject({ sectionId: 'holocene', t: 11_725 })
    store().setT(200)
    store().selectSection('industrial-age')
    expect(store()).toMatchObject({ sectionId: 'industrial-age', t: 200 })
  })

  it('follows t across section edges, keeping the section while t stays inside', () => {
    store().selectSection('industrial-age')
    store().setT(111)
    expect(store().sectionId).toBe('industrial-age')
    store().setT(50)
    expect(store().sectionId).toBe('modern')
    store().setT(66e6)
    expect(store().sectionId).toBe('paleogene')
    store().setT(EARTH_FORMATION * 2)
    expect(store()).toMatchObject({ sectionId: 'hadean', t: EARTH_FORMATION })
  })
})
