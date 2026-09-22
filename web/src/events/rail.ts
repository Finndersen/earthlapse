/**
 * Pure mapping behind the browser's section index rail (`EventBrowser.tsx`) — a phone contacts
 * app's A-Z rail, but for era/section names. Three parts, all pure functions of the already-
 * sorted, already-filtered result list (or of `buildRailEntries`' own output), never of the
 * timeline's own scale:
 *
 * - `buildRailEntries` walks the list once and records where each new `browseGroupSection`
 *   begins, as a 0..1 fraction of the list's own length — event-count-proportional, not time-
 *   proportional, which is what makes a rail position map directly onto a list scroll position: a
 *   section holding a third of the matching events occupies a third of the rail, whatever its
 *   real span in years. No fisheye, no symlog — those warp a *time* axis, and this axis is a flat
 *   row count. Its own `abbreviation` is `railAbbreviation`'s, not `section.abbreviation` as-is:
 *   the rail's column is far narrower than a `SectionBands` band, so it needs a tighter cap.
 * - `railEntryAtFraction` is the inverse: given a pointer position on the rail as the same 0..1
 *   fraction, the entry whose own span it falls in.
 * - `declutterRailLabels` decides which entries get their text drawn when event-count spacing
 *   packs several into the same few pixels (deep time, which holds far fewer events than human
 *   history) — every entry still gets a tick regardless; this only ever hides text.
 */

import type { SectionId } from '@/timeline'
import type { TimelineEvent } from '@/types/layer'

import { browseGroupSection } from './browse'
import { placementT } from './placement'

export interface RailEntry {
  sectionId: SectionId
  label: string
  abbreviation: string
  /** This section's first event, as an index into the result list. */
  startIndex: number
  /** `startIndex / events.length` — where the rail places this entry's label, and what a
   *  press/drag at that fraction resolves back to. */
  offset: number
}

/** Longest a rail label is ever drawn at, before a trailing "." — a `SectionBands` abbreviation
 *  ("Proterozoic" -> "Proteroz.") is still too wide for the rail's own narrow column; this cuts
 *  it again. */
const RAIL_ABBREVIATION_MAX_CHARS = 6

/** `section.abbreviation`, cut down to the rail's own tighter width budget. Unchanged when it
 *  already fits (e.g. "Modern", "Hadean"); otherwise the first `RAIL_ABBREVIATION_MAX_CHARS`
 *  characters plus a trailing "." ("Proteroz." -> "Proter.", "Industrial" -> "Indust."). The full
 *  name is never lost — `RailEntry.label` still carries it, for the drag bubble. */
function railAbbreviation(sectionAbbreviation: string): string {
  if (sectionAbbreviation.length <= RAIL_ABBREVIATION_MAX_CHARS) return sectionAbbreviation
  return `${sectionAbbreviation.slice(0, RAIL_ABBREVIATION_MAX_CHARS).trimEnd()}.`
}

/** One entry per section change walking `events` in list order (already sorted by `browseEvents`
 *  — this does not itself sort). Empty list in, empty rail out. */
export function buildRailEntries(events: readonly TimelineEvent[]): RailEntry[] {
  if (events.length === 0) return []
  const entries: RailEntry[] = []
  let previousId: SectionId | null = null
  events.forEach((event, index) => {
    const section = browseGroupSection(placementT(event))
    if (section.id === previousId) return
    previousId = section.id
    entries.push({
      sectionId: section.id,
      label: section.label,
      abbreviation: railAbbreviation(section.abbreviation),
      startIndex: index,
      offset: index / events.length,
    })
  })
  return entries
}

/** The entry a pointer at `fraction` (0..1 down the rail) lands on — the last entry whose own
 *  `offset` is at or before it. `null` for an empty rail. */
export function railEntryAtFraction(entries: readonly RailEntry[], fraction: number): RailEntry | null {
  if (entries.length === 0) return null
  const clamped = Math.min(1, Math.max(0, fraction))
  let chosen = entries[0]!
  for (const entry of entries) {
    if (entry.offset > clamped) break
    chosen = entry
  }
  return chosen
}

export interface RailLabelPlacement {
  entry: RailEntry
  /** Whether this entry's text should be drawn. Every entry gets a tick either way — this only
   *  ever hides the label text, never a section's own place on the rail. */
  visible: boolean
}

/** Minimum vertical gap, in px, two rail labels need before they're treated as colliding —
 *  `EventBrowser.module.css`'s `.railLabel` is an 8.5px mono line; this leaves enough clearance
 *  that two kept labels never visually merge. */
export const MIN_RAIL_LABEL_GAP_PX = 13

/**
 * Which of `entries`' labels to actually draw, given the rail's own rendered height. `offset` is
 * event-count-proportional, not spacing-proportional (`buildRailEntries`' own doc comment), so
 * several entries can land within one label's height of each other — deep time, which holds far
 * fewer events than human history, is the recurring case. Walks oldest to newest and keeps a
 * label only once it clears `minGapPx` from the last label actually kept, so the oldest section's
 * label is never the one dropped and a run of crowded entries thins to roughly one label per
 * `minGapPx`, not zero.
 */
export function declutterRailLabels(
  entries: readonly RailEntry[],
  railHeightPx: number,
  minGapPx: number = MIN_RAIL_LABEL_GAP_PX,
): RailLabelPlacement[] {
  let lastShownPx = -Infinity
  return entries.map((entry) => {
    const px = entry.offset * railHeightPx
    const visible = px - lastShownPx >= minGapPx
    if (visible) lastShownPx = px
    return { entry, visible }
  })
}
