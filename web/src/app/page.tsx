'use client'

import { useEffect, useState } from 'react'

import { loadManifest, ShellLayout } from '@/shell'
import { useTimeStore } from '@/store/time'
import { EARTH_FORMATION } from '@/types/layer'
import type { Manifest, Scene } from '@/types/manifest'

import styles from './page.module.css'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; manifest: Manifest; isStub: boolean }

function formatGeoTime(t: number): string {
  if (t === 0) return 'present'
  if (t < 1e3) return `${t.toFixed(0)} years ago`
  if (t < 1e6) return `${(t / 1e3).toFixed(1)} kyr ago`
  if (t < 1e9) return `${(t / 1e6).toFixed(1)} Myr ago`
  return `${(t / 1e9).toFixed(2)} Gyr ago`
}

function nearestScene(scenes: Scene[], t: number): Scene | null {
  if (scenes.length === 0) return null
  return scenes.reduce((closest, s) => (Math.abs(s.t - t) < Math.abs(closest.t - t) ? s : closest))
}

export default function Page() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const t = useTimeStore((s) => s.t)
  const setT = useTimeStore((s) => s.setT)

  useEffect(() => {
    let cancelled = false
    loadManifest()
      .then(({ manifest, isStub }) => {
        if (!cancelled) setState({ status: 'ready', manifest, isStub })
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

  if (state.status === 'loading') {
    return <main className={styles.centered}>Loading manifest…</main>
  }

  if (state.status === 'error') {
    return (
      <main className={styles.errorPanel}>
        <div className={styles.errorCard}>
          <p className={styles.errorTitle}>Manifest failed to load</p>
          <p className={styles.errorMessage}>{state.error.message}</p>
        </div>
      </main>
    )
  }

  const { manifest, isStub } = state
  const scene = nearestScene(manifest.scenes, t)

  return (
    <ShellLayout
      globe={<div className={styles.placeholder}>Globe view (web/globe, W8)</div>}
      hud={
        <div>
          {manifest.layers
            .filter((l) => l.surface === 'hud')
            .map((l) => (
              <div key={l.id} className={styles.layerRow}>
                <span className={styles.layerName}>{l.name}</span>
                <span className={styles.layerMeta}>{l.unit ?? l.dataKind}</span>
              </div>
            ))}
        </div>
      }
      ancestor={<div className={styles.placeholder}>Ancestor readout (web/layers, W10)</div>}
      caption={<p className={styles.captionText}>{scene?.caption ?? 'No scene at this time.'}</p>}
      scene={
        scene ? (
          // Plain <img>, not next/image: images.unoptimized is set for the static export, and
          // scene.image is an arbitrary manifest-supplied path next/image can't size statically.
          <img className={styles.sceneImage} src={`${manifest.assetBase}/${scene.image}`} alt={scene.caption} />
        ) : (
          <div className={styles.placeholder}>No scene generated at this time.</div>
        )
      }
      timeline={
        <div className={styles.readout}>
          {isStub && <span className={styles.stubBadge}>Stub data</span>}
          <span className={styles.tLabel}>t — years before present</span>
          <div className={styles.scrubRow}>
            <span className={styles.tValue}>{formatGeoTime(t)}</span>
            <input
              className={styles.scrub}
              type="range"
              min={0}
              max={EARTH_FORMATION}
              step={EARTH_FORMATION / 10000}
              value={t}
              onChange={(e) => setT(Number(e.target.value))}
              aria-label="Scrub time"
            />
          </div>
        </div>
      }
      chart={<div className={styles.placeholder}>Expanded chart dock (web/layers, W10)</div>}
    />
  )
}
