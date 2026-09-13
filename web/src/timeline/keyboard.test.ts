import { describe, expect, it } from 'vitest'

import { timelineKeyIntent } from './keyboard'

function keyEvent(key: string, target: EventTarget | null = null) {
  return { key, target }
}

describe('timelineKeyIntent', () => {
  it('maps + and = to zoom-in', () => {
    expect(timelineKeyIntent(keyEvent('+'))).toEqual({ type: 'zoom-in' })
    expect(timelineKeyIntent(keyEvent('='))).toEqual({ type: 'zoom-in' })
  })

  it('maps - and _ to zoom-out', () => {
    expect(timelineKeyIntent(keyEvent('-'))).toEqual({ type: 'zoom-out' })
    expect(timelineKeyIntent(keyEvent('_'))).toEqual({ type: 'zoom-out' })
  })

  it('maps ArrowLeft/ArrowRight to step prev/next', () => {
    expect(timelineKeyIntent(keyEvent('ArrowLeft'))).toEqual({ type: 'step', direction: 'prev' })
    expect(timelineKeyIntent(keyEvent('ArrowRight'))).toEqual({ type: 'step', direction: 'next' })
  })

  it('maps space to toggle-play', () => {
    expect(timelineKeyIntent(keyEvent(' '))).toEqual({ type: 'toggle-play' })
  })

  it('maps 0 and Home to fit-all', () => {
    expect(timelineKeyIntent(keyEvent('0'))).toEqual({ type: 'fit-all' })
    expect(timelineKeyIntent(keyEvent('Home'))).toEqual({ type: 'fit-all' })
  })

  it('returns null for an unmapped key', () => {
    expect(timelineKeyIntent(keyEvent('a'))).toBeNull()
    expect(timelineKeyIntent(keyEvent('Escape'))).toBeNull()
  })

  it('ignores every mapped key when the target is an <input>', () => {
    const input = document.createElement('input')
    expect(timelineKeyIntent(keyEvent('+', input))).toBeNull()
    expect(timelineKeyIntent(keyEvent(' ', input))).toBeNull()
    expect(timelineKeyIntent(keyEvent('ArrowLeft', input))).toBeNull()
    expect(timelineKeyIntent(keyEvent('0', input))).toBeNull()
  })

  it('ignores every mapped key when the target is a <textarea>', () => {
    const textarea = document.createElement('textarea')
    expect(timelineKeyIntent(keyEvent('+', textarea))).toBeNull()
    expect(timelineKeyIntent(keyEvent('Home', textarea))).toBeNull()
  })

  it('still maps keys for a non-text-input target such as a <button> or <div>', () => {
    expect(timelineKeyIntent(keyEvent('+', document.createElement('button')))).toEqual({ type: 'zoom-in' })
    expect(timelineKeyIntent(keyEvent('+', document.createElement('div')))).toEqual({ type: 'zoom-in' })
  })
})
