import { describe, expect, it } from 'vitest'

import { timelineKeyIntent } from './keyboard'

function keyEvent(key: string, target: EventTarget | null = null) {
  return { key, target }
}

describe('timelineKeyIntent', () => {
  it('maps ArrowLeft/ArrowRight to step prev/next', () => {
    expect(timelineKeyIntent(keyEvent('ArrowLeft'))).toEqual({ type: 'step', direction: 'prev' })
    expect(timelineKeyIntent(keyEvent('ArrowRight'))).toEqual({ type: 'step', direction: 'next' })
  })

  it('maps space to toggle-play', () => {
    expect(timelineKeyIntent(keyEvent(' '))).toEqual({ type: 'toggle-play' })
  })

  it('returns null for an unmapped key', () => {
    expect(timelineKeyIntent(keyEvent('a'))).toBeNull()
    expect(timelineKeyIntent(keyEvent('Escape'))).toBeNull()
    expect(timelineKeyIntent(keyEvent('0'))).toBeNull()
  })

  it('ignores every mapped key when the target is an <input>', () => {
    const input = document.createElement('input')
    expect(timelineKeyIntent(keyEvent(' ', input))).toBeNull()
    expect(timelineKeyIntent(keyEvent('ArrowLeft', input))).toBeNull()
  })

  it('ignores every mapped key when the target is a <textarea>', () => {
    const textarea = document.createElement('textarea')
    expect(timelineKeyIntent(keyEvent('ArrowRight', textarea))).toBeNull()
    expect(timelineKeyIntent(keyEvent(' ', textarea))).toBeNull()
  })

  it('still maps keys for a non-text-input target such as a <button> or <div>', () => {
    expect(timelineKeyIntent(keyEvent('ArrowLeft', document.createElement('button')))).toEqual({ type: 'step', direction: 'prev' })
    expect(timelineKeyIntent(keyEvent('ArrowLeft', document.createElement('div')))).toEqual({ type: 'step', direction: 'prev' })
  })
})
