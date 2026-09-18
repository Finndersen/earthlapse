/**
 * The three always-visible "jump to an era" shortcuts (user ask, 2026-09-18, superseding an
 * earlier single "Human story"/"Human history" brief — see this module's own history in
 * DECISIONS.md ADR-024's amendments for why both a purpose-made 300 ka span and a bare Holocene
 * alias were each considered and replaced by this small group).
 *
 * Each entry is a plain alias for selecting an existing, already-cited `TimelineSection`
 * (ADR-024) — never a new node in the tree and never a purpose-made window. Clicking one calls
 * exactly the same `onSelectSection`/`selectSection` every band and breadcrumb button already
 * calls, with the section id below; there is no second selection mechanism here.
 *
 * - **Earth** -> `ROOT_SECTION_ID`, the full 4.6 Gyr domain. This is the exact destination the
 *   breadcrumb's "⌂ Earth" button and the Home/`0` keyboard shortcut already reach — this shares
 *   that same id rather than a second path to the same place.
 * - **Dinosaurs** -> the Mesozoic (251.9-66 Ma). An honest fit, not a stretch: non-avian
 *   dinosaurs appear around 230 Ma, in the Triassic, and the Mesozoic's own younger boundary
 *   *is* the K-Pg extinction that ends them. The only slop is the Mesozoic's first ~20 Myr,
 *   before dinosaurs themselves appear.
 * - **Humans** -> the Holocene (11.7 ka-present). Not the species' full ~300 ka existence — the
 *   human asked for that first, then reviewed this build's actual content density and reversed
 *   it: 30 of 32 human-era scenes, every curated city, the population layer and most arrival
 *   markers all fall inside the Holocene, so it is the section that is actually rich, not merely
 *   the closest existing tree boundary.
 *
 * Nicknames are deliberately plain language, not the section's own geological `label` — pair a
 * nickname with its `section` (id, `label`, `window`) wherever it renders so the real unit stays
 * discoverable (a tooltip, say) rather than letting "Dinosaurs" or "Humans" masquerade as a
 * geological name in its own right. Once selected, the breadcrumb and section bands still show
 * the section's real `label` ("Mesozoic", "Holocene") — this module never overrides that.
 */

import { ROOT_SECTION_ID, sectionById, sectionPath, type SectionId, type TimelineSection } from './sections'

export interface EraShortcut {
  id: SectionId
  /** Plain-language nickname shown in the control — never the section's own `label`. */
  nickname: string
  /** The real section this aliases, read for its `label`/`window`/`citation` so a caller can
   *  always say what the nickname actually selects. */
  section: TimelineSection
}

export const ERA_SHORTCUTS: readonly EraShortcut[] = [
  { id: ROOT_SECTION_ID, nickname: 'Earth', section: sectionById(ROOT_SECTION_ID) },
  { id: 'mesozoic', nickname: 'Dinosaurs', section: sectionById('mesozoic') },
  { id: 'holocene', nickname: 'Humans', section: sectionById('holocene') },
]

/**
 * Whether the timeline's current `sectionId` reads as "inside" `shortcut` — true for the
 * shortcut's own section and for any section nested under it (drilling from "Dinosaurs" down
 * into "Cretaceous", say, still reads as being inside the dinosaur era). The root shortcut
 * ("Earth") is the one exception: every section's path includes the root by construction
 * (`sectionPath` always starts there), so "ancestor of" would make it read as permanently active
 * regardless of the real selection — instead it is active only at an exact match, the same rule
 * `SectionBreadcrumb`'s own "Back to Earth" button uses (`sectionId === ROOT_SECTION_ID`).
 */
export function isEraShortcutActive(shortcut: EraShortcut, sectionId: SectionId): boolean {
  if (shortcut.id === ROOT_SECTION_ID) return sectionId === ROOT_SECTION_ID
  return sectionPath(sectionId).some((section) => section.id === shortcut.id)
}
