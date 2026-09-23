import { beforeEach, describe, expect, it } from 'vitest'

import { defaultSteadyRate } from '@/timeline/playbackRates'
import { sectionById } from '@/timeline/sections'
import { EARTH_FORMATION } from '@/types/layer'

import { useTimeStore } from './time'

const initial = useTimeStore.getState()

beforeEach(() => {
  useTimeStore.setState(initial, true)
})

describe('useTimeStore initial state', () => {
  it('starts at present', () => {
    const s = useTimeStore.getState()
    expect(s.t).toBe(0)
    expect(s.sectionId).toBe('earth')
    expect(s.scaleKind).toBe('symlog')
    expect(s.playback).toEqual({ playing: false, baseRate: 0.02, speed: 1, yearsPerSecond: 1, mode: 'scenes' })
    expect(s.globeExpanded).toBe(false)
    expect(s.expandedChartLayerId).toBeNull()
    expect(s.detailEventId).toBeNull()
  })
})

describe('setT clamping', () => {
  it('accepts a value within the domain unchanged', () => {
    useTimeStore.getState().setT(1e9)
    expect(useTimeStore.getState().t).toBe(1e9)
  })

  it('clamps below zero up to zero', () => {
    useTimeStore.getState().setT(-100)
    expect(useTimeStore.getState().t).toBe(0)
  })

  it('clamps above EARTH_FORMATION down to it', () => {
    useTimeStore.getState().setT(EARTH_FORMATION * 2)
    expect(useTimeStore.getState().t).toBe(EARTH_FORMATION)
  })

  it('accepts the domain boundaries exactly', () => {
    useTimeStore.getState().setT(0)
    expect(useTimeStore.getState().t).toBe(0)
    useTimeStore.getState().setT(EARTH_FORMATION)
    expect(useTimeStore.getState().t).toBe(EARTH_FORMATION)
  })

  it('throws on NaN rather than silently clamping', () => {
    expect(() => useTimeStore.getState().setT(Number.NaN)).toThrow(/NaN/)
  })
})

describe('scaleKind', () => {
  it('switches between symlog, density and linear', () => {
    useTimeStore.getState().setScaleKind('linear')
    expect(useTimeStore.getState().scaleKind).toBe('linear')
    useTimeStore.getState().setScaleKind('density')
    expect(useTimeStore.getState().scaleKind).toBe('density')
  })
})

describe('playback actions', () => {
  it('setPlaying sets playing without touching the rates or mode', () => {
    useTimeStore.getState().setSpeed(4)
    useTimeStore.getState().setPlaying(true)
    expect(useTimeStore.getState().playback).toEqual({ ...initial.playback, playing: true, speed: 4 })
  })

  it('togglePlaying flips the current value', () => {
    expect(useTimeStore.getState().playback.playing).toBe(false)
    useTimeStore.getState().togglePlaying()
    expect(useTimeStore.getState().playback.playing).toBe(true)
    useTimeStore.getState().togglePlaying()
    expect(useTimeStore.getState().playback.playing).toBe(false)
  })

  it('setSpeed changes only the scenes multiplier', () => {
    useTimeStore.getState().setSpeed(16)
    expect(useTimeStore.getState().playback).toEqual({ ...initial.playback, speed: 16 })
  })

  it('setYearsPerSecond changes only the steady rate and marks it chosen', () => {
    useTimeStore.getState().setYearsPerSecond(5000)
    expect(useTimeStore.getState().playback).toEqual({ ...initial.playback, yearsPerSecond: 5000 })
    expect(useTimeStore.getState().steadyRateChosen).toBe(true)
  })
})

describe('steady rate context default', () => {
  it('starts with no steady rate chosen', () => {
    expect(useTimeStore.getState().steadyRateChosen).toBe(false)
  })

  it('entering steady mode picks the detent for where t is', () => {
    useTimeStore.getState().setT(1200)
    useTimeStore.getState().setPlaybackMode('steady')
    expect(useTimeStore.getState().playback.mode).toBe('steady')
    expect(useTimeStore.getState().playback.yearsPerSecond).toBe(defaultSteadyRate(sectionById('earth').window, 1200))
  })

  it('entering steady mode keeps the scenes multiplier for the way back', () => {
    useTimeStore.getState().setSpeed(1 / 4)
    useTimeStore.getState().setPlaybackMode('steady')
    useTimeStore.getState().setPlaybackMode('scenes')
    expect(useTimeStore.getState().playback.speed).toBe(1 / 4)
  })

  it('selecting a section in steady mode re-derives the default until a rate is chosen', () => {
    useTimeStore.getState().setPlaybackMode('steady')
    useTimeStore.getState().selectSection('cretaceous')
    const cretaceous = sectionById('cretaceous').window
    expect(useTimeStore.getState().playback.yearsPerSecond).toBe(defaultSteadyRate(cretaceous, cretaceous[1]))
  })

  it('keeps a chosen steady rate across mode switches and section changes', () => {
    useTimeStore.getState().setPlaybackMode('steady')
    useTimeStore.getState().setYearsPerSecond(200)
    useTimeStore.getState().setPlaybackMode('scenes')
    useTimeStore.getState().selectSection('cretaceous')
    useTimeStore.getState().setPlaybackMode('steady')
    expect(useTimeStore.getState().playback.yearsPerSecond).toBe(200)
  })

  it('setting the mode it is already in changes nothing', () => {
    useTimeStore.getState().setPlaybackMode('steady')
    const before = useTimeStore.getState().playback
    useTimeStore.getState().setT(4e9)
    useTimeStore.getState().setPlaybackMode('steady')
    expect(useTimeStore.getState().playback).toBe(before)
  })

  it('playback carrying t into another section does not change the steady rate', () => {
    useTimeStore.getState().selectSection('industrial-age')
    useTimeStore.getState().setPlaybackMode('steady')
    const rate = useTimeStore.getState().playback.yearsPerSecond
    useTimeStore.getState().setT(50)
    expect(useTimeStore.getState().sectionId).not.toBe('industrial-age')
    expect(useTimeStore.getState().playback.yearsPerSecond).toBe(rate)
  })
})

describe('overlay state', () => {
  it('setGlobeExpanded toggles the globe overlay', () => {
    useTimeStore.getState().setGlobeExpanded(true)
    expect(useTimeStore.getState().globeExpanded).toBe(true)
  })

  it('setExpandedChartLayerId tracks which layer chart is expanded, or none', () => {
    useTimeStore.getState().setExpandedChartLayerId('co2')
    expect(useTimeStore.getState().expandedChartLayerId).toBe('co2')
    useTimeStore.getState().setExpandedChartLayerId(null)
    expect(useTimeStore.getState().expandedChartLayerId).toBeNull()
  })

  it('setDetailEventId tracks which event detail panel is open, or none', () => {
    useTimeStore.getState().setDetailEventId('k-pg-impact')
    expect(useTimeStore.getState().detailEventId).toBe('k-pg-impact')
    useTimeStore.getState().setDetailEventId(null)
    expect(useTimeStore.getState().detailEventId).toBeNull()
  })
})

describe('era sections (ADR-024)', () => {
  it('selectSection moves t to the section start when t was outside it', () => {
    useTimeStore.getState().setT(66e6)
    useTimeStore.getState().selectSection('holocene')
    expect(useTimeStore.getState()).toMatchObject({ sectionId: 'holocene', t: 11_725 })
  })

  it('selectSection keeps t when it is already inside', () => {
    useTimeStore.getState().setT(200)
    useTimeStore.getState().selectSection('industrial-age')
    expect(useTimeStore.getState()).toMatchObject({ sectionId: 'industrial-age', t: 200 })
  })

  it('setT keeps the section while t stays inside, edges included', () => {
    useTimeStore.getState().selectSection('industrial-age')
    useTimeStore.getState().setT(111)
    expect(useTimeStore.getState().sectionId).toBe('industrial-age')
  })

  it('setT follows t into the next section and up to one that holds a jump', () => {
    useTimeStore.getState().selectSection('industrial-age')
    useTimeStore.getState().setT(50)
    expect(useTimeStore.getState().sectionId).toBe('modern')
    useTimeStore.getState().setT(66e6)
    expect(useTimeStore.getState().sectionId).toBe('paleogene')
  })

  it('setT follows a clamped t', () => {
    useTimeStore.getState().selectSection('modern')
    useTimeStore.getState().setT(EARTH_FORMATION * 2)
    expect(useTimeStore.getState()).toMatchObject({ sectionId: 'hadean', t: EARTH_FORMATION })
  })
})
