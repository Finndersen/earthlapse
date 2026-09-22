import { describe, expect, it } from 'vitest'

import { isOpenEventBrowserShortcut, timelineKeyIntent, type TimelineKeyIntent } from '@/timeline'

import { formatShortcutKeys, KEYBOARD_SHORTCUTS, POINTER_CONTROLS } from './controlsData'

/** `/` is a page-level shortcut checked against `isOpenEventBrowserShortcut`, not an intent
 *  `timelineKeyIntent` maps (see `controlsData.ts`'s own doc comment) — excluded from the sync
 *  sweep below and checked on its own further down. */
const TIMELINE_INTENT_SHORTCUTS = KEYBOARD_SHORTCUTS.filter((s) => !s.keys.some((k) => k.key === '/'))

/**
 * `KEYBOARD_SHORTCUTS` sync check (task requirement: "a test that would fail if a shortcut were
 * added [to keyboard.ts] and not surfaced here"). `timelineKeyIntent` is a plain key -> intent
 * switch with no way to enumerate its own cases, so this sweeps a deliberately broad superset of
 * plausible `KeyboardEvent.key` values through it — every named key `keyboard.ts`'s doc comment
 * or a real keyboard could produce, plus the full printable ASCII range (covers every current
 * case, including the punctuation ones: `[`, `]`, `-`, `=`, `0`) — and asserts the keys it
 * actually maps are exactly the keys `KEYBOARD_SHORTCUTS` documents. A new case added on any key
 * in this superset changes the observed set and fails the exact-match assertion below; the same
 * is true in reverse if a documented row goes stale.
 */
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

  it('gives every documented row a real, non-null intent', () => {
    for (const shortcut of TIMELINE_INTENT_SHORTCUTS) {
      for (const k of shortcut.keys) {
        expect(timelineKeyIntent({ key: k.key, target: null, shiftKey: k.shiftKey ?? false })).not.toBeNull()
      }
    }
  })
})

describe('the / shortcut', () => {
  it('is documented in KEYBOARD_SHORTCUTS and matches isOpenEventBrowserShortcut', () => {
    expect(KEYBOARD_SHORTCUTS.some((s) => s.keys.some((k) => k.key === '/'))).toBe(true)
    expect(isOpenEventBrowserShortcut({ key: '/', target: null })).toBe(true)
  })
})

describe('formatShortcutKeys', () => {
  it('collapses aliases (space / legacy Spacebar) that display identically to one label', () => {
    expect(formatShortcutKeys([{ key: ' ' }, { key: 'Spacebar' }])).toEqual(['Space'])
  })

  it('renders arrows as glyphs and prefixes a held Shift', () => {
    expect(formatShortcutKeys([{ key: 'ArrowLeft', shiftKey: true }, { key: 'PageUp' }])).toEqual(['Shift+←', 'Page Up'])
  })

  it('falls back to the raw key for anything with no special-cased label', () => {
    expect(formatShortcutKeys([{ key: '9' }])).toEqual(['9'])
  })
})

describe('POINTER_CONTROLS', () => {
  it('is non-empty and every row has both a label and a description', () => {
    expect(POINTER_CONTROLS.length).toBeGreaterThan(0)
    for (const control of POINTER_CONTROLS) {
      expect(control.label.length).toBeGreaterThan(0)
      expect(control.description.length).toBeGreaterThan(0)
    }
  })
})
