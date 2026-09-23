// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { isOpenEventBrowserShortcut, timelineKeyIntent } from './keyboard'

function keyEvent(key: string, target: EventTarget | null = null) {
  return { key, target }
}

describe('timelineKeyIntent', () => {
  it('maps each shortcut to its intent', () => {
    const cases: [string, boolean, object][] = [
      [' ', false, { type: 'toggle-play' }],
      ['ArrowLeft', false, { type: 'step', direction: 'prev' }],
      ['ArrowRight', false, { type: 'step', direction: 'next' }],
      ['ArrowLeft', true, { type: 'step-sibling', direction: 'previous' }],
      ['PageDown', false, { type: 'step-sibling', direction: 'next' }],
      ['[', false, { type: 'speed', direction: 'down' }],
      ['=', false, { type: 'speed', direction: 'up' }],
      ['Escape', false, { type: 'leave-section' }],
      ['Backspace', false, { type: 'leave-section' }],
      ['Home', false, { type: 'go-to-root' }],
      ['0', false, { type: 'go-to-root' }],
    ]
    for (const [key, shiftKey, intent] of cases) expect(timelineKeyIntent({ key, target: null, shiftKey })).toEqual(intent)
    expect(timelineKeyIntent(keyEvent('a'))).toBeNull()
  })

  it('ignores every shortcut while typing in an input or textarea', () => {
    for (const tag of ['input', 'textarea']) {
      for (const key of [' ', 'ArrowLeft', '[', 'Escape', 'Backspace', '0']) {
        expect(timelineKeyIntent(keyEvent(key, document.createElement(tag)))).toBeNull()
      }
    }
    expect(timelineKeyIntent(keyEvent('ArrowLeft', document.createElement('div')))).toEqual({ type: 'step', direction: 'prev' })
  })

  it('leaves native keys to a focused button or select', () => {
    expect(timelineKeyIntent(keyEvent(' ', document.createElement('button')))).toBeNull()
    const roleButton = document.createElement('div')
    roleButton.setAttribute('role', 'button')
    expect(timelineKeyIntent(keyEvent(' ', roleButton))).toBeNull()
    for (const key of ['Home', 'PageUp', '0']) expect(timelineKeyIntent(keyEvent(key, document.createElement('select')))).toBeNull()
    expect(timelineKeyIntent(keyEvent('Home', document.createElement('button')))).toEqual({ type: 'go-to-root' })
  })
})

describe('isOpenEventBrowserShortcut', () => {
  it('matches a plain / only outside text inputs', () => {
    expect(isOpenEventBrowserShortcut(keyEvent('/'))).toBe(true)
    expect(isOpenEventBrowserShortcut(keyEvent('/', document.createElement('input')))).toBe(false)
    expect(isOpenEventBrowserShortcut(keyEvent('a'))).toBe(false)
  })
})
