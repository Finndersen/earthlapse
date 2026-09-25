'use client'

/**
 * The shared About/Controls/Credits content — self-contained (it loads the manifest itself) so
 * it can be dropped into either surface that shows it: the About & credits panel and the
 * `/credits` route (`app/credits/page.tsx`), with one implementation instead of two. Four
 * sections, in order:
 *
 * 1. **About** — what the project is, what it covers, and the artistic-reconstruction
 *    disclosure (VISUAL_SPEC §9), which used to sit in `ShellLayout`'s always-on footer row and
 *    now shows only here, as the first line a viewer sees on opening this content. Followed by
 *    the author byline, the repo link, a slot for the feedback link
 *    (`CreditsListProps.feedbackLink`) — the same "supplied by the caller" reasoning as
 *    `eventLegend` below, since only the feedback link needs live store state — and the built
 *    commit's version (`version.ts`).
 * 2. **Controls & shortcuts** (`ControlsShortcuts.tsx`) — added because the timeline's first-use
 *    hint, previously the only place interactions and keyboard shortcuts were explained, was
 *    removed (ADR-012 amendment follow-up, 2026-09-18); this is now the one place they're
 *    documented, kept in sync with `timeline/keyboard.ts` by `controlsData.test.ts`.
 * 3. **Event colours** — a slot for the event colour legend, a small reference a viewer wants at
 *    most occasionally, so it lives here rather than claiming any of the event feed's own tight
 *    vertical budget permanently. See `CreditsListProps.eventLegend` below for why this
 *    component doesn't import `EventTagLegend` itself.
 * 4. **Credits** — every real dataset behind the project and the audio stem credits.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import type { AudioStem, Credit } from '@/types/manifest'

import { ControlsShortcuts } from './ControlsShortcuts'
import { loadManifest } from './manifest'
import { siteVersion } from './version'
import styles from './CreditsList.module.css'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; credits: Credit[]; audioStems: AudioStem[]; isStub: boolean }

export interface CreditsListProps {
  /** The event colour legend (`@/events`'s `EventTagLegend`), rendered under its own "Event
   *  colours" heading, before the credits — supplied by the caller rather than imported here (re-review fix,
   *  2026-09-15: `shell` no longer imports `@/events` at all — see this file's own doc comment).
   *  Optional so a caller with nothing to show there can omit the section entirely. */
  eventLegend?: ReactNode
  /** The "Report a bug or give feedback" link, supplied by the caller for the same reason as
   *  `eventLegend` above: it needs the live time-store state at the moment of the click, and
   *  `shell` must not import the store itself. Optional so a caller with nothing to show there
   *  (e.g. the standalone `/credits` page) can omit it — the static GitHub link still shows. */
  feedbackLink?: ReactNode
}

export function CreditsList({ eventLegend, feedbackLink }: CreditsListProps = {}) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const version = siteVersion(process.env.NEXT_PUBLIC_EARTHLAPSE_VERSION, process.env.NEXT_PUBLIC_EARTHLAPSE_COMMIT)

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
        Earthlapse is a scrubbable view of the planet's surface across all 4.6 billion years of its history,
        from the molten Hadean to the present — one continuous timeline, not a slideshow. The scenes above are
        generated; the data driving everything else — continents, climate, atmosphere, the tree of life,
        population — is real, drawn from paleoclimate proxies, geological and satellite surveys, phylogenetic
        trees and historical records, each cited below.
      </p>

      <p className={styles.byline}>Built by Finn Andersen</p>

      <p className={styles.links}>
        <a href="https://github.com/Finndersen/earthlapse" target="_blank" rel="noopener noreferrer">
          View source on GitHub
        </a>
        {feedbackLink}
        {version !== null && (
          <a href={version.href} target="_blank" rel="noopener noreferrer">
            Version {version.label}
          </a>
        )}
      </p>

      <h3 className={styles.sectionTitle}>Controls &amp; shortcuts</h3>
      <ControlsShortcuts />

      {eventLegend && (
        <>
          <h3 className={styles.sectionTitle}>Event colours</h3>
          <p className={styles.intro}>What each event feed card's primary tag colour means.</p>
          {eventLegend}
        </>
      )}

      <h3 className={styles.sectionTitle}>Credits</h3>
      <p className={styles.intro}>Every real dataset behind this project, with its citation and licence.</p>

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
        </>
      )}
    </div>
  )
}
