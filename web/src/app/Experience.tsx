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
import type { GlobeRasterLayers } from '@/globe'
import { AncestorPanel, DayLengthClock, LayerChart, ScalarReadout, Sparkline } from '@/layers'
import { resolveAssetUrl, scenePlaybackSegments, SceneView } from '@/scene'
import { ShellLayout, useIdle } from '@/shell'
import { installDevHook } from '@/store/devHook'
import { useTimeStore } from '@/store/time'
import {
  advancePlayhead,
  createLinearScale,
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

import { buildLayers, rawEvents } from './buildLayers'
import styles from './page.module.css'
import { useAppData } from './useAppData'

/** The full-domain *symlog* `TimeScale`, shared by the three things in this component that
 *  must not track the timeline's current zoom/scale-kind: `advancePlayhead`'s `'scenes'`-mode
 *  pacing (always symlog, per ADR-016 — a scene's dwell/dissolve durations don't change when
 *  the user flips the linear toggle), `'steady'`-mode playback while symlog is selected, and
 *  the HUD sparklines (a trend line that reads as a fixed miniature of all of history, not a
 *  mirror of the user's current zoom). Module scope: one stable `TimeScale`, computed once,
 *  not per render. */
const FULL_DOMAIN_SYMLOG_SCALE: TimeScale = createSymlogScale([0, EARTH_FORMATION])

/** The full-domain *linear* `TimeScale` — only ever used for `'steady'`-mode playback while
 *  the linear toggle is on (ADR-016: "constant velocity in the full-domain scale of the
 *  CURRENTLY SELECTED scale kind"). Module scope for the same reason as its symlog sibling. */
const FULL_DOMAIN_LINEAR_SCALE: TimeScale = createLinearScale([0, EARTH_FORMATION])

/** Time constant, seconds, for smoothing the instantaneous years-per-second rate readout
 *  (ADR-016's prototype) into something that doesn't flicker every frame — an exponential
 *  moving average, `alpha = min(1, dtSeconds / this)` per frame. Small enough that the readout
 *  still catches up to a speed change within about a second, large enough to hide per-frame
 *  jitter from `requestAnimationFrame`'s own irregular deltas. */
const RATE_SMOOTHING_SECONDS = 0.5

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
  const setPlaybackMode = useTimeStore((s) => s.setPlaybackMode)
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

  // Playback pacing for 'scenes' mode (ADR-016 — `scene/pacing.ts`): the wall-clock durations
  // the playhead spends crossing each scene and each dissolve, so the picture stays a pure
  // function of `t` throughout 'scenes'-mode playback. Memoised so it's only recomputed when
  // the manifest's scenes change, not every frame. `advancePlayhead` ignores this entirely in
  // 'steady' mode, so it's harmless (if wasted) to always compute it rather than branch here.
  const scenesPacing = useMemo(
    () => (data.status === 'ready' ? scenePlaybackSegments(data.manifest.scenes) : []),
    [data],
  )

  // ADR-016: 'scenes' mode always paces in full-domain *symlog* u, regardless of the display
  // toggle; 'steady' mode moves at constant velocity in the full-domain scale of whichever
  // ScaleKind is currently selected.
  const playbackFullScale =
    playback.mode === 'steady' && timelineScaleKind === 'linear' ? FULL_DOMAIN_LINEAR_SCALE : FULL_DOMAIN_SYMLOG_SCALE

  // The rate readout beside the Transport mode toggle (ADR-016's prototype): the instantaneous
  // years-per-second `t` is advancing at, smoothed (`RATE_SMOOTHING_SECONDS`) so it doesn't
  // flicker every frame. `null` while not playing, so `Transport` shows nothing and a later
  // resume doesn't ease in from a stale figure.
  const [ratePerSecond, setRatePerSecond] = useState<number | null>(null)
  const smoothedRateRef = useRef<number | null>(null)
  useEffect(() => {
    if (!playback.playing) {
      smoothedRateRef.current = null
      setRatePerSecond(null)
    }
  }, [playback.playing])

  // The playback loop (DESIGN §3): the one place `t` advances on its own. Always paced by a
  // *full-domain* scale (never the current window's), per `advancePlayhead`'s contract, so
  // playback speed is independent of zoom.
  usePlaybackLoop({
    playing: playback.playing,
    onFrame: (dtSeconds) => {
      const next = advancePlayhead(t, dtSeconds, playback, playbackFullScale, scenesPacing)

      const instantaneous = dtSeconds > 0 ? Math.abs(t - next) / dtSeconds : 0
      const alpha = Math.min(1, dtSeconds / RATE_SMOOTHING_SECONDS)
      const previousRate = smoothedRateRef.current ?? instantaneous
      const smoothedRate = previousRate + (instantaneous - previousRate) * alpha
      smoothedRateRef.current = smoothedRate
      setRatePerSecond(smoothedRate)

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
  const { scalarLayers, nodeLayers, rasters, eventLayers } = useMemo(
    () => buildLayers(data.status === 'ready' ? data.manifest : null, data.status === 'ready' ? data.layerData : null),
    [data],
  )

  // The globe's two raster sources (docs/GLOBE.md §4.1, G7), selected by id (ADR-013) —
  // `paleodem` (0-540 Ma) and, when published, `plates_neoproterozoic` (540-1000 Ma, `null`
  // when unusable: `Globe` then falls back to the "geography unknown" regime rather than
  // faking continents). `globe-regimes`' raw event list feeds the same pre-1 Ga regime blend.
  const paleodemRaster = rasters.get('paleodem')
  const rasterLayers: GlobeRasterLayers | null =
    paleodemRaster === undefined
      ? null
      : { paleodem: paleodemRaster.data, neoproterozoic: rasters.get('plates_neoproterozoic')?.data ?? null }
  const regimeEvents = useMemo(() => rawEvents(eventLayers, 'globe-regimes'), [eventLayers])

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
        rasterLayers ? (
          <Globe
            t={t}
            rasterLayers={rasterLayers}
            assetBase={manifest.assetBase}
            regimeEvents={regimeEvents}
            effectEvents={manifest.events}
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
      ancestor={nodeLayer ? <AncestorPanel layer={nodeLayer} t={t} assetBase={manifest.assetBase} /> : null}
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
            setPlaybackMode(next.mode)
          }}
          following={following}
          ratePerSecond={ratePerSecond}
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
  const sparkline = <Sparkline layer={layer} t={t} scale={FULL_DOMAIN_SYMLOG_SCALE} />
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
