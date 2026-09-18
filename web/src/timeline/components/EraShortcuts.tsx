'use client'

/** The three always-visible "jump to an era" shortcuts — Earth / Dinosaurs / Humans, plain
 *  aliases for three existing sections (`../eraShortcuts.ts`'s own doc comment has the full
 *  reasoning for which three and why).
 *
 *  **Placement history** (four homes, all user-driven, 2026-09-18): its own row beside the
 *  shell's title (ADR-012 amendment) → folded into `Timeline.tsx`'s `.controlsSections`, beside
 *  the breadcrumb ("move the earth/dinosaurs/humans era shortcuts down to the bottom above the
 *  timeline") → back beside the title, first stacked under it then beside it in a three-track
 *  grid ("i dont really like the era shrotcuts and breadcrumbs being close next to each other
 *  like that, it looks a bit cluttered", then "moving era shortcuts to the side of the current
 *  year... to save vertical space") → and finally back to `.controlsSections` once more, this
 *  time actually landing where the second move was aiming ("move it back down to below the
 *  timelie... not so close to the breadcrumbs... justifeid to hte right so its closer to the
 *  play/reiard/ff nav controls") — `Timeline.module.css`'s `.controlsSections` doc comment has
 *  the current `justify-content: space-between` layout that pins the breadcrumb left and this
 *  group right, next to `.controlsCore`, without loading the already-crowded `.controlsSecondary`
 *  track (measured and rejected first — that file's own comment has the numbers).
 *
 *  Every entry is a plain alias: clicking it calls the exact same `onSelectSection` a section
 *  band, breadcrumb crumb or edge-nav button already calls, with the section id
 *  `../eraShortcuts.ts` pairs it with — never a second selection mechanism. */

import type { ReactNode } from 'react'

import { ERA_SHORTCUTS, isEraShortcutActive } from '../eraShortcuts'
import { formatTimeRange } from '../format'
import type { SectionId } from '../sections'
import styles from './EraShortcuts.module.css'

/** A restrained line-glyph per shortcut (this floats over a photograph, so no filled icon, no
 *  colour of its own — `currentColor` only, matching the caps-mono label beside it).
 *  Deliberately abstract rather than literal so none of the three risks reading as kitsch: a
 *  globe for the whole planet, a three-toed fossil track for the dinosaur era, and a plain
 *  standing figure for the human one. A `switch` over `ERA_SHORTCUTS`' own ids, not a lookup
 *  table, so a shortcut added without a matching case throws immediately instead of silently
 *  rendering an empty slot. */
function eraShortcutIcon(id: SectionId): ReactNode {
  switch (id) {
    case 'earth':
      return (
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.1">
          <circle cx="8" cy="8" r="6.5" />
          <ellipse cx="8" cy="8" rx="2.6" ry="6.5" />
          <line x1="1.6" y1="8" x2="14.4" y2="8" />
        </svg>
      )
    case 'mesozoic':
      return (
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
          <ellipse cx="8" cy="10.6" rx="3.3" ry="2.8" />
          <ellipse cx="4.5" cy="5.6" rx="1.1" ry="1.8" transform="rotate(-20 4.5 5.6)" />
          <ellipse cx="8" cy="4.4" rx="1.1" ry="2" />
          <ellipse cx="11.5" cy="5.6" rx="1.1" ry="1.8" transform="rotate(20 11.5 5.6)" />
        </svg>
      )
    case 'holocene':
      return (
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
          <circle cx="8" cy="3.2" r="1.55" />
          <path d="M8 5.1 V10 M8 6.6 L4.8 8.3 M8 6.6 L11.2 8.3 M8 10 L5.4 14.3 M8 10 L10.6 14.3" />
        </svg>
      )
    default:
      throw new Error(`eraShortcutIcon: no icon for era shortcut '${id}'`)
  }
}

interface EraShortcutsProps {
  sectionId: SectionId
  onSelectSection: (id: SectionId) => void
}

export function EraShortcuts({ sectionId, onSelectSection }: EraShortcutsProps) {
  return (
    <div className={styles.group} role="group" aria-label="Jump to an era" data-testid="era-shortcuts">
      {ERA_SHORTCUTS.map((shortcut) => {
        const active = isEraShortcutActive(shortcut, sectionId)
        // Short form for the accessible name ("Dinosaurs — the Mesozoic"), the exact unit named
        // so the nickname never masquerades as a geological name of its own; the hover `title`
        // adds the section's own cited span for anyone who wants it.
        const unitName = `${shortcut.nickname} — the ${shortcut.section.label}`
        return (
          <button
            key={shortcut.id}
            type="button"
            className={styles.shortcut}
            aria-current={active ? 'location' : undefined}
            aria-label={unitName}
            title={`${unitName} (${formatTimeRange(shortcut.section.window)})`}
            onClick={() => onSelectSection(shortcut.id)}
          >
            <span className={styles.icon} aria-hidden="true">
              {eraShortcutIcon(shortcut.id)}
            </span>
            <span className={styles.label}>{shortcut.nickname}</span>
          </button>
        )
      })}
    </div>
  )
}
