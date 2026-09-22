import { describe, expect, it } from 'vitest'

import { isOpenEventBrowserShortcut, timelineKeyIntent } from './keyboard'

function keyEvent(key: string, target: EventTarget | null = null) {
  return { key, target }
}

describe('timelineKeyIntent', () => {
  it('maps Escape to leaving the current section (ADR-024)', () => {
    expect(timelineKeyIntent(keyEvent('Escape'))).toEqual({ type: 'leave-section' })
    expect(timelineKeyIntent(keyEvent('Escape', document.createElement('input')))).toBeNull()
  })

  it('maps ArrowLeft/ArrowRight to step prev/next', () => {
    expect(timelineKeyIntent(keyEvent('ArrowLeft'))).toEqual({ type: 'step', direction: 'prev' })
    expect(timelineKeyIntent(keyEvent('ArrowRight'))).toEqual({ type: 'step', direction: 'next' })
  })

  it('maps space to toggle-play', () => {
    expect(timelineKeyIntent(keyEvent(' '))).toEqual({ type: 'toggle-play' })
  })

  it('maps [ and - to stepping speed down, ] and = to stepping speed up (follow-up pass item 3)', () => {
    expect(timelineKeyIntent(keyEvent('['))).toEqual({ type: 'speed', direction: 'down' })
    expect(timelineKeyIntent(keyEvent('-'))).toEqual({ type: 'speed', direction: 'down' })
    expect(timelineKeyIntent(keyEvent(']'))).toEqual({ type: 'speed', direction: 'up' })
    expect(timelineKeyIntent(keyEvent('='))).toEqual({ type: 'speed', direction: 'up' })
  })

  it('ignores the speed shortcuts when the target is a text input', () => {
    const input = document.createElement('input')
    expect(timelineKeyIntent(keyEvent('[', input))).toBeNull()
    expect(timelineKeyIntent(keyEvent(']', input))).toBeNull()
    expect(timelineKeyIntent(keyEvent('-', input))).toBeNull()
    expect(timelineKeyIntent(keyEvent('=', input))).toBeNull()
  })

  it('returns null for an unmapped key', () => {
    expect(timelineKeyIntent(keyEvent('a'))).toBeNull()
    expect(timelineKeyIntent(keyEvent('9'))).toBeNull()
  })

  it('maps Backspace to leaving the current section, same as Escape (follow-up pass item 6)', () => {
    expect(timelineKeyIntent(keyEvent('Backspace'))).toEqual({ type: 'leave-section' })
    expect(timelineKeyIntent(keyEvent('Backspace', document.createElement('input')))).toBeNull()
  })

  it('maps Home and 0 to going to the root section (follow-up pass item 6)', () => {
    expect(timelineKeyIntent(keyEvent('Home'))).toEqual({ type: 'go-to-root' })
    expect(timelineKeyIntent(keyEvent('0'))).toEqual({ type: 'go-to-root' })
    expect(timelineKeyIntent(keyEvent('0', document.createElement('input')))).toBeNull()
  })

  it('maps PageUp/PageDown to stepping to the previous/next sibling section (follow-up pass item 6)', () => {
    expect(timelineKeyIntent(keyEvent('PageUp'))).toEqual({ type: 'step-sibling', direction: 'previous' })
    expect(timelineKeyIntent(keyEvent('PageDown'))).toEqual({ type: 'step-sibling', direction: 'next' })
  })

  it('maps Shift+ArrowLeft/Right to the same sibling-step intent as PageUp/PageDown', () => {
    expect(timelineKeyIntent({ key: 'ArrowLeft', target: null, shiftKey: true })).toEqual({ type: 'step-sibling', direction: 'previous' })
    expect(timelineKeyIntent({ key: 'ArrowRight', target: null, shiftKey: true })).toEqual({ type: 'step-sibling', direction: 'next' })
  })

  it('plain ArrowLeft/ArrowRight (no Shift) keep stepping through events/checkpoints, unaffected', () => {
    expect(timelineKeyIntent({ key: 'ArrowLeft', target: null, shiftKey: false })).toEqual({ type: 'step', direction: 'prev' })
    expect(timelineKeyIntent(keyEvent('ArrowRight'))).toEqual({ type: 'step', direction: 'next' })
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

  it('lets a focused <button> keep Space for its own native activation instead of toggling playback (re-review fix)', () => {
    expect(timelineKeyIntent(keyEvent(' ', document.createElement('button')))).toBeNull()
    const roleButton = document.createElement('div')
    roleButton.setAttribute('role', 'button')
    expect(timelineKeyIntent(keyEvent(' ', roleButton))).toBeNull()
    // A non-button target is unaffected.
    expect(timelineKeyIntent(keyEvent(' ', document.createElement('div')))).toEqual({ type: 'toggle-play' })
  })

  it('lets a focused <select> keep Home/PageUp/PageDown for its own native option navigation (re-review fix)', () => {
    const select = document.createElement('select')
    expect(timelineKeyIntent(keyEvent('Home', select))).toBeNull()
    expect(timelineKeyIntent(keyEvent('PageUp', select))).toBeNull()
    expect(timelineKeyIntent(keyEvent('PageDown', select))).toBeNull()
    // '0' (the other go-to-root key) is a plain character with no native <select> meaning tied
    // to this guard's reasoning, but is exempted too for the same "don't fight the control"
    // consistency Home already gets.
    expect(timelineKeyIntent(keyEvent('0', select))).toBeNull()
    // A non-select target is unaffected.
    expect(timelineKeyIntent(keyEvent('Home', document.createElement('button')))).toEqual({ type: 'go-to-root' })
  })
})

describe('isOpenEventBrowserShortcut', () => {
  it('matches a plain /', () => {
    expect(isOpenEventBrowserShortcut(keyEvent('/'))).toBe(true)
  })

  it('ignores / while a text input has focus, so typing a slash is never hijacked', () => {
    expect(isOpenEventBrowserShortcut(keyEvent('/', document.createElement('input')))).toBe(false)
    expect(isOpenEventBrowserShortcut(keyEvent('/', document.createElement('textarea')))).toBe(false)
  })

  it('does not match any other key', () => {
    expect(isOpenEventBrowserShortcut(keyEvent('a'))).toBe(false)
    expect(isOpenEventBrowserShortcut(keyEvent('Escape'))).toBe(false)
  })
})
