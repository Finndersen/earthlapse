'use client'

/** The era-section breadcrumb (ADR-024), for example Earth › Cenozoic › Quaternary › Holocene ›
 *  Industrial age. Each ancestor is a button that zooms back out to it. The selected section
 *  is plain text with `aria-current="location"`. At the root section nothing renders. On a narrow row the middle ancestors (not the
 *  root, not the immediate parent) collapse to "…". Their buttons keep the full name as their
 *  accessible name and title, so they stay reachable.
 *
 *  Just the trail — no shortcut buttons of its own (user ask, 2026-09-18, reversing follow-up
 *  pass item 6, which flanked it with four). The root crumb here is always labelled "Earth" and
 *  already navigates to the root, so a separate "⌂ Back to Earth" button beside it added nothing;
 *  the parent section is always present in the trail as its own clickable crumb, so a separate
 *  "‹ Up" button was one click that was already available another way. Both were deleted outright
 *  rather than replaced. The previous/next sibling-section buttons moved rather than deleted —
 *  they now flank the scrub track itself, at the edges of the section's own range
 *  (`SectionEdgeNav.tsx`), a more honest spot for a move that steps along the timeline than a
 *  breadcrumb showing where you already are. Every keyboard shortcut these four used to surface
 *  (`keyboard.ts`: Escape/Backspace, Home/`0`, PageUp-PageDown/Shift+←→) still works exactly as
 *  before — only the breadcrumb's own visible buttons are gone. */

import { formatTimeRange } from '../format'
import { sectionPath, type SectionId } from '../sections'
import styles from './SectionBreadcrumb.module.css'

interface SectionBreadcrumbProps {
  sectionId: SectionId
  onSelectSection: (id: SectionId) => void
}

export function SectionBreadcrumb({ sectionId, onSelectSection }: SectionBreadcrumbProps) {
  const path = sectionPath(sectionId)
  const lastIndex = path.length - 1
  // At the root the trail would be the single word "Earth" with nowhere to go, so there is no
  // trail and no navigation landmark at all; `Timeline.module.css` decides whether its row keeps
  // its height.
  if (lastIndex === 0) return null

  return (
    <nav aria-label="Timeline section" className={styles.breadcrumb}>
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
    </nav>
  )
}
