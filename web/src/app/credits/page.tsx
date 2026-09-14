'use client'

import { useEffect, useState } from 'react'

import { loadManifest } from '@/shell'
import type { AudioStem, Credit } from '@/types/manifest'

import styles from './credits.module.css'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; credits: Credit[]; audioStems: AudioStem[]; isStub: boolean }

export default function CreditsPage() {
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
    <main className={styles.page}>
      <div className={styles.wrap}>
        <a className={styles.back} href="/">
          ← Back to the timeline
        </a>
        <h1 className={styles.title}>Credits</h1>
        <p className={styles.intro}>
          Every real dataset behind this project, with its citation and licence. The view of Earth's
          surface is generated; the data underneath it is not.
        </p>

        {state.status === 'loading' && <p className={styles.status}>Loading…</p>}

        {state.status === 'error' && <p className={styles.statusError}>Failed to load credits: {state.error.message}</p>}

        {state.status === 'ready' && (
          <>
            {state.isStub && <p className={styles.stubNotice}>Showing stub credits — no published manifest found.</p>}
            <ul className={styles.list}>
              {state.credits.map((c) => (
                <li key={c.sourceId} className={styles.item}>
                  <h2 className={styles.itemTitle}>{c.title}</h2>
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
                <h2 className={styles.sectionTitle}>Sound</h2>
                <p className={styles.intro}>
                  Ambience stems (ADR-023) — CC0/public-domain audio, credited individually since one source
                  bundles several independently-licensed files.
                </p>
                <ul className={styles.list}>
                  {state.audioStems.map((stem) => (
                    <li key={stem.id} className={styles.item}>
                      <h3 className={styles.itemTitle}>{stem.title}</h3>
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
    </main>
  )
}
