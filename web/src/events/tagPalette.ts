/**
 * The event tag colour palette (ADR-022 names six closed `EventTag`s, and defers colouring the
 * timeline by them to "a later task"). Defined once, here, so this feed and that later
 * timeline work share one legend rather than inventing their own colours independently —
 * `<EventFeed>` is the first consumer; a future `timeline` package chip/legend should import
 * `EVENT_TAG_PALETTE` from `@/events` rather than re-declare it.
 *
 * Muted enough to sit quietly in the HUD periphery next to the existing `--hud-accent` amber
 * and `--hud-event` blue (`app/globals.css`), distinct enough from each other and from both of
 * those to read as a small legend at a glance.
 */

import type { EventTag } from '@/types/layer'

export interface EventTagStyle {
  label: string
  /** A flat hex swatch — CSS custom properties are for the shared HUD tokens, not for a
   *  six-way enum a component swatches directly. */
  color: string
}

export const EVENT_TAG_PALETTE: Record<EventTag, EventTagStyle> = {
  life: { label: 'Life', color: '#8fcf8a' },
  'earth-climate': { label: 'Earth & climate', color: '#8cc8ff' },
  catastrophe: { label: 'Catastrophe', color: '#e2685c' },
  'human-origins': { label: 'Human origins', color: '#e8b06a' },
  society: { label: 'Society', color: '#c9a6e8' },
  'science-technology': { label: 'Science & technology', color: '#7fd8d0' },
}

/** An event's primary tag (ADR-022: "the first is its primary tag") when it carries any, else
 *  `undefined` — for an event published before `tags` existed, or one with an empty list
 *  (which the schema forbids server-side, but the wire type stays optional for old data). */
export function primaryTag(event: { tags?: EventTag[] }): EventTag | undefined {
  return event.tags?.[0]
}
