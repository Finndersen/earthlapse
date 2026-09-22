/**
 * Pure mapping behind the browser's section index rail (`EventBrowser.tsx`) — a phone contacts
 * app's A-Z rail, but for era/section names. Two directions, both pure functions of the already-
 * sorted, already-filtered result list, never of the timeline's own scale:
 *
 * - `buildRailEntries` walks the list once and records where each new `browseGroupSection`
 *   begins, as a 0..1 fraction of the list's own length — event-count-proportional, not time-
 *   proportional, which is what makes a rail position map directly onto a list scroll position: a
 *   section holding a third of the matching events occupies a third of the rail, whatever its
 *   real span in years. No fisheye, no symlog — those warp a *time* axis, and this axis is a flat
 *   row count.
 * - `railEntryAtFraction` is the inverse: given a pointer position on the rail as the same 0..1
 *   fraction, the entry whose own span it falls in.
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
      abbreviation: section.abbreviation,
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
