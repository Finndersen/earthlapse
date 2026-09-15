'use client'

/** The era-section breadcrumb (ADR-024), for example Earth › Cenozoic › Quaternary › Holocene ›
 *  Industrial age. Each ancestor is a button that zooms back out to it. The selected section
 *  is plain text with `aria-current="location"`. On a narrow row the middle ancestors (not the
 *  root, not the immediate parent) collapse to "…". Their buttons keep the full name as their
 *  accessible name and title, so they stay reachable.
 *
 *  Follow-up pass item 6 adds four visible shortcut buttons flanking the trail — "‹ Up" and
 *  "Earth" before it, "‹"/"›" (previous/next sibling section) after it — so the same moves the
 *  keyboard shortcuts make (`keyboard.ts`: Escape/Backspace, Home/`0`, PageUp-PageDown/Shift+←→)
 *  are reachable and discoverable without them. Each button's `title` names its shortcut; a
 *  button is `disabled` (kept in place, not removed, so the row's width never jumps) rather than
 *  hidden when the move it represents has nowhere to go — at the root for "Up"/"Earth", or at
 *  either end of the tree's first/last branch for "‹"/"›". All four resolve their target the
 *  same way the keyboard shortcuts do (`sections.ts`'s `parentSection`/`ROOT_SECTION_ID`/
 *  `continuationSection`/`previousSiblingStep`) and report it through the same `onSelectSection`
 *  the trail and `Escape` already use. */

import { formatTimeRange } from '../format'
import { GO_TO_ROOT_KEY_HINT, LEAVE_SECTION_KEY_HINT, NEXT_SECTION_KEY_HINT, PREVIOUS_SECTION_KEY_HINT } from '../keyboard'
import { continuationSection, parentSection, previousSiblingStep, ROOT_SECTION_ID, sectionPath, type SectionId } from '../sections'
import styles from './SectionBreadcrumb.module.css'

interface SectionBreadcrumbProps {
  sectionId: SectionId
  onSelectSection: (id: SectionId) => void
}

export function SectionBreadcrumb({ sectionId, onSelectSection }: SectionBreadcrumbProps) {
  const path = sectionPath(sectionId)
  const lastIndex = path.length - 1

  const up = parentSection(sectionId)
  const atRoot = sectionId === ROOT_SECTION_ID
  const previous = previousSiblingStep(sectionId)
  const next = continuationSection(sectionId)

  return (
    <nav aria-label="Timeline section" className={styles.breadcrumb}>
      <div className={styles.actions} role="group" aria-label="Go up a level">
        <button
          type="button"
          className={styles.actionButton}
          disabled={up === undefined}
          aria-label={up === undefined ? 'Already at the top level' : `Up to ${up.label}`}
          title={up === undefined ? 'Already at the top level' : `Up to ${up.label} (${LEAVE_SECTION_KEY_HINT})`}
          onClick={() => up !== undefined && onSelectSection(up.id)}
        >
          {'‹ Up'}
        </button>
        <button
          type="button"
          className={styles.actionButton}
          disabled={atRoot}
          aria-label={atRoot ? 'Already showing the full timeline' : 'Back to Earth'}
          title={atRoot ? 'Already showing the full timeline' : `Back to Earth (${GO_TO_ROOT_KEY_HINT})`}
          onClick={() => !atRoot && onSelectSection(ROOT_SECTION_ID)}
        >
          {/* A home glyph, not the word "Earth" (re-review fix, 2026-09-15): the root crumb in
              the trail right beside this button is itself always labelled "Earth", so the two
              side by side used to read "EARTH EARTH" — a duplicated word that looked like a
              rendering glitch rather than two distinct controls. The accessible name/title above
              still say "Back to Earth" in full. */}
          <span aria-hidden="true">{'⌂'}</span>
        </button>
      </div>
      <ol className={styles.trail}>
        {path.map((section, index) => (
          <li key={section.id} className={styles.crumb} data-collapsible={index > 0 && index < lastIndex - 1}>
            {index === lastIndex ? (
              <span aria-current="location" className={styles.current} title={formatTimeRange(section.window)}>
                {section.label}
              </span>
            ) : (
              <button
                type="button"
                className={styles.link}
                aria-label={section.label}
                title={`${section.label} · ${formatTimeRange(section.window)}`}
                onClick={() => onSelectSection(section.id)}
              >
                <span className={styles.linkLabel}>{section.label}</span>
              </button>
            )}
          </li>
        ))}
      </ol>
      <div className={styles.actions} role="group" aria-label="Move to an adjacent section">
        <button
          type="button"
          className={styles.actionButton}
          disabled={previous === undefined}
          aria-label={previous === undefined ? 'No previous section' : `Previous section: ${previous.label}`}
          title={previous === undefined ? 'No previous section' : `Previous: ${previous.label} (${PREVIOUS_SECTION_KEY_HINT})`}
          onClick={() => previous !== undefined && onSelectSection(previous.id)}
        >
          {'‹'}
        </button>
        <button
          type="button"
          className={styles.actionButton}
          disabled={next === undefined}
          aria-label={next === undefined ? 'No next section' : `Next section: ${next.label}`}
          title={next === undefined ? 'No next section' : `Next: ${next.label} (${NEXT_SECTION_KEY_HINT})`}
          onClick={() => next !== undefined && onSelectSection(next.id)}
        >
          {'›'}
        </button>
      </div>
    </nav>
  )
}
