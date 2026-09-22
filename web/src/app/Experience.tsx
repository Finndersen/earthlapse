'use client'

/**
 * Wires the `timeline`, `globe`, `scene` and `layers` packages into `ShellLayout`, all driven
 * from the single `t` in `useTimeStore`.
 * This is the one place the playback loop lives (DESIGN §3): `usePlaybackLoop` +
 * `advancePlayhead` against the *full-domain* scale, writing `t` back to the store every
 * frame while playing.
 *
 * The loading screen stays up until the manifest and the first scene's images are in
 * (`firstScene.ts`); layer data keeps arriving after that (`useAppData`). A layer that has not
 * loaded yet renders nothing rather than a placeholder value, and anything that depends on
 * several layers together, or on whether one is published at all, waits for all of them
 * (`layersLoaded`). Any failure is a loud full-page error.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { SoundToggle, useAudioEngine } from '@/audio'
import { EventBrowser, EventDetailPanel, EventFeed, EventTagLegend, placementT, useIsCompactViewport } from '@/events'
import { Globe, GLOBE_OVERLAYS, GLOBE_OVERLAY_KINDS } from '@/globe'
import { iceAgeLayersFrom } from '@/globe/ice'
import type { GlobeRasterLayers } from '@/globe'
import { AncestorPanel, isHiddenFromHud, isPopulationReadoutHiddenAt, LayerChart, ScalarReadout, Sparkline } from '@/layers'
import { OnboardingTour } from '@/onboarding'
import {
  dominantScene,
  resolveAssetUrl,
  sceneAt,
  scenePlaybackSegments,
  sceneTerritories,
  SceneView,
  steadyFrameRegime,
  yearsForPlaybackSeconds,
} from '@/scene'
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
  EraShortcuts,
  formatGeoTime,
  isOpenEventBrowserShortcut,
  sectionById,
  sectionSymlogKnee,
  Timeline,
  useAnimatedScale,
  usePlaybackLoop,
} from '@/timeline'
import type { TimelineCheckpoint, TimeWindow } from '@/timeline'
import { EARTH_FORMATION } from '@/types/layer'
import type { GeoTime, Layer, ScalarValue, TimelineEvent, TimeScale } from '@/types/layer'
import type { LayerManifest, Manifest, Scene } from '@/types/manifest'

import { buildLayers, rawEvents } from './buildLayers'
import { FeedbackLink } from './FeedbackLink'
import { initialSceneT, loadingProgress, useFirstSceneLoad } from './firstScene'
import { LoadingScreen } from './LoadingScreen'
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


/**
 * Target real-world seconds a newly-appeared city name label stays on screen at 1x playback
 * speed — long enough to actually read the name, short enough to still register as an arrival
 * rather than a lingering caption. `cityLabelFadeWindowAt` below converts this into the `t`-years
 * window `cityLabelOpacityAt` fades over, per city, from real `'scenes'`-mode pacing, so the
 * *real-time* duration stays close to this figure everywhere on the timeline rather than
 * stretching or collapsing with how fast that stretch happens to be paced.
 */
export const CITY_LABEL_FADE_SECONDS = 3.5

/** Time constant, seconds, for smoothing the instantaneous years-per-second rate readout
 *  (ADR-016's prototype) into something that doesn't flicker every frame — an exponential
 *  moving average, `alpha = min(1, dtSeconds / this)` per frame. Small enough that the readout
 *  still catches up to a speed change within about a second, large enough to hide per-frame
 *  jitter from `requestAnimationFrame`'s own irregular deltas. */
const RATE_SMOOTHING_SECONDS = 0.5

/** Props-free chrome, created once: the same element on every render lets React skip it while
 *  playback re-renders this component every frame. */
const EVENT_TAG_LEGEND = <EventTagLegend />
const FEEDBACK_LINK = <FeedbackLink />
const ONBOARDING_TOUR = <OnboardingTour />

/** Whether every layer `include` selects has loaded — `false` until the manifest has. */
function layersLoaded(
  manifest: Manifest | null,
  layerData: ReadonlyMap<string, unknown> | null,
  include: (entry: LayerManifest) => boolean,
): boolean {
  if (manifest === null || layerData === null) return false
  return manifest.layers.every((entry) => !include(entry) || layerData.has(entry.id))
}

export function Experience() {
  const data = useAppData()
  const readyManifest = data.status === 'ready' ? data.manifest : null
  const readyLayerData = data.status === 'ready' ? data.layerData : null
  const firstScene = useFirstSceneLoad(readyManifest)

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
  // The rest of a digest card's reached cluster (ADR-040), alongside `detailEventId` — ids only,
  // the same "what's expanded, not the expanded thing" shape `detailEventId` itself already
  // uses, re-resolved against `manifest.events` below rather than carrying `TimelineEvent`
  // objects through state. Local rather than lifted into `useTimeStore`: nothing outside this
  // component reads it, and `detailEventId` already owns the store's "is a panel open" bit —
  // this is only ever set in the same call that sets that id, and cleared with it.
  const [detailMemberIds, setDetailMemberIds] = useState<readonly string[]>([])

  // The "All events" browser (owned locally, not in the store: nothing else in the app reads
  // whether it's open). It docks above the timeline rather than covering it (`EventBrowser.tsx`'s
  // own doc comment), so it takes the live `t` directly — its own list highlight tracks the
  // playhead as the timeline scrubs, and never scrolling-to-open-event bookkeeping is needed here.
  const [eventBrowserOpen, setEventBrowserOpen] = useState(false)
  const isCompactViewport = useIsCompactViewport()

  // The timeline's animated scale lives here and is passed down to <Timeline> and the chart
  // dock, so the value under the chart's playhead sits directly above the timeline's. Section
  // windows are constants from `sections.ts`, so `useAnimatedScale`'s memoised scales only
  // recompute while the window or the symlog/linear toggle is actually animating.
  const timelineScaleKind = scaleKind === 'linear' ? 'linear' : 'symlog'
  // A leaf section (no children — e.g. the Holocene's own "Modern") draws with the fixed
  // `SYMLOG_C` rather than `symlogKnee`'s own adaptive shrink, which is meant for a section that
  // has children to make room for (see `sectionSymlogKnee`'s doc comment). Threaded into both
  // the resting/animated scale and 'steady'-mode pacing below, so
  // the ruler, the track and steady playback's own speed all agree on the same knee.
  const timelineKnee = sectionSymlogKnee(sectionId)
  const timelineScale = useAnimatedScale(sectionById(sectionId).window, timelineScaleKind, timelineKnee)

  // Where SceneView's caption is portalled: the shell's subtitle position above the timeline.
  // SceneView renders the caption inside its own full-window layer, which sits beneath the
  // lens vignette; the portal keeps the caption driven by SceneView's own dissolve (so it can
  // never drift out of sync with the image) while placing it in the HUD above the vignette.
  const [captionHost, setCaptionHost] = useState<HTMLDivElement | null>(null)

  // The expanded globe's own Globe/Map toggle's real rendered height (`Globe`'s own
  // `onViewModeToggleHeightChange` doc comment), lifted here so
  // `ShellLayout`'s `useChromeGap` can reserve room for it rather than let it overlay the orb.
  // `0` while the toggle isn't mounted (collapsed, or no WebGL).
  const [viewModeToggleHeightPx, setViewModeToggleHeightPx] = useState(0)

  // The globe's human-civilisation layer pulses an arrival's arc or marker in sympathy with its
  // own event-feed card (this feature's §4). `<EventFeed>` owns the selection rule
  // (`selectFeedEvents`) and reports it here rather than the globe re-deriving a second one; both
  // callbacks fire on a real change, never per frame.
  const [feedEventIds, setFeedEventIds] = useState<ReadonlySet<string>>(() => new Set())
  const [hoveredFeedEventId, setHoveredFeedEventId] = useState<string | null>(null)
  const onVisibleEventsChange = useCallback((ids: readonly string[]) => setFeedEventIds(new Set(ids)), [])

  // Stable across this component's per-frame playback re-renders, so `<LayerChart>` can be
  // memoised on its props: an inline arrow here would differ every frame and defeat that.
  const closeExpandedChart = useCallback(() => setExpandedChartLayerId(null), [setExpandedChartLayerId])

  useEffect(() => {
    installDevHook()
  }, [])

  // Initial t (W12a brief): open on the oldest scene, once, the first time the manifest
  // loads — never again, so it doesn't fight a later manual scrub. Nothing renders until it
  // has been applied, so the scene mounts directly on the oldest still rather than first
  // mounting at the store's default `t` and dissolving across all of history to get there.
  const [initialised, setInitialised] = useState(false)
  useEffect(() => {
    if (readyManifest === null || initialised) return
    const t0 = initialSceneT(readyManifest)
    if (t0 !== null) setT(t0)
    setInitialised(true)
  }, [readyManifest, initialised, setT])

  // Playback pacing for 'scenes' mode (ADR-016 — `scene/pacing.ts`): the wall-clock durations
  // the playhead spends crossing each scene and each dissolve, so the picture stays a pure
  // function of `t` throughout 'scenes'-mode playback. Memoised so it's only recomputed when
  // the manifest's scenes change, not every frame. `advancePlayhead` ignores this entirely in
  // 'steady' mode, so it's harmless (if wasted) to always compute it rather than branch here.
  const scenesPacing = useMemo(
    () => (readyManifest !== null ? scenePlaybackSegments(readyManifest.scenes) : []),
    [readyManifest],
  )

  // The globe's city labels (`cities.ts`'s `newCityLabels`) fade over a window sized in `t`-years
  // per city, derived from `scenesPacing` above rather than a fixed year count, so a label's real
  // on-screen duration stays close to `CITY_LABEL_FADE_SECONDS` regardless of where on the
  // timeline it appears (`scene/pacing.ts`'s `yearsForPlaybackSeconds`). `* playback.speed`
  // widens the `t`-window in step with speed, so the *real-time* duration — not the `t`-window
  // itself — is what stays constant as the speed control changes. Pure in its own inputs, and
  // `scenesPacing` is itself a pure function of the scene list (`scenePlaybackSegments`'s own
  // doc comment), so this resolver is a pure function of `t` throughout — scrubbing to the same
  // `t` at the same speed always reproduces the same label at the same opacity.
  const cityLabelFadeWindowAt = useMemo(
    () => (appearanceT: GeoTime) => yearsForPlaybackSeconds(scenesPacing, appearanceT, CITY_LABEL_FADE_SECONDS * playback.speed),
    [scenesPacing, playback.speed],
  )

  // Every scene's on-screen territory (ADR-029) — the shared geometry both 'steady'-mode pacing
  // below (`advanceSteadyPlayhead`'s rate floor) and the presentation regime just below it
  // (`steadyPacing`, crossfade vs. cut) derive from, so the two always agree about where one
  // scene's dwell ends and the next begins. Memoised like `scenesPacing` above.
  const steadyTerritories = useMemo(
    () => (readyManifest !== null ? sceneTerritories(readyManifest.scenes) : []),
    [readyManifest],
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
  // Same contract for the event browser. Opening it from the detail panel (rather than fresh)
  // carries the original "was playing" fact forward from that ref rather than re-reading
  // `playback.playing`, which by then is already false (the detail panel paused it) — see
  // `openEventBrowserFromDetail` below.
  const wasPlayingBeforeBrowserRef = useRef(false)

  // The desktop-only `/` shortcut (window-level, not `Timeline`'s own onKeyDown, since it must
  // work wherever focus is — see `isOpenEventBrowserShortcut`'s own doc comment). Ignored while
  // any other event overlay is already open, so a second press can't stack a duplicate dialog
  // over the first.
  useEffect(() => {
    if (isCompactViewport) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (eventBrowserOpen || detailEventId !== null) return
      if (!isOpenEventBrowserShortcut({ key: event.key, target: event.target })) return
      event.preventDefault()
      wasPlayingBeforeBrowserRef.current = playback.playing
      if (playback.playing) setPlaying(false)
      setEventBrowserOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isCompactViewport, eventBrowserOpen, detailEventId, playback.playing, setPlaying])

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
  const { scalarLayers, nodeLayers, rasters, eventLayers, featureSets, nodePortraits } = useMemo(
    () => buildLayers(readyManifest, readyLayerData),
    [readyManifest, readyLayerData],
  )

  // Audio (ADR-023): the one stateful hook owns Tone.js's lazy lifecycle plus the toggle's own
  // persisted enabled/volume state (see `@/audio/engine.ts`'s doc comment). It reads several
  // scalar layers at once, so `manifest` stays `null` — the engine fully inert — until every
  // layer has loaded.
  const audio = useAudioEngine({
    manifest: layersLoaded(readyManifest, readyLayerData, () => true) ? readyManifest : null,
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

  // The globe's raster sources (docs/GLOBE.md §4.1, G7; ADR-030), selected by id
  // (ADR-013) — `paleodem` (0-540 Ma) and, when published, `plates_neoproterozoic` (540-1000 Ma,
  // `null` when unusable: `Globe` then falls back to the "geography unknown" regime rather than
  // faking continents), plus the human-era basemap tiers, each `null` when its layer isn't
  // published (an older manifest). `globe-regimes`' raw event list feeds the pre-1 Ga regime
  // blend.
  const rasterLayers = useMemo((): GlobeRasterLayers | null => {
    const paleodemRaster = rasters.get('paleodem')
    if (paleodemRaster === undefined) return null
    // Every overlay kind the globe's single overlay slot can hold (ADR-041), keyed by its own
    // published layer id — `GLOBE_OVERLAY_KINDS` is the one place that set is enumerated, so a new
    // overlay kind needs no change here.
    const overlayRasters = new Map(
      GLOBE_OVERLAY_KINDS.flatMap((kind) => {
        const layerId = GLOBE_OVERLAYS[kind].layerId
        const raster = rasters.get(layerId)?.data
        return raster === undefined ? [] : [[layerId, raster] as const]
      }),
    )
    return {
      paleodem: paleodemRaster.data,
      neoproterozoic: rasters.get('plates_neoproterozoic')?.data ?? null,
      basemapT0: rasters.get('basemap_t0')?.data ?? null,
      basemapT1: rasters.get('basemap_t1')?.data ?? null,
      overlayRasters,
    }
  }, [rasters])
  // The globe tells "not published" from "published" by a layer's absence, so it mounts only once
  // every globe layer has loaded.
  const globeLayersLoaded = layersLoaded(readyManifest, readyLayerData, (entry) => entry.surface === 'globe')
  const regimeEvents = useMemo(() => rawEvents(eventLayers, 'globe-regimes'), [eventLayers])
  const iceAgeLayers = useMemo(() => iceAgeLayersFrom(scalarLayers), [scalarLayers])
  // ADR-035's `cities` FeatureSet, selected by id the same way the raster layers above are.
  const cities = featureSets.get('cities')?.data.features ?? null

  // Every scene is a timeline checkpoint, so the stills themselves are marked and steppable on
  // the axis, not only the data-driven events. Memoised so the track's pip layout only reruns
  // when the manifest does.
  const checkpoints = useMemo(
    (): TimelineCheckpoint[] =>
      readyManifest !== null
        ? readyManifest.scenes.map((scene) => ({
            id: scene.id,
            t: scene.t,
            label: scene.title,
            thumbnailUrl: resolveAssetUrl(readyManifest.assetBase, scene.thumbnail),
          }))
        : [],
    [readyManifest],
  )

  // Only chartable scalars get a HUD readout: each one opens the chart dock. `isHiddenFromHud`
  // additionally excludes a small, reversible set of layers (currently just CO2) from this list
  // specifically — see `@/layers/hudVisibility.ts` for the rationale and revert instructions.
  const hudScalarEntries = useMemo(
    () =>
      (readyManifest?.layers ?? []).filter(
        (l) => l.surface === 'hud' && l.dataKind === 'scalar' && l.chartable && !isHiddenFromHud(l.id),
      ),
    [readyManifest],
  )
  const lineageEntry = readyManifest?.layers.find((l) => l.dataKind === 'node')
  const nodeLayer = lineageEntry ? nodeLayers.get(lineageEntry.id) : undefined
  const lineagePortraits = lineageEntry ? (nodePortraits.get(lineageEntry.id) ?? null) : null

  const eraShortcuts = useMemo(
    () => <EraShortcuts sectionId={sectionId} onSelectSection={selectSection} />,
    [sectionId, selectSection],
  )
  const captionSlot = useMemo(
    () => <div ref={setCaptionHost} className={styles.captionHost} data-testid="scene-caption" />,
    [setCaptionHost],
  )

  // Clicking or tapping a checkpoint cluster marker (ADR-019) reports its members here — purely
  // as a notification. `<Timeline>`'s own `ScrubTrack` opens and owns an in-track member-list
  // popover itself (ADR-021), so this component has no UI of its own to build in response; kept
  // as a no-op rather than removed, since the prop still exists for a caller that wants to know
  // (analytics, say).
  const handleOpenCluster = (_members: readonly TimelineCheckpoint[]): void => {}

  if (data.status === 'loading' || (data.status === 'ready' && (!initialised || !firstScene.settled))) {
    return <LoadingScreen progress={loadingProgress(data.status === 'ready', firstScene.fractions)} />
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
  // The rest of a digest card's cluster (ADR-040), resolved the same way. `detailMemberIds`
  // holds every reached member's id including the headline's own, so this is `EventDetailPanel`'s
  // whole `members` array — a lone event's own singleton "cluster" included, which is exactly
  // what makes a single-member card behave identically to before.
  const detailMembers = detailMemberIds
    .map((id) => manifest.events.find((e) => e.id === id))
    .filter((e): e is TimelineEvent => e !== undefined)

  // ADR-034: the globe plots the *dominant* scene's location — the same scene whose caption and
  // image are on screen (`dominantScene`, the one rule `SceneView` already uses), so the marker
  // and the picture can never disagree about which place is being shown. `?? null` covers both a
  // scene with no `location` at all and an empty scene list.
  const currentSceneLocation =
    manifest.scenes.length > 0 ? (dominantScene(sceneAt(manifest.scenes, t)).location ?? null) : null

  const openEventDetail = (event: TimelineEvent, members: readonly TimelineEvent[]): void => {
    wasPlayingBeforeDetailRef.current = playback.playing
    if (playback.playing) setPlaying(false)
    setDetailEventId(event.id)
    setDetailMemberIds(members.map((member) => member.id))
  }

  const closeEventDetail = (): void => {
    setDetailEventId(null)
    setDetailMemberIds([])
    if (wasPlayingBeforeDetailRef.current) {
      wasPlayingBeforeDetailRef.current = false
      setPlaying(true)
    }
  }

  // Opened from the detail panel's own "All events" action: replaces it rather than layering
  // over it, carrying the "was playing before any overlay opened" fact forward from the detail
  // panel's ref rather than resuming (the panel already paused).
  const openEventBrowserFromDetail = (): void => {
    wasPlayingBeforeBrowserRef.current = wasPlayingBeforeDetailRef.current
    wasPlayingBeforeDetailRef.current = false
    setDetailEventId(null)
    setDetailMemberIds([])
    setEventBrowserOpen(true)
  }

  const closeEventBrowser = (): void => {
    setEventBrowserOpen(false)
    if (wasPlayingBeforeBrowserRef.current) {
      wasPlayingBeforeBrowserRef.current = false
      setPlaying(true)
    }
  }

  // A row was activated: jumps `t` and shows the event's detail card, same as the feed's own
  // "Show on timeline" (§ EventDetailPanel) — closing the browser without resuming playback even
  // if it had been playing, since resuming would immediately carry the playhead away from the
  // place just asked for.
  const activateBrowserEvent = (event: TimelineEvent): void => {
    setT(placementT(event))
    setEventBrowserOpen(false)
    wasPlayingBeforeBrowserRef.current = false
    wasPlayingBeforeDetailRef.current = false
    setDetailEventId(event.id)
    setDetailMemberIds([event.id])
  }

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
        viewModeToggleHeightPx={viewModeToggleHeightPx}
        eventLegend={EVENT_TAG_LEGEND}
        feedbackLink={FEEDBACK_LINK}
        scene={
          manifest.scenes.length > 0 ? (
            <SceneView
              t={t}
              scenes={manifest.scenes}
              assetBase={manifest.assetBase}
              renderCaption={renderCaption}
              regime={steadyRegime.regime}
              covered={globeExpanded}
            />
          ) : (
            <div className={styles.placeholder}>No scenes in manifest.</div>
          )
        }
        globe={
          !globeLayersLoaded ? null : rasterLayers ? (
            <Globe
              t={t}
              rasterLayers={rasterLayers}
              assetBase={manifest.assetBase}
              regimeEvents={regimeEvents}
              effectEvents={manifest.events}
              iceAgeLayers={iceAgeLayers}
              expanded={globeExpanded}
              onToggleExpand={() => setGlobeExpanded(!globeExpanded)}
              cities={cities}
              sceneLocation={currentSceneLocation}
              playbackBaseRate={playback.baseRate}
              cityLabelFadeWindowAt={cityLabelFadeWindowAt}
              feedEventIds={feedEventIds}
              hoveredFeedEventId={hoveredFeedEventId}
              onViewModeToggleHeightChange={setViewModeToggleHeightPx}
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
              if (isPopulationReadoutHiddenAt(entry.id, layer.timeDomain, t)) return null
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
        feed={
          <EventFeed
            t={t}
            events={manifest.events}
            onEventActivate={openEventDetail}
            onVisibleEventsChange={onVisibleEventsChange}
            onCardHoverChange={setHoveredFeedEventId}
          />
        }
        title={<TimeTitle t={t} />}
        badge={isStub ? <span className={styles.stubBadge}>Stub data</span> : null}
        eraShortcuts={eraShortcuts}
        ancestor={
          nodeLayer ? <AncestorPanel layer={nodeLayer} t={t} assetBase={manifest.assetBase} portraits={lineagePortraits} /> : null
        }
        caption={captionSlot}
        chart={
          expandedChartLayer ? (
            <LayerChart layer={expandedChartLayer} t={t} scale={timelineScale} onClose={closeExpandedChart} />
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
            overlayOpen={globeExpanded || expandedChartLayerId !== null}
            sound={<SoundToggle {...audio} />}
          />
        }
      />
      {detailEvent && (
        <EventDetailPanel
          event={detailEvent}
          members={detailMembers}
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
            setDetailMemberIds([])
          }}
          onOpenBrowser={openEventBrowserFromDetail}
        />
      )}
      {eventBrowserOpen && (
        <EventBrowser events={manifest.events} t={t} onClose={closeEventBrowser} onActivate={activateBrowserEvent} />
      )}
      {/* Mounted here, not inside `ShellLayout`, which stays a layout component. It sits after
          the shell so its own layer is that element's sibling, above the whole HUD, and it is
          rendered only past the loading/error branches above so every control it rings is
          already in the DOM to be measured. */}
      {ONBOARDING_TOUR}
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
