'use client'

/**
 * The credits content itself — every real dataset behind the project plus audio stem credits —
 * self-contained (it loads the manifest itself) so it can be dropped into either surface that
 * shows it: the About & credits panel and the `/credits` route (`app/credits/page.tsx`), with
 * one implementation instead of two. Leads with the artistic-reconstruction disclosure
 * (VISUAL_SPEC §9), which used to sit in `ShellLayout`'s always-on footer row and now shows only
 * here, the first time a viewer actually opens credits. Also carries a slot for the event colour
 * legend (W-followup item 11) — a small reference a viewer wants at most occasionally, so it
 * lives here rather than claiming any of the event feed's own tight vertical budget permanently.
 * See `CreditsListProps.eventLegend` below for why this component doesn't import
 * `EventTagLegend` itself.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import type { AudioStem, Credit } from '@/types/manifest'

import { loadManifest } from './manifest'
import styles from './CreditsList.module.css'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; credits: Credit[]; audioStems: AudioStem[]; isStub: boolean }

export interface CreditsListProps {
  /** The event colour legend (`@/events`'s `EventTagLegend`), rendered under its own "Event
   *  colours" heading below — supplied by the caller rather than imported here (re-review fix,
   *  2026-09-15: `shell` no longer imports `@/events` at all — see this file's own doc comment).
   *  Optional so a caller with nothing to show there can omit the section entirely. */
  eventLegend?: ReactNode
}

export function CreditsList({ eventLegend }: CreditsListProps = {}) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    loadManifest()
      .then(({ manifest, isStub }) => {
        if (!cancelled) setState({ status: 'ready', credits: manifest.credits, audioStems: manifest.audioStems, isStub })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', error: error instanceof Error ? error : new Error(String(error)) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className={styles.wrap}>
      <p className={styles.disclaimer}>Artistic reconstruction — plausibility, not accuracy.</p>
      <p className={styles.intro}>
        Every real dataset behind this project, with its citation and licence. The view of Earth's surface is
        generated; the data underneath it is not.
      </p>

      {state.status === 'loading' && <p className={styles.status}>Loading…</p>}

      {state.status === 'error' && <p className={styles.statusError}>Failed to load credits: {state.error.message}</p>}

      {state.status === 'ready' && (
        <>
          {state.isStub && <p className={styles.stubNotice}>Showing stub credits — no published manifest found.</p>}
          <ul className={styles.list}>
            {state.credits.map((c) => (
              <li key={c.sourceId} className={styles.item}>
                <h3 className={styles.itemTitle}>{c.title}</h3>
                <p className={styles.itemCitation}>{c.citation}</p>
                <p className={styles.itemMeta}>
                  <span>{c.licence}</span>
                  {c.url !== '' && (
                    <a href={c.url} target="_blank" rel="noreferrer">
                      {c.url}
                    </a>
                  )}
                </p>
              </li>
            ))}
          </ul>

          {state.audioStems.length > 0 && (
            <>
              <h3 className={styles.sectionTitle}>Sound</h3>
              <p className={styles.intro}>
                Ambience stems (ADR-023) — CC0/public-domain audio, credited individually since one source bundles
                several independently-licensed files.
              </p>
              <ul className={styles.list}>
                {state.audioStems.map((stem) => (
                  <li key={stem.id} className={styles.item}>
                    <h4 className={styles.itemTitle}>{stem.title}</h4>
                    <p className={styles.itemCitation}>{stem.author}</p>
                    <p className={styles.itemMeta}>
                      <span>{stem.licence}</span>
                      {stem.sourceUrl !== '' && (
                        <a href={stem.sourceUrl} target="_blank" rel="noreferrer">
                          {stem.sourceUrl}
                        </a>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}

          {eventLegend && (
            <>
              <h3 className={styles.sectionTitle}>Event colours</h3>
              <p className={styles.intro}>What each event feed card's primary tag colour means.</p>
              {eventLegend}
            </>
          )}
        </>
      )}
    </div>
  )
}
