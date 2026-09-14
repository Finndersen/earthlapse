import { beforeEach, describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { useTimeStore } from './time'

const initial = useTimeStore.getState()

beforeEach(() => {
  useTimeStore.setState(initial, true)
})

describe('useTimeStore initial state', () => {
  it('starts at present with the full domain as the window', () => {
    const s = useTimeStore.getState()
    expect(s.t).toBe(0)
    expect(s.window).toEqual([0, EARTH_FORMATION])
    expect(s.scaleKind).toBe('symlog')
    expect(s.playback).toEqual({ playing: false, baseRate: 0.02, speed: 1, mode: 'scenes' })
    expect(s.globeExpanded).toBe(false)
    expect(s.expandedChartLayerId).toBeNull()
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

describe('window', () => {
  it('is set independently of t', () => {
    useTimeStore.getState().setT(5e8)
    useTimeStore.getState().setWindow([0, 1e9])
    expect(useTimeStore.getState().window).toEqual([0, 1e9])
    expect(useTimeStore.getState().t).toBe(5e8)
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
  it('setPlaying sets playing without touching baseRate/speed/mode', () => {
    useTimeStore.getState().setSpeed(4)
    useTimeStore.getState().setPlaying(true)
    expect(useTimeStore.getState().playback).toEqual({ playing: true, baseRate: 0.02, speed: 4, mode: 'scenes' })
  })

  it('togglePlaying flips the current value', () => {
    expect(useTimeStore.getState().playback.playing).toBe(false)
    useTimeStore.getState().togglePlaying()
    expect(useTimeStore.getState().playback.playing).toBe(true)
    useTimeStore.getState().togglePlaying()
    expect(useTimeStore.getState().playback.playing).toBe(false)
  })

  it('setSpeed changes only the speed multiplier', () => {
    useTimeStore.getState().setSpeed(10)
    expect(useTimeStore.getState().playback).toEqual({ playing: false, baseRate: 0.02, speed: 10, mode: 'scenes' })
  })

  it('setPlaybackMode switches between scenes and steady, touching nothing else', () => {
    useTimeStore.getState().setSpeed(4)
    useTimeStore.getState().setPlaybackMode('steady')
    expect(useTimeStore.getState().playback).toEqual({ playing: false, baseRate: 0.02, speed: 4, mode: 'steady' })
    useTimeStore.getState().setPlaybackMode('scenes')
    expect(useTimeStore.getState().playback.mode).toBe('scenes')
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
})
