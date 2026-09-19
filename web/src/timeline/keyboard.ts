/**
 * Keyboard intents for the timeline (README §2: "←/→ step to the previous/next event, space
 * play/pause"; ADR-024, amended by follow-up pass item 6: Escape/Backspace leaves the current
 * era section for its parent, Home/`0` jumps back to Earth (the root section), and
 * PageUp-PageDown/Shift+←→ step to the previous/next sibling section, wrapping to the parent's
 * own next/previous sibling at either end exactly as playback's section-continuation rule does
 * (`sections.ts`'s `continuationSection`/`previousSiblingStep`); follow-up pass item 3: `[`/`]`
 * and `-`/`=` step the playback speed through `playback.ts`'s `SPEED_OPTIONS`). A pure key ->
 * intent mapping, kept separate from the DOM listener that wires it up (`Timeline`'s root
 * `onKeyDown`, which fires only while focus is somewhere inside the component — see that
 * component for why that alone is enough to not "hijack typing elsewhere" without a global
 * listener) so the mapping itself is directly unit-testable.
 *
 * Checked for conflicts against every other in-app `Escape`/arrow-key handler (follow-up pass
 * item 6, corrected in the re-review pass below): `shell/Panel` stops `Escape` propagating while
 * open, so it never reaches this mapping until it's closed — including the event feed's own
 * `EventDetailPanel` (follow-up pass item 12, `shell/Panel` underneath), which replaced
 * `EventFeed`'s old in-place card expand and its own bespoke `Escape` handler. `ClusterPopover`
 * does the same, but — unlike the claim an earlier pass made here — it is *not* outside
 * `Timeline`'s DOM subtree: `ScrubTrack` renders it directly, so it only works because it also
 * stops propagation, same as `Panel`. Two overlays neither of those covers, `LayerChart` (the
 * chart dock) and the expanded `Globe`, mount their own `window`-level `Escape` listeners instead
 * (outside React's tree entirely, so `stopPropagation` can't reach them either way) — `Timeline`
 * is told one of them is open via its own `overlayOpen` prop and skips `'leave-section'` for a
 * bare `Escape` while it's true, leaving that keypress to whichever overlay's own listener closes
 * it, instead of also climbing a section (see `Timeline.tsx`'s doc comment and `handleKeyDown`).
 * Plain `ArrowLeft`/`ArrowRight` (no Shift) keep stepping through events/checkpoints exactly as
 * before — only the `Shift`-held chord is new.
 */

/** Tag names that should swallow every key this module maps, even when a focusable timeline
 *  descendant happens to contain one (there is none today, but keeping the check here rather
 *  than relying on "the timeline just doesn't have text inputs" keeps the contract explicit
 *  and future-proof — see README §2's own wording). */
const TEXT_INPUT_TAGS = new Set(['INPUT', 'TEXTAREA'])

/** Review fix (follow-up pass re-review, 2026-09-15): this pass moved real interactive controls
 *  — the sound toggle button, the Symlog/Linear buttons, the era-navigation buttons — into the
 *  timeline's own keydown subtree (`Timeline.tsx`'s root `onKeyDown`). `TEXT_INPUT_TAGS` alone
 *  isn't enough for those: a focused `<button>`'s native activation key is Space, and a focused
 *  `<select>`'s own browser-handled keys include Home/End/PageUp/PageDown to move its value —
 *  both were being intercepted by this module's identically-keyed intents before either control
 *  ever saw them. `' '`/`'Spacebar'` is swallowed whenever the target is itself a button (native
 *  or `role="button"`), and `Home`/`0`/`PageUp`/`PageDown` are swallowed for a focused `<select>`
 *  — narrow, key-specific guards rather than widening `TEXT_INPUT_TAGS`, since every other key
 *  this module maps (Escape/Backspace, arrows) has no native meaning on either element and stays
 *  usable from them exactly as before. */
function isButtonTarget(target: EventTarget | null): boolean {
  return target instanceof Element && (target.tagName === 'BUTTON' || target.getAttribute('role') === 'button')
}

function isSelectTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.tagName === 'SELECT'
}

export type TimelineKeyIntent =
  | { type: 'step'; direction: 'prev' | 'next' }
  | { type: 'toggle-play' }
  | { type: 'leave-section' }
  | { type: 'go-to-root' }
  | { type: 'step-sibling'; direction: 'next' | 'previous' }
  | { type: 'speed'; direction: 'up' | 'down' }

/** The subset of a real `KeyboardEvent` this module needs, so tests can pass plain objects
 *  instead of constructing DOM events. */
export interface TimelineKeyEvent {
  key: string
  target: EventTarget | null
  /** Only `ArrowLeft`/`ArrowRight` read this, to pick `'step'` (event/checkpoint stepping) vs
   *  `'step-sibling'` (era navigation) apart. Defaults to `false`, so existing call sites/tests
   *  that construct a plain `{ key, target }` keep mapping to plain `'step'`. */
  shiftKey?: boolean
}

function isTextInputTarget(target: EventTarget | null): boolean {
  return target instanceof Element && TEXT_INPUT_TAGS.has(target.tagName)
}

/** Display strings for the previous/next sibling-section shortcut's keys, shown in
 *  `SectionEdgeButton`'s own tooltips — one source so they can't drift from what
 *  `timelineKeyIntent` actually maps below. `SectionBreadcrumb` used to carry a matching pair for
 *  "leave section" (Escape/Backspace) and "go to root" (Home/`0`) on its own now-deleted "‹ Up"/
 *  "⌂ Earth" buttons (user ask, 2026-09-18: both removed outright, not replaced — the parent and
 *  root are always one click away as trail crumbs already); those two hint strings went with
 *  them, since nothing else displayed them. The keyboard shortcuts themselves are untouched. */
export const NEXT_SECTION_KEY_HINT = 'Shift+→ or Page Down'
export const PREVIOUS_SECTION_KEY_HINT = 'Shift+← or Page Up'

/**
 * Maps a keydown to the intent it represents, or `null` for a key this component doesn't
 * handle (letting it propagate normally) or when `event.target` is a text input/textarea
 * (typing must never be hijacked, even by a key that would otherwise map to an intent — e.g.
 * `+` or `0` typed into some future in-timeline text field).
 */
export function timelineKeyIntent(event: TimelineKeyEvent): TimelineKeyIntent | null {
  if (isTextInputTarget(event.target)) return null

  switch (event.key) {
    case 'ArrowLeft':
      return event.shiftKey ? { type: 'step-sibling', direction: 'previous' } : { type: 'step', direction: 'prev' }
    case 'ArrowRight':
      return event.shiftKey ? { type: 'step-sibling', direction: 'next' } : { type: 'step', direction: 'next' }
    case 'PageUp':
      return isSelectTarget(event.target) ? null : { type: 'step-sibling', direction: 'previous' }
    case 'PageDown':
      return isSelectTarget(event.target) ? null : { type: 'step-sibling', direction: 'next' }
    case ' ':
    case 'Spacebar': // legacy value some browsers still send
      return isButtonTarget(event.target) ? null : { type: 'toggle-play' }
    case 'Escape':
    case 'Backspace':
      return { type: 'leave-section' }
    case 'Home':
    case '0':
      return isSelectTarget(event.target) ? null : { type: 'go-to-root' }
    case '[':
    case '-':
      return { type: 'speed', direction: 'down' }
    case ']':
    case '=':
      return { type: 'speed', direction: 'up' }
    default:
      return null
  }
}
