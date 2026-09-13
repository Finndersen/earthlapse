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
import { createPortal } from 'react-dom'

import { Globe } from '@/globe'
import { AncestorReadout, DayLengthClock, LayerChart, ScalarReadout, Sparkline } from '@/layers'
import { resolveAssetUrl, scenePlaybackSegments, SceneView } from '@/scene'
import { ShellLayout, useIdle } from '@/shell'
import { installDevHook } from '@/store/devHook'
import { useTimeStore } from '@/store/time'
import {
  advancePlayhead,
  createSymlogScale,
  eraNameForTime,
  followWindow,
  formatGeoTime,
  Timeline,
  useAnimatedScale,
  usePlaybackLoop,
} from '@/timeline'
import type { TimelineCheckpoint } from '@/timeline'
import { EARTH_FORMATION } from '@/types/layer'
import type { GeoTime, Layer, ScalarValue, TimeScale } from '@/types/layer'
import type { Scene } from '@/types/manifest'

import { buildLayers } from './buildLayers'
import styles from './page.module.css'
import { useAppData } from './useAppData'

/** The full-domain symlog `TimeScale`, shared by the two things in this component that must
 *  not track the timeline's current zoom/scale-kind: `advancePlayhead`'s pacing (its own
 *  contract — playback speed is independent of zoom) and the HUD sparklines (a trend line
 *  that reads as a fixed miniature of all of history, not a mirror of the user's current
 *  zoom). Module scope: one stable `TimeScale`, computed once, not per render. */
const FULL_DOMAIN_SCALE: TimeScale = createSymlogScale([0, EARTH_FORMATION])

/** How long playback runs untouched before the periphery HUD recedes (idle calm). */
const IDLE_CALM_MS = 3000

/** A `Layer<ScalarValue>` renders as a `DayLengthClock` rather than a `Sparkline` +
 *  `ScalarReadout` exactly when its unit is hours — `DayLengthClock`'s own doc comment
 *  ("for a `Layer<ScalarValue>` whose unit is hours") makes this the contract, not an id
 *  hard-coded here. `'h'` is the unit symbol `earthtime publish` actually emits for hours
 *  (sources/astronomy/normalise.py). */
function isClockLayer(unit: string | undefined): boolean {
  return unit === 'h'
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

  // The timeline's animated scale lives here and is passed down to both <Timeline> and the chart
  // dock, so the value under the chart's playhead sits directly above the timeline's. It must
  // not be reported back up from an effect inside <Timeline>: that scheduled a second render on
  // every minimap drag frame, which a fast pointer starved into "Maximum update depth exceeded".
  const timelineScaleKind = scaleKind === 'linear' ? 'linear' : 'symlog'
  const timelineScale = useAnimatedScale(timeWindow, timelineScaleKind)

  // Where SceneView's caption is portalled: the shell's subtitle position above the timeline.
  // SceneView renders the caption inside its own full-window layer, which sits beneath the
  // lens vignette; the portal keeps the caption driven by SceneView's own dissolve (so it can
  // never drift out of sync with the image) while placing it in the HUD above the vignette.
  const [captionHost, setCaptionHost] = useState<HTMLDivElement | null>(null)

  // Idle calm is never armed with the globe expanded: the expanded globe lives inside the
  // periphery the calm fades, and a modal the viewer opened must not dim itself.
  const calm = useIdle({ armed: playback.playing && !globeExpanded, timeoutMs: IDLE_CALM_MS })

  // Follow-during-playback (timeline README §4), wired here next to the playback loop below.
  // Engages on every play press (the effect only ever turns it *on*); disengages the instant
  // the user manually pans or zooms the window — that happens in the wrapped `onWindowChange`
  // passed to <Timeline>, not here, since only a *user* gesture should disengage it, never
  // `followWindow`'s own panning (which writes `window` directly in the playback loop below,
  // bypassing that callback entirely).
  const [following, setFollowing] = useState(false)
  const wasPlayingRef = useRef(playback.playing)
  useEffect(() => {
    if (playback.playing && !wasPlayingRef.current) setFollowing(true)
    wasPlayingRef.current = playback.playing
  }, [playback.playing])

  useEffect(() => {
    installDevHook()
  }, [])

  // Initial t (W12a brief): open on the oldest scene, once, the first time the manifest
  // loads — never again, so it doesn't fight a later manual scrub. Nothing renders until it
  // has been applied, so the scene mounts directly on the oldest still rather than first
  // mounting at the store's default `t` and dissolving across all of history to get there.
  const [initialised, setInitialised] = useState(false)
  useEffect(() => {
    if (data.status !== 'ready' || initialised) return
    if (data.manifest.scenes.length > 0) {
      setT(data.manifest.scenes.reduce((a, b) => (b.t > a.t ? b : a)).t)
    }
    setInitialised(true)
  }, [data, initialised, setT])

  // Playback pacing (ADR-012 update — `scene/pacing.ts`): the wall-clock durations the
  // playhead itself must spend crossing each scene and each dissolve, so the picture stays a
  // pure function of `t` throughout playback. Memoised so it's only recomputed when the
  // manifest's scenes change, not every frame.
  const pacing = useMemo(
    () => (data.status === 'ready' ? scenePlaybackSegments(data.manifest.scenes) : []),
    [data],
  )

  // The playback loop (DESIGN §3): the one place `t` advances on its own. Always paced by the
  // full-domain scale, per `advancePlayhead`'s contract, so speed is independent of zoom.
  usePlaybackLoop({
    playing: playback.playing,
    onFrame: (dtSeconds) => {
      const next = advancePlayhead(t, dtSeconds, playback, FULL_DOMAIN_SCALE, pacing)
      if (next === 0) {
        // Reached the present: stop cleanly rather than spend every subsequent frame
        // computing a no-op clamp against a "playing" flag that never advances anything.
        if (t !== 0) setT(0)
        if (playback.playing) setPlaying(false)
        return
      }
      if (next !== t) setT(next)
      if (following) {
        const followed = followWindow(timeWindow, next, timelineScaleKind)
        if (followed[0] !== timeWindow[0] || followed[1] !== timeWindow[1]) setWindow([followed[0], followed[1]])
      }
    },
  })

  // Hoisted above the loading/error branches below so every hook in this component runs
  // unconditionally regardless of load state (rules of hooks) — `buildLayers` tolerates the
  // `null`s that state implies and returns the empty `AppLayers` for them.
  const { scalarLayers, nodeLayers, raster } = useMemo(
    () => buildLayers(data.status === 'ready' ? data.manifest : null, data.status === 'ready' ? data.layerData : null),
    [data],
  )

  // Every scene is a timeline checkpoint, so the stills themselves are marked and steppable on
  // the axis, not only the data-driven events. Memoised so the track's pip layout only reruns
  // when the manifest does.
  const checkpoints = useMemo(
    (): TimelineCheckpoint[] =>
      data.status === 'ready'
        ? data.manifest.scenes.map((scene) => ({
            id: scene.id,
            t: scene.t,
            label: scene.caption,
            thumbnailUrl: resolveAssetUrl(data.manifest.assetBase, scene.image),
          }))
        : [],
    [data],
  )

  if (data.status === 'loading' || (data.status === 'ready' && !initialised)) {
    return <main className={styles.centered}>Loading manifest…</main>
  }

  if (data.status === 'error') {
    return (
      <main className={styles.centered}>
        <div className={styles.error}>
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

  const renderCaption = (scene: Scene, opacity: number) =>
    captionHost === null
      ? null
      : createPortal(
          <p className={styles.caption} style={{ opacity }}>
            {scene.caption}
          </p>,
          captionHost,
        )

  return (
    <ShellLayout
      calm={calm}
      globeExpanded={globeExpanded}
      scene={
        manifest.scenes.length > 0 ? (
          <SceneView t={t} scenes={manifest.scenes} assetBase={manifest.assetBase} renderCaption={renderCaption} />
        ) : (
          <div className={styles.placeholder}>No scenes in manifest.</div>
        )
      }
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
      readouts={
        <div className={styles.readouts}>
          {hudScalarEntries.map((entry) => {
            const layer = scalarLayers.get(entry.id)
            if (layer === undefined) return null
            return (
              <div key={entry.id} className={styles.readout} data-testid={`scalar-readout-${entry.id}`}>
                {isClockLayer(entry.unit) ? (
                  <DayLengthClock layer={layer} t={t} />
                ) : (
                  <>
                    <ScalarReadout layer={layer} t={t} />
                    <HudSparkline
                      layer={layer}
                      t={t}
                      entryId={entry.id}
                      chartable={entry.chartable}
                      expanded={expandedChartLayerId === entry.id}
                      onToggle={setExpandedChartLayerId}
                    />
                  </>
                )}
              </div>
            )
          })}
        </div>
      }
      title={<TimeTitle t={t} />}
      badge={isStub ? <span className={styles.stubBadge}>Stub data</span> : null}
      ancestor={<div data-testid="ancestor-readout">{nodeLayer ? <AncestorReadout layer={nodeLayer} t={t} /> : null}</div>}
      caption={<div ref={setCaptionHost} className={styles.captionHost} data-testid="scene-caption" />}
      chart={
        expandedChartLayer ? (
          <LayerChart layer={expandedChartLayer} t={t} scale={timelineScale} onClose={() => setExpandedChartLayerId(null)} />
        ) : null
      }
      timeline={
        <Timeline
          t={t}
          window={timeWindow}
          scaleKind={timelineScaleKind}
          scale={timelineScale}
          events={manifest.events}
          checkpoints={checkpoints}
          playback={playback}
          onScrub={setT}
          onWindowChange={(w) => {
            // Every window change reaching this callback is a user gesture (wheel, drag,
            // a zoom/fit button, minimap click, a keyboard shortcut) — `followWindow`'s own
            // panning never goes through it, see the playback loop above — so disengaging
            // follow unconditionally here is exactly README §4's rule.
            setFollowing(false)
            setWindow([w[0], w[1]])
          }}
          onScaleKindChange={setScaleKind}
          onPlaybackChange={(next) => {
            setPlaying(next.playing)
            setSpeed(next.speed)
          }}
          following={following}
        />
      }
    />
  )
}

/** The lens's headline: the current time in large light numerals, the eon/era beneath. */
function TimeTitle({ t }: { t: GeoTime }) {
  return (
    <div className={styles.timeTitle} data-testid="time-title">
      <span className={styles.time}>{formatGeoTime(t)}</span>
      <span className={styles.era}>{eraNameForTime(t)}</span>
    </div>
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
  if (!chartable) return <div className={styles.sparkline}>{sparkline}</div>
  return (
    <button
      type="button"
      className={`${styles.sparkline} ${styles.sparklineButton}`}
      aria-pressed={expanded}
      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${layer.name} chart`}
      onClick={() => onToggle(expanded ? null : entryId)}
    >
      {sparkline}
    </button>
  )
}
