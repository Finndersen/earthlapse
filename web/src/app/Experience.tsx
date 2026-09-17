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

import { SoundToggle, useAudioEngine } from '@/audio'
import { EventDetailPanel, EventFeed, EventTagLegend, placementT } from '@/events'
import { Globe } from '@/globe'
import type { GlobeRasterLayers } from '@/globe'
import { AncestorPanel, LayerChart, ScalarReadout, Sparkline } from '@/layers'
import { resolveAssetUrl, scenePlaybackSegments, sceneTerritories, SceneView, steadyFrameRegime } from '@/scene'
import type { PresentationRegime } from '@/scene'
import { ShellLayout } from '@/shell'
import { installDevHook } from '@/store/devHook'
import { useTimeStore } from '@/store/time'
import {
  advancePlayhead,
  advanceSteadyPlayhead,
  createLinearScale,
  createSymlogScale,
  eraNameForTime,
  formatGeoTime,
  sectionById,
  sectionSymlogKnee,
  Timeline,
  useAnimatedScale,
  usePlaybackLoop,
} from '@/timeline'
import type { TimelineCheckpoint, TimeWindow } from '@/timeline'
import { EARTH_FORMATION } from '@/types/layer'
import type { GeoTime, Layer, ScalarValue, TimelineEvent, TimeScale } from '@/types/layer'
import type { Scene } from '@/types/manifest'

import { buildLayers, rawEvents } from './buildLayers'
import styles from './page.module.css'
import { useAppData } from './useAppData'

/** The whole of Earth's history. The timeline's own window is the selected era section's
 *  (ADR-024); this is only for the scales below, which must not follow the selection. */
const FULL_DOMAIN: TimeWindow = [0, EARTH_FORMATION]

/** The full-domain *symlog* `TimeScale`, shared by the three things in this component that must
 *  not track the timeline's current section or scale-kind: `advancePlayhead`'s `'scenes'`-mode
 *  pacing (always symlog, per ADR-016 — a scene's dwell/dissolve durations don't change when the
 *  user flips the linear toggle), the HUD sparklines (a trend line that reads as a fixed
 *  miniature of all of history, not a mirror of the user's current scale-kind toggle), and the
 *  event feed's lookback (selecting a short section must not shrink "what just happened" to a
 *  few decades, ADR-024). Module scope: one stable `TimeScale`, computed once, not per render. */
const FULL_DOMAIN_SYMLOG_SCALE: TimeScale = createSymlogScale(FULL_DOMAIN)


/** Time constant, seconds, for smoothing the instantaneous years-per-second rate readout
 *  (ADR-016's prototype) into something that doesn't flicker every frame — an exponential
 *  moving average, `alpha = min(1, dtSeconds / this)` per frame. Small enough that the readout
 *  still catches up to a speed change within about a second, large enough to hide per-frame
 *  jitter from `requestAnimationFrame`'s own irregular deltas. */
const RATE_SMOOTHING_SECONDS = 0.5

export function Experience() {
  const data = useAppData()

  const t = useTimeStore((s) => s.t)
  const setT = useTimeStore((s) => s.setT)
  const sectionId = useTimeStore((s) => s.sectionId)
  const selectSection = useTimeStore((s) => s.selectSection)
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
  const detailEventId = useTimeStore((s) => s.detailEventId)
  const setDetailEventId = useTimeStore((s) => s.setDetailEventId)

  // The timeline's animated scale lives here and is passed down to <Timeline>, the chart dock
  // and the event feed, so all of them follow the selected era section's window (ADR-024) and
  // the value under the chart's playhead sits directly above the timeline's. Section windows
  // are constants from `sections.ts`, so `useAnimatedScale`'s memoised scales only recompute
  // while the window or the symlog/linear toggle is actually animating.
  const timelineScaleKind = scaleKind === 'linear' ? 'linear' : 'symlog'
  // A leaf section (no children — e.g. the Holocene's own "Modern") draws with the fixed
  // `SYMLOG_C` rather than `symlogKnee`'s own adaptive shrink, which is meant for a section that
  // has children to make room for (re-review fix, 2026-09-15 — see `sectionSymlogKnee`'s doc
  // comment). Threaded into both the resting/animated scale and 'steady'-mode pacing below, so
  // the ruler, the track and steady playback's own speed all agree on the same knee.
  const timelineKnee = sectionSymlogKnee(sectionId)
  const timelineScale = useAnimatedScale(sectionById(sectionId).window, timelineScaleKind, timelineKnee)

  // Where SceneView's caption is portalled: the shell's subtitle position above the timeline.
  // SceneView renders the caption inside its own full-window layer, which sits beneath the
  // lens vignette; the portal keeps the caption driven by SceneView's own dissolve (so it can
  // never drift out of sync with the image) while placing it in the HUD above the vignette.
  const [captionHost, setCaptionHost] = useState<HTMLDivElement | null>(null)

  // The globe's own regime/effect caption (docs/GLOBE.md §7), lifted here from `<Globe>`'s
  // `onCaptionChange` so `ShellLayout` can place it under the minimised orb (its
  // "Paleogeography" label slot) and, while the globe is expanded, in the stage slot above the
  // timeline. `Globe` never draws a caption over the sphere itself in either state.
  const [globeCaption, setGlobeCaption] = useState('')

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

  // Every scene's on-screen territory (ADR-029) — the shared geometry both 'steady'-mode pacing
  // below (`advanceSteadyPlayhead`'s rate floor) and the presentation regime just below it
  // (`steadyPacing`, crossfade vs. cut) derive from, so the two always agree about where one
  // scene's dwell ends and the next begins. Memoised like `scenesPacing` above.
  const steadyTerritories = useMemo(
    () => (data.status === 'ready' ? sceneTerritories(data.manifest.scenes) : []),
    [data],
  )

  // 'steady' mode moves at constant velocity in the selected section's scale of whichever
  // ScaleKind is on screen (ADR-016, ADR-024). The symlog case is pinned to `timelineKnee`
  // (re-review fix, 2026-09-15), the same knee the visible track/ruler use, so a leaf section's
  // steady-mode pacing doesn't spend a lopsided share of wall-clock time near its present edge —
  // see `timelineKnee`'s own comment above. `advanceSteadyPlayhead` calls this once per section
  // it's currently inside; `timelineKnee` reflects `sectionId` fresh every render (and every
  // render supplies a fresh closure here), so it stays correct across an ordinary frame-to-frame
  // section change. The one case it doesn't chase mid-call is several section boundaries
  // crossed within a single `advanceSteadyPlayhead` invocation (an extreme speed/dt combination)
  // — that uses this frame's knee for the whole catch-up and self-corrects the next frame,
  // the same trade-off `useAnimatedScale`'s own fixed-knee-per-transition already makes.
  const steadyScaleForWindow =
    timelineScaleKind === 'linear' ? createLinearScale : (window: TimeWindow) => createSymlogScale(window, timelineKnee)

  // The rate readout beside the Transport mode toggle (ADR-016's prototype): the instantaneous
  // years-per-second `t` is advancing at, smoothed (`RATE_SMOOTHING_SECONDS`) so it doesn't
  // flicker every frame. `null` while not playing, so `Transport` shows nothing and a later
  // resume doesn't ease in from a stale figure.
  const [ratePerSecond, setRatePerSecond] = useState<number | null>(null)
  const smoothedRateRef = useRef<number | null>(null)

  // Steady-mode presentation regime and floor status (ADR-029): computed fresh inside the
  // playback loop's own `onFrame`, below — never from a bare render. While playback is paused,
  // `onFrame` never runs at all, so a scrub/click/keyboard step made while paused never sees
  // anything but the default 'crossfade'/not-floored here (and the effect below resets it the
  // instant playback actually stops, the same "idle state shows nothing stale" rule
  // `ratePerSecond` above already follows — never an idle *timer*, a direct consequence of
  // `playback.playing` itself, ADR-012 amendment). While playback *is* running, `onFrame` still
  // runs every frame regardless of a concurrent scrub — `lastAdvancedTRef` (below) is what keeps
  // such a frame reading 'crossfade' too (re-review fix, 2026-09-15): see its own comment.
  const [steadyRegime, setSteadyRegime] = useState<{ regime: PresentationRegime; floored: boolean }>({
    regime: 'crossfade',
    floored: false,
  })
  // The `t` this component's own playback loop last advanced to and committed via `setT` — used
  // by `onFrame` below to tell "the loop's own next tick" apart from "something else moved `t`
  // since" (a scrub, a checkpoint/event jump, a keyboard step). `null` whenever there is no such
  // reference to compare against: before the loop has ever advanced anything, and reset on every
  // stop/(re)start so a resume never compares the fresh first frame against a many-seconds-stale
  // value left over from before playback paused (re-review fix, HIGH-2/MEDIUM-1: a scrub or seek
  // made while steady playback keeps running used to hard-cut with no rate limit at all, since
  // the regime was read from whatever territory the scrubbed-to `t` happened to land in).
  const lastAdvancedTRef = useRef<GeoTime | null>(null)
  useEffect(() => {
    if (!playback.playing) {
      setSteadyRegime({ regime: 'crossfade', floored: false })
      lastAdvancedTRef.current = null
    }
  }, [playback.playing])

  // Event detail panel (W-followup item 12): opening it pauses playback if it was running,
  // closing it resumes only then — a direct consequence of the click that opened/closed it, not
  // an idle-driven change. `useRef`, not `useTimeStore`, because this is a one-shot remembered
  // fact about *this* open/close pair, not state anything else in the app reads.
  const wasPlayingBeforeDetailRef = useRef(false)
  useEffect(() => {
    if (!playback.playing) {
      smoothedRateRef.current = null
      setRatePerSecond(null)
    }
  }, [playback.playing])

  // The playback loop (DESIGN §3): the one place `t` advances on its own. 'scenes' mode always
  // paces in full-domain symlog u, whatever the toggle or section (ADR-016). 'steady' mode
  // carries on across section ends (ADR-024) and, per scene territory, floors its own rate
  // against `steadyTerritories` (ADR-029). Either way `setT` moves the selected section along
  // with `t`.
  usePlaybackLoop({
    playing: playback.playing,
    onFrame: (dtSeconds) => {
      // A frame whose starting `t` isn't what this loop's own previous tick last produced was
      // moved by something else since — a scrub, a checkpoint/event jump, a keyboard step
      // (`lastAdvancedTRef`'s own comment above). `null` (no prior tick to compare against, or
      // just resumed) never reads as a seek.
      const seeked = lastAdvancedTRef.current !== null && t !== lastAdvancedTRef.current

      const next =
        playback.mode === 'steady'
          ? advanceSteadyPlayhead(t, dtSeconds, playback, sectionId, steadyScaleForWindow, steadyTerritories)
          : advancePlayhead(t, dtSeconds, playback, FULL_DOMAIN_SYMLOG_SCALE, scenesPacing)

      if (playback.mode === 'steady') {
        // Evaluated at `next` — the `t` this frame actually renders — not the pre-advance `t`,
        // and forced to crossfade by `seeked` above: see `steadyFrameRegime`'s own doc comment
        // for why both re-review fixes matter (MEDIUM-2 and HIGH-2, respectively). Recomputing
        // `rawRate`/`scale` here (not reusing anything `advanceSteadyPlayhead` used internally)
        // mirrors exactly what that call just integrated with, for whichever territory `next`
        // itself landed in — a large dt crossing several territories in one call is a rare
        // catch-up case (a stalled tab regaining focus); this only ever reads the *last* one.
        const rawRate = playback.baseRate * playback.speed
        const scale = steadyScaleForWindow(sectionById(sectionId).window)
        const pacing = steadyFrameRegime(steadyTerritories, next, rawRate, scale, seeked)
        setSteadyRegime({ regime: pacing.regime, floored: pacing.floored })
      } else if (steadyRegime.regime !== 'crossfade' || steadyRegime.floored) {
        setSteadyRegime({ regime: 'crossfade', floored: false })
      }

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
        // Same batch, not the separate `playback.playing` reset effect above (which would only
        // clear it on the *next* render): the floor stops mattering the instant nothing is
        // advancing any more, so the marker must not show for one extra committed frame after
        // playback has already stopped.
        setSteadyRegime({ regime: 'crossfade', floored: false })
        lastAdvancedTRef.current = 0
        return
      }
      if (next !== t) setT(next)
      lastAdvancedTRef.current = next
    },
  })

  // Hoisted above the loading/error branches below so every hook in this component runs
  // unconditionally regardless of load state (rules of hooks) — `buildLayers` tolerates the
  // `null`s that state implies and returns the empty `AppLayers` for them.
  const { scalarLayers, nodeLayers, rasters, eventLayers, nodePortraits } = useMemo(
    () => buildLayers(data.status === 'ready' ? data.manifest : null, data.status === 'ready' ? data.layerData : null),
    [data],
  )

  // Audio (ADR-023): the one stateful hook owns Tone.js's lazy lifecycle plus the toggle's own
  // persisted enabled/volume state (see `@/audio/engine.ts`'s doc comment) — `manifest` is
  // `null` until `data.status === 'ready'`, the same "not loaded yet" contract `buildLayers`
  // above already follows, and the engine stays fully inert until then.
  const audio = useAudioEngine({
    manifest: data.status === 'ready' ? data.manifest : null,
    t,
    playing: playback.playing,
    playback,
    sectionWindow: sectionById(sectionId).window,
    scalarLayers,
    // ADR-029: while steady playback is hard-cutting through a dense scene cluster, scene loop
    // sounds mute and once-mode sounds don't trigger (see `useAudioEngine`'s own doc comment) —
    // the same `steadyRegime` that drives `SceneView`'s presented mix and the "time compressed"
    // marker below, so all three always agree about which frames are cutting.
    presentationRegime: steadyRegime.regime,
  })

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
            label: scene.title,
            thumbnailUrl: resolveAssetUrl(data.manifest.assetBase, scene.image),
          }))
        : [],
    [data],
  )

  // Clicking or tapping a checkpoint cluster marker (ADR-019) reports its members here — purely
  // as a notification. `<Timeline>`'s own `ScrubTrack` opens and owns an in-track member-list
  // popover itself (ADR-021), so this component has no UI of its own to build in response; kept
  // as a no-op rather than removed, since the prop still exists for a caller that wants to know
  // (analytics, say).
  const handleOpenCluster = (_members: readonly TimelineCheckpoint[]): void => {}

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

  // The event feed card an activation opened, if any (W-followup item 12). Looked up by id
  // rather than kept as the `TimelineEvent` itself, so the store only ever holds a plain id, the
  // same "what's expanded, not the expanded thing" shape `expandedChartLayerId` already uses.
  const detailEvent = detailEventId !== null ? (manifest.events.find((e) => e.id === detailEventId) ?? null) : null

  const openEventDetail = (event: TimelineEvent): void => {
    wasPlayingBeforeDetailRef.current = playback.playing
    if (playback.playing) setPlaying(false)
    setDetailEventId(event.id)
  }

  const closeEventDetail = (): void => {
    setDetailEventId(null)
    if (wasPlayingBeforeDetailRef.current) {
      wasPlayingBeforeDetailRef.current = false
      setPlaying(true)
    }
  }

  // Only chartable scalars get a HUD readout: each one opens the chart dock. Day length is
  // still published (the audio score reads it) but no longer spends HUD space the event feed needs.
  const hudScalarEntries = manifest.layers.filter((l) => l.surface === 'hud' && l.dataKind === 'scalar' && l.chartable)
  const lineageEntry = manifest.layers.find((l) => l.dataKind === 'node')
  const nodeLayer = lineageEntry ? nodeLayers.get(lineageEntry.id) : undefined
  const lineagePortraits = lineageEntry ? (nodePortraits.get(lineageEntry.id) ?? null) : null
  const expandedChartLayer = expandedChartLayerId !== null ? scalarLayers.get(expandedChartLayerId) : undefined

  // The subtitle above the timeline: the scene's short `title` as a heading over its longer
  // `caption` passage, sharing one opacity so they cross-fade together in step with SceneView's
  // own dissolve — neither is individually faded.
  const renderCaption = (scene: Scene, opacity: number) =>
    captionHost === null
      ? null
      : createPortal(
          // A styled `<p>`, not `<h2>`: the page has no `<h1>` to root a heading hierarchy under,
          // and this slot is a visual heading (distinct font/weight/size from `.caption` below
          // it), not a document-outline one.
          <div className={styles.captionBlock} style={{ opacity }}>
            <p className={styles.captionTitle} data-testid="scene-caption-title">
              {scene.title}
            </p>
            <p className={styles.caption} data-testid="scene-caption-text">
              {scene.caption}
            </p>
          </div>,
          captionHost,
        )

  return (
    <>
      <ShellLayout
        globeExpanded={globeExpanded}
        globeCaption={globeCaption}
        eventLegend={<EventTagLegend />}
        scene={
          manifest.scenes.length > 0 ? (
            <SceneView
              t={t}
              scenes={manifest.scenes}
              assetBase={manifest.assetBase}
              renderCaption={renderCaption}
              regime={steadyRegime.regime}
            />
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
              onCaptionChange={setGlobeCaption}
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
                  <ScalarReadout layer={layer} t={t} />
                  <HudSparkline
                    layer={layer}
                    t={t}
                    entryId={entry.id}
                    expanded={expandedChartLayerId === entry.id}
                    onToggle={setExpandedChartLayerId}
                  />
                </div>
              )
            })}
          </div>
        }
        feed={<EventFeed t={t} scale={FULL_DOMAIN_SYMLOG_SCALE} events={manifest.events} onEventActivate={openEventDetail} />}
        title={<TimeTitle t={t} />}
        badge={isStub ? <span className={styles.stubBadge}>Stub data</span> : null}
        ancestor={
          nodeLayer ? <AncestorPanel layer={nodeLayer} t={t} assetBase={manifest.assetBase} portraits={lineagePortraits} /> : null
        }
        caption={<div ref={setCaptionHost} className={styles.captionHost} data-testid="scene-caption" />}
        chart={
          expandedChartLayer ? (
            <LayerChart layer={expandedChartLayer} t={t} scale={timelineScale} onClose={() => setExpandedChartLayerId(null)} />
          ) : null
        }
        timeline={
          <Timeline
            t={t}
            scaleKind={timelineScaleKind}
            scale={timelineScale}
            sectionId={sectionId}
            events={manifest.events}
            checkpoints={checkpoints}
            playback={playback}
            onScrub={setT}
            onSelectSection={selectSection}
            onScaleKindChange={setScaleKind}
            onPlaybackChange={(next) => {
              setPlaying(next.playing)
              setSpeed(next.speed)
              setPlaybackMode(next.mode)
            }}
            onOpenCluster={handleOpenCluster}
            ratePerSecond={ratePerSecond}
            timeCompressed={steadyRegime.floored}
            sound={<SoundToggle {...audio} />}
            overlayOpen={globeExpanded || expandedChartLayerId !== null}
          />
        }
      />
      {detailEvent && (
        <EventDetailPanel
          event={detailEvent}
          onClose={closeEventDetail}
          onShowOnTimeline={() => {
            // Scrubs, then closes the panel itself rather than leaving it open over a ~35%
            // backdrop (re-review fix, 2026-09-15): the panel already paused playback on open
            // (`openEventDetail`), and the point of this action is to actually see the scene at
            // the event's placement, which the still-open panel was hiding. Closing here does
            // *not* resume playback even if it had been running before the panel opened —
            // clearing `wasPlayingBeforeDetailRef` first, then calling `setDetailEventId(null)`
            // directly rather than `closeEventDetail` (which would resume) — since resuming would
            // immediately carry the playhead away from the place the viewer just asked to see.
            setT(placementT(detailEvent))
            wasPlayingBeforeDetailRef.current = false
            setDetailEventId(null)
          }}
        />
      )}
    </>
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
  expanded: boolean
  onToggle: (id: string | null) => void
}

/** A HUD sparkline, clickable to toggle the chart dock (DESIGN §8). Only chartable layers get a
 *  HUD readout, so every one is a button. */
function HudSparkline({ layer, t, entryId, expanded, onToggle }: HudSparklineProps) {
  const sparkline = <Sparkline layer={layer} t={t} scale={FULL_DOMAIN_SYMLOG_SCALE} />
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
