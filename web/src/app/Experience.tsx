'use client'

/**
 * W12a — the integration pass. Wires the real `timeline`, `globe`, `scene` and `layers`
 * packages into `ShellLayout` (W11), all driven from the single `t` in `useTimeStore` (W11).
 * This is the one place the playback loop lives (DESIGN §3): `usePlaybackLoop` +
 * `advancePlayhead` against the *full-domain* scale, writing `t` back to the store every
 * frame while playing.
 *
 * Manifest + every layer's data load together via `useAppData`; nothing renders until all of
 * it is in, so there is no partially-loaded state that could show a wrong value (a stale "0"
 * for a layer whose real data just hasn't arrived yet) — loading shows nothing, and any
 * failure is a loud full-page error, never a half-rendered page.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { Globe } from '@/globe'
import { AncestorReadout, DayLengthClock, LayerChart, ScalarReadout, Sparkline } from '@/layers'
import { dominantScene, sceneAt, SceneView } from '@/scene'
import { ShellLayout } from '@/shell'
import { useTimeStore } from '@/store/time'
import { advancePlayhead, createSymlogScale, Timeline, usePlaybackLoop } from '@/timeline'
import { EARTH_FORMATION } from '@/types/layer'
import type { GeoTime, Layer, ScalarValue, TimeScale } from '@/types/layer'

import { buildLayers } from './buildLayers'
import styles from './page.module.css'
import { useAppData } from './useAppData'

/** The full-domain symlog `TimeScale`, shared by the two things in this component that must
 *  not track the timeline's current zoom/scale-kind: `advancePlayhead`'s pacing (its own
 *  contract — playback speed is independent of zoom) and the HUD sparklines (a trend line
 *  that reads as a fixed miniature of all of history, not a mirror of the user's current
 *  zoom). Module scope: one stable `TimeScale`, computed once, not per render. */
const FULL_DOMAIN_SCALE: TimeScale = createSymlogScale([0, EARTH_FORMATION])

/** A `Layer<ScalarValue>` renders as a `DayLengthClock` rather than a `Sparkline` +
 *  `ScalarReadout` exactly when its unit is hours — `DayLengthClock`'s own doc comment
 *  ("for a `Layer<ScalarValue>` whose unit is hours") makes this the contract, not an id
 *  hard-coded here. */
function isClockLayer(unit: string | undefined): boolean {
  return unit === 'hours'
}

export function Experience() {
  const data = useAppData()

  const t = useTimeStore((s) => s.t)
  const setT = useTimeStore((s) => s.setT)
  const timeWindow = useTimeStore((s) => s.window)
  const setWindow = useTimeStore((s) => s.setWindow)
  const scaleKind = useTimeStore((s) => s.scaleKind)
  const setScaleKind = useTimeStore((s) => s.setScaleKind)
  const playback = useTimeStore((s) => s.playback)
  const setPlaying = useTimeStore((s) => s.setPlaying)
  const setSpeed = useTimeStore((s) => s.setSpeed)
  const globeExpanded = useTimeStore((s) => s.globeExpanded)
  const setGlobeExpanded = useTimeStore((s) => s.setGlobeExpanded)
  const expandedChartLayerId = useTimeStore((s) => s.expandedChartLayerId)
  const setExpandedChartLayerId = useTimeStore((s) => s.setExpandedChartLayerId)

  // The chart dock's TimeScale, lifted from the timeline itself (Timeline.tsx's W12a
  // `onScaleChange`) rather than recomputed here — see that prop's doc comment for why a
  // second, independent `useAnimatedScale` instance would be the wrong move.
  const [chartScale, setChartScale] = useState<TimeScale | null>(null)

  // Initial t (W12a brief): open on the oldest scene, once, the first time the manifest
  // loads — never again, so it doesn't fight a later manual scrub or a HMR-triggered reload
  // of this effect.
  const initialisedT = useRef(false)
  useEffect(() => {
    if (data.status !== 'ready' || initialisedT.current || data.manifest.scenes.length === 0) return
    initialisedT.current = true
    const oldest = data.manifest.scenes.reduce((a, b) => (b.t > a.t ? b : a))
    setT(oldest.t)
  }, [data, setT])

  // The playback loop (DESIGN §3): the one place `t` advances on its own. Always paced by the
  // full-domain scale, per `advancePlayhead`'s contract, so speed is independent of zoom.
  usePlaybackLoop({
    playing: playback.playing,
    onFrame: (dtSeconds) => {
      const next = advancePlayhead(t, dtSeconds, playback, FULL_DOMAIN_SCALE)
      if (next === 0) {
        // Reached the present: stop cleanly rather than spend every subsequent frame
        // computing a no-op clamp against a "playing" flag that never advances anything.
        if (t !== 0) setT(0)
        if (playback.playing) setPlaying(false)
        return
      }
      if (next !== t) setT(next)
    },
  })

  // Hoisted above the loading/error branches below so every hook in this component runs
  // unconditionally regardless of load state (rules of hooks) — `buildLayers` tolerates the
  // `null`s that state implies and returns the empty `AppLayers` for them.
  const { scalarLayers, nodeLayers, raster } = useMemo(
    () => buildLayers(data.status === 'ready' ? data.manifest : null, data.status === 'ready' ? data.layerData : null),
    [data],
  )

  if (data.status === 'loading') {
    return <main className={styles.centered}>Loading manifest…</main>
  }

  if (data.status === 'error') {
    return (
      <main className={styles.errorPanel}>
        <div className={styles.errorCard}>
          <p className={styles.errorTitle}>Failed to load</p>
          <p className={styles.errorMessage}>{data.error.message}</p>
        </div>
      </main>
    )
  }

  const { manifest, isStub } = data

  const hudScalarEntries = manifest.layers.filter((l) => l.surface === 'hud' && l.dataKind === 'scalar')
  const lineageEntry = manifest.layers.find((l) => l.dataKind === 'node')
  const nodeLayer = lineageEntry ? nodeLayers.get(lineageEntry.id) : undefined
  const expandedChartLayer = expandedChartLayerId !== null ? scalarLayers.get(expandedChartLayerId) : undefined

  const scenePair = manifest.scenes.length > 0 ? sceneAt(manifest.scenes, manifest.chapters, t) : null
  const captionScene = scenePair ? dominantScene(scenePair) : null

  return (
    <ShellLayout
      globe={
        raster ? (
          <Globe
            t={t}
            rasterData={raster.data}
            assetBase={manifest.assetBase}
            expanded={globeExpanded}
            onToggleExpand={() => setGlobeExpanded(!globeExpanded)}
          />
        ) : (
          <div className={styles.placeholder}>No paleogeographic data in manifest.</div>
        )
      }
      hud={
        <div className={styles.hudList}>
          {hudScalarEntries.map((entry) => {
            const layer = scalarLayers.get(entry.id)
            if (layer === undefined) return null
            return (
              <div key={entry.id} className={styles.layerRow} data-testid={`scalar-readout-${entry.id}`}>
                {isClockLayer(entry.unit) ? (
                  <DayLengthClock layer={layer} t={t} />
                ) : (
                  <>
                    <HudSparkline
                      layer={layer}
                      t={t}
                      entryId={entry.id}
                      chartable={entry.chartable}
                      expanded={expandedChartLayerId === entry.id}
                      onToggle={setExpandedChartLayerId}
                    />
                    <ScalarReadout layer={layer} t={t} />
                  </>
                )}
              </div>
            )
          })}
        </div>
      }
      ancestor={<div data-testid="ancestor-readout">{nodeLayer ? <AncestorReadout layer={nodeLayer} t={t} /> : null}</div>}
      caption={<p className={styles.captionText}>{captionScene?.caption ?? 'No scene at this time.'}</p>}
      scene={
        manifest.scenes.length > 0 ? (
          <SceneView t={t} scenes={manifest.scenes} chapters={manifest.chapters} assetBase={manifest.assetBase} />
        ) : (
          <div className={styles.placeholder}>No scenes in manifest.</div>
        )
      }
      timeline={
        <div className={styles.timelineDock}>
          {isStub && <span className={styles.stubBadge}>Stub data</span>}
          <Timeline
            t={t}
            window={timeWindow}
            scaleKind={scaleKind === 'linear' ? 'linear' : 'symlog'}
            events={manifest.events}
            playback={playback}
            onScrub={setT}
            onWindowChange={(w) => setWindow([w[0], w[1]])}
            onScaleKindChange={setScaleKind}
            onPlaybackChange={(next) => {
              setPlaying(next.playing)
              setSpeed(next.speed)
            }}
            onScaleChange={setChartScale}
          />
        </div>
      }
      chart={
        expandedChartLayer && chartScale ? <LayerChart layer={expandedChartLayer} t={t} scale={chartScale} /> : null
      }
    />
  )
}

interface HudSparklineProps {
  layer: Layer<ScalarValue>
  t: GeoTime
  entryId: string
  chartable: boolean
  expanded: boolean
  onToggle: (id: string | null) => void
}

/** A HUD sparkline, clickable to toggle the chart dock when its layer is chartable (DESIGN
 *  §8). Non-chartable scalar layers (there are none in the v1 manifest besides day length,
 *  which never reaches here — see `isClockLayer`) render the same sparkline without a
 *  click handler. */
function HudSparkline({ layer, t, entryId, chartable, expanded, onToggle }: HudSparklineProps) {
  const sparkline = <Sparkline layer={layer} t={t} scale={FULL_DOMAIN_SCALE} />
  if (!chartable) return sparkline
  return (
    <button
      type="button"
      className={styles.sparklineButton}
      aria-pressed={expanded}
      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${layer.name} chart`}
      onClick={() => onToggle(expanded ? null : entryId)}
    >
      {sparkline}
    </button>
  )
}
