/**
 * Two always-visible "jump to an era" shortcuts, Dinosaurs and Humans — plain aliases for an
 * existing, already-cited `TimelineSection` (ADR-024), never a new tree node or a purpose-made
 * window. Clicking one calls the exact same `onSelectSection`/`selectSection` every band and
 * breadcrumb button already calls, with the section id below; there is no second selection
 * mechanism here. The equivalent "back to Earth" shortcut is the breadcrumb's own root segment,
 * which already selects `ROOT_SECTION_ID` — no separate pill for it.
 *
 * - **Dinosaurs** -> the Mesozoic (251.9-66 Ma). An honest fit, not a stretch: non-avian
 *   dinosaurs appear around 230 Ma, in the Triassic, and the Mesozoic's own younger boundary
 *   *is* the K-Pg extinction that ends them. The only slop is the Mesozoic's first ~20 Myr,
 *   before dinosaurs themselves appear.
 * - **Humans** -> the Holocene (11.7 ka-present), not the species' full ~300 ka existence: 30 of
 *   32 human-era scenes, every curated city, the population layer and most arrival markers all
 *   fall inside the Holocene, so it is the section that is actually rich, not merely the closest
 *   existing tree boundary.
 *
 * Nicknames are deliberately plain language, not the section's own geological `label` — pair a
 * nickname with its `section` (id, `label`, `window`) wherever it renders so the real unit stays
 * discoverable (a tooltip, say) rather than letting "Dinosaurs" or "Humans" masquerade as a
 * geological name in its own right. Once selected, the breadcrumb and section bands still show
 * the section's real `label` ("Mesozoic", "Holocene") — this module never overrides that.
 */

import { sectionById, sectionPath, type SectionId, type TimelineSection } from './sections'

export interface EraShortcut {
  id: SectionId
  /** Plain-language nickname shown in the control — never the section's own `label`. */
  nickname: string
  /** The real section this aliases, read for its `label`/`window`/`citation` so a caller can
   *  always say what the nickname actually selects. */
  section: TimelineSection
}

export const ERA_SHORTCUTS: readonly EraShortcut[] = [
  { id: 'mesozoic', nickname: 'Dinosaurs', section: sectionById('mesozoic') },
  { id: 'holocene', nickname: 'Humans', section: sectionById('holocene') },
]

/**
 * Whether the timeline's current `sectionId` reads as "inside" `shortcut` — true for the
 * shortcut's own section and for any section nested under it (drilling from "Dinosaurs" down
 * into "Cretaceous", say, still reads as being inside the dinosaur era).
 */
export function isEraShortcutActive(shortcut: EraShortcut, sectionId: SectionId): boolean {
  return sectionPath(sectionId).some((section) => section.id === shortcut.id)
}
