'use client'

/** The Dinosaurs/Humans "jump to an era" shortcuts, plain aliases for two existing sections
 *  (`../eraShortcuts.ts`'s own doc comment has the full reasoning for which two and why). Rendered
 *  by `ShellLayout` directly under the time title (`.eraShortcuts`), not in the timeline's control
 *  row. Nothing around it there carries a caps-mono label, and the two pills — an icon plus
 *  "DINOSAURS"/"HUMANS" — already say what they are, so the group's name is an `aria-label` rather
 *  than a drawn heading: a visible "Eras" only crowded the era name already printed directly above
 *  it, on a phone most of all.
 *  Every entry is a plain alias: clicking it calls the exact same `onSelectSection` a section
 *  band, breadcrumb crumb or edge-nav button already calls, with the section id
 *  `../eraShortcuts.ts` pairs it with — never a second selection mechanism. */

import type { ReactNode } from 'react'

import { ERA_SHORTCUTS, isEraShortcutActive } from '../eraShortcuts'
import { formatTimeRange } from '../format'
import type { SectionId } from '../sections'
import styles from './EraShortcuts.module.css'

/** A restrained line-glyph per shortcut (this floats over a photograph, so no filled icon, no
 *  colour of its own — `currentColor` only, matching the caps-mono label beside it). Deliberately
 *  abstract rather than literal so neither risks reading as kitsch: a three-toed fossil track for
 *  the dinosaur era, a plain standing figure for the human one. A `switch` over `ERA_SHORTCUTS`'
 *  own ids, not a lookup table, so a shortcut added without a matching case throws immediately
 *  instead of silently rendering an empty slot. */
function eraShortcutIcon(id: SectionId): ReactNode {
  switch (id) {
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
    <div className={styles.group} role="group" aria-label="Eras" data-testid="era-shortcuts">
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
