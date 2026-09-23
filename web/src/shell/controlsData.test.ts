// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { isOpenEventBrowserShortcut, timelineKeyIntent, type TimelineKeyIntent } from '@/timeline'

import { formatShortcutKeys, KEYBOARD_SHORTCUTS } from './controlsData'

/** `/` is a page-level shortcut, not a timeline intent; it is checked separately. */
const TIMELINE_INTENT_SHORTCUTS = KEYBOARD_SHORTCUTS.filter((s) => !s.keys.some((k) => k.key === '/'))

/** timelineKeyIntent cannot enumerate its cases, so a broad superset of keys is swept through it
 *  and the mapped set must equal the documented set exactly, in both directions. */
const NAMED_KEYS = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
  'Backspace',
  'Delete',
  'Enter',
  'Tab',
  'Insert',
  'Spacebar',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
]
const PRINTABLE_ASCII = Array.from({ length: 126 - 33 + 1 }, (_, i) => String.fromCharCode(33 + i))
const CANDIDATE_KEYS = [...new Set([...NAMED_KEYS, ...PRINTABLE_ASCII, ' '])]

function intentsFor(shiftKey: boolean): Map<string, TimelineKeyIntent> {
  const map = new Map<string, TimelineKeyIntent>()
  for (const key of CANDIDATE_KEYS) {
    const intent = timelineKeyIntent({ key, target: null, shiftKey })
    if (intent !== null) map.set(key, intent)
  }
  return map
}

describe('KEYBOARD_SHORTCUTS stays in sync with timeline/keyboard.ts', () => {
  const base = intentsFor(false)
  const shifted = intentsFor(true)

  it('documents exactly the keys timelineKeyIntent maps when Shift is not held', () => {
    const documentedBaseKeys = new Set(
      TIMELINE_INTENT_SHORTCUTS.flatMap((s) => s.keys.filter((k) => k.shiftKey !== true).map((k) => k.key)),
    )
    expect([...base.keys()].sort()).toEqual([...documentedBaseKeys].sort())
  })

  it('documents exactly the keys whose mapping changes when Shift is held', () => {
    const shiftSensitiveKeys = CANDIDATE_KEYS.filter((key) => {
      const b = base.get(key) ?? null
      const s = shifted.get(key) ?? null
      return JSON.stringify(b) !== JSON.stringify(s)
    })
    const documentedShiftKeys = new Set(
      TIMELINE_INTENT_SHORTCUTS.flatMap((s) => s.keys.filter((k) => k.shiftKey === true).map((k) => k.key)),
    )
    expect(shiftSensitiveKeys.sort()).toEqual([...documentedShiftKeys].sort())
  })

})

describe('the / shortcut', () => {
  it('is documented in KEYBOARD_SHORTCUTS and matches isOpenEventBrowserShortcut', () => {
    expect(KEYBOARD_SHORTCUTS.some((s) => s.keys.some((k) => k.key === '/'))).toBe(true)
    expect(isOpenEventBrowserShortcut({ key: '/', target: null })).toBe(true)
  })
})

describe('formatShortcutKeys', () => {
  it('collapses aliases, renders arrows as glyphs and prefixes a held Shift', () => {
    expect(formatShortcutKeys([{ key: ' ' }, { key: 'Spacebar' }])).toEqual(['Space'])
    expect(formatShortcutKeys([{ key: 'ArrowLeft', shiftKey: true }, { key: 'PageUp' }])).toEqual(['Shift+←', 'Page Up'])
  })

})
