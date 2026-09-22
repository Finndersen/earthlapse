/**
 * Data for the "Controls & shortcuts" section of `CreditsList` (rendered by `ControlsShortcuts`),
 * shown on both surfaces that render it: the in-experience About & credits panel and the
 * `/credits` route (ADR-012 amendment).
 *
 * `KEYBOARD_SHORTCUTS` is checked against `timeline/keyboard.ts`'s `timelineKeyIntent` — the
 * actual key -> intent mapping, and already the source `SectionBreadcrumb`'s own tooltips draw
 * their era-navigation hints from — by `controlsData.test.ts`, which sweeps a broad superset of
 * plausible key values through it and asserts the result matches exactly this list. A shortcut
 * added, removed or changed in `keyboard.ts` and not reflected here fails that test instead of
 * silently drifting, without this module reaching past `@/timeline`'s public exports (the
 * package-boundary convention every other cross-package import in this app already follows —
 * `keyboard.ts`'s own hint constants are internal to `timeline/`, so they aren't reused here).
 * `/` (open the event browser) is checked against `isOpenEventBrowserShortcut` instead — it is a
 * page-level shortcut `Experience.tsx` wires with its own `window` listener, not an intent
 * `timelineKeyIntent` maps, so it sits outside that sweep.
 *
 * `POINTER_CONTROLS` has no such mechanical check — pointer/touch interactions aren't a lookup
 * table the way key handling is — so it is kept to interactions verified directly against the
 * code that implements them (`timeline/components/ScrubTrack.tsx`'s drag/hover/cluster
 * handling, `globe/Globe.tsx`'s expand button and ADR-033 Globe/Map toggle).
 */

export interface PointerControl {
  label: string
  description: string
}

export const POINTER_CONTROLS: PointerControl[] = [
  { label: 'Drag the timeline', description: 'Scrub to any point in time.' },
  {
    label: 'Hover the timeline',
    description:
      'Spreads events and scene checkpoints sitting close together apart, so each becomes individually reachable.',
  },
  { label: 'Click a cluster', description: "Opens the list of events it groups." },
  { label: 'Click the globe', description: 'Expands it into a full paleogeographic view.' },
  {
    label: 'Globe / Map toggle',
    description: 'While the globe is expanded, switches between the sphere and an unfolded map.',
  },
]

export interface ShortcutKey {
  key: string
  /** Whether Shift must be held for this key value to produce the row's intent. Omitted (or
   *  `false`) means plain. */
  shiftKey?: boolean
}

export interface KeyboardShortcut {
  /** Every key (optionally Shift-held) that maps to this row's behaviour — shown as
   *  alternatives, e.g. Escape and Backspace both leaving the current section. */
  keys: ShortcutKey[]
  description: string
}

export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  {
    keys: [{ key: 'ArrowLeft' }, { key: 'ArrowRight' }],
    description: 'Step to the previous or next event or scene checkpoint.',
  },
  { keys: [{ key: ' ' }, { key: 'Spacebar' }], description: 'Play or pause.' },
  {
    keys: [{ key: 'Escape' }, { key: 'Backspace' }],
    description: 'Leave the current era section for its parent.',
  },
  { keys: [{ key: 'Home' }, { key: '0' }], description: 'Jump back to Earth (the root section).' },
  {
    keys: [{ key: 'ArrowLeft', shiftKey: true }, { key: 'PageUp' }],
    description: 'Jump to the previous sibling section.',
  },
  {
    keys: [{ key: 'ArrowRight', shiftKey: true }, { key: 'PageDown' }],
    description: 'Jump to the next sibling section.',
  },
  { keys: [{ key: '[' }, { key: '-' }], description: 'Decrease playback speed.' },
  { keys: [{ key: ']' }, { key: '=' }], description: 'Increase playback speed.' },
  {
    keys: [{ key: '/' }],
    description: 'Open the event browser, search focused (desktop only).',
  },
]

const KEY_LABELS: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ' ': 'Space',
  Spacebar: 'Space',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Home: 'Home',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  '0': '0',
  '[': '[',
  ']': ']',
  '-': '-',
  '=': '=',
  '/': '/',
}

function keyLabel(key: string): string {
  return KEY_LABELS[key] ?? key
}

/** The deduplicated, human-facing labels one shortcut row's `keys` should display as — e.g.
 *  `[{key:' '},{key:'Spacebar'}]` collapses to a single "Space" rather than showing the same
 *  physical key twice under two different raw `KeyboardEvent.key` values. */
export function formatShortcutKeys(keys: ShortcutKey[]): string[] {
  const labels = keys.map((k) => (k.shiftKey === true ? `Shift+${keyLabel(k.key)}` : keyLabel(k.key)))
  return [...new Set(labels)]
}
