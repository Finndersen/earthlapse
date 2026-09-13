/**
 * Keyboard intents for the timeline (README §2: "+/− zoom, ←/→ step to the previous/next
 * event, space play/pause, 0 or Home fits all"). A pure key -> intent mapping, kept separate
 * from the DOM listener that wires it up (`Timeline`'s root `onKeyDown`, which fires only
 * while focus is somewhere inside the component — see that component for why that alone is
 * enough to not "hijack typing elsewhere" without a global listener) so the mapping itself is
 * directly unit-testable.
 */

/** Tag names that should swallow every key this module maps, even when a focusable timeline
 *  descendant happens to contain one (there is none today, but keeping the check here rather
 *  than relying on "the timeline just doesn't have text inputs" keeps the contract explicit
 *  and future-proof — see README §2's own wording). */
const TEXT_INPUT_TAGS = new Set(['INPUT', 'TEXTAREA'])

export type TimelineKeyIntent =
  | { type: 'zoom-in' }
  | { type: 'zoom-out' }
  | { type: 'step'; direction: 'prev' | 'next' }
  | { type: 'toggle-play' }
  | { type: 'fit-all' }

/** The subset of a real `KeyboardEvent` this module needs, so tests can pass plain objects
 *  instead of constructing DOM events. */
export interface TimelineKeyEvent {
  key: string
  target: EventTarget | null
}

function isTextInputTarget(target: EventTarget | null): boolean {
  return target instanceof Element && TEXT_INPUT_TAGS.has(target.tagName)
}

/**
 * Maps a keydown to the intent it represents, or `null` for a key this component doesn't
 * handle (letting it propagate normally) or when `event.target` is a text input/textarea
 * (typing must never be hijacked, even by a key that would otherwise map to an intent — e.g.
 * `+` or `0` typed into some future in-timeline text field).
 */
export function timelineKeyIntent(event: TimelineKeyEvent): TimelineKeyIntent | null {
  if (isTextInputTarget(event.target)) return null

  switch (event.key) {
    case '+':
    case '=':
      return { type: 'zoom-in' }
    case '-':
    case '_':
      return { type: 'zoom-out' }
    case 'ArrowLeft':
      return { type: 'step', direction: 'prev' }
    case 'ArrowRight':
      return { type: 'step', direction: 'next' }
    case ' ':
    case 'Spacebar': // legacy value some browsers still send
      return { type: 'toggle-play' }
    case '0':
    case 'Home':
      return { type: 'fit-all' }
    default:
      return null
  }
}
