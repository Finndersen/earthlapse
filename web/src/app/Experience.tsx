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
import {
  adjacentEvent,
  EventBrowser,
  EventDetailPanel,
  EventFeed,
  EventTagLegend,
  placementT,
  useIsCompactViewport,
  type BrowseEventsFilters,
  type EventStep,
} from '@/events'
import { buildArrivalIndex, buildEmpireIndex, EmpireDetailPanel, Globe, GLOBE_OVERLAYS, GLOBE_OVERLAY_KINDS, traceToOrigin } from '@/globe'
import { iceAgeLayersFrom } from '@/globe/ice'
import type { GlobeRasterLayers } from '@/globe'
import { AncestorPanel, isHiddenFromHud, isPopulationReadoutHiddenAt, ScalarReadout, Sparkline } from '@/layers'
import { OnboardingTour } from '@/onboarding'
import {
  dominantScene,
  PREFETCH_LOOKAHEAD_SECONDS,
  resolveAssetUrl,
  sceneAt,
  scenePlaybackSegments,
  sceneTerritories,
  SceneView,
  steadyFrameRegime,
  yearsForPlaybackSeconds,
} from '@/scene'
import type { PresentationRegime } from '@/scene'
import { Panel, ShellLayout } from '@/shell'
import { installDevHook } from '@/store/devHook'
import { useTimeStore } from '@/store/time'
import {
  advancePlayhead,
  advanceSteadyPlayhead,
  createSymlogScale,
  eraNameForTime,
  EraShortcuts,
  formatCompanionReading,
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
import type { GeoTime, TimelineEvent, TimeScale } from '@/types/layer'
import type { LayerManifest, Manifest, Scene } from '@/types/manifest'

import { buildLayers, rawEvents } from './buildLayers'
import { FeedbackLink } from './FeedbackLink'
import { initialSceneT, loadingProgress, useFirstSceneLoad } from './firstScene'
import { LoadingScreen } from './LoadingScreen'
import styles from './page.module.css'
import { useAppData } from './useAppData'
import { usePlaybackHold } from './usePlaybackHold'

/** The whole of Earth's history. The timeline's own window is the selected era section's
 *  (ADR-024); this is only for the scales below, which must not follow the selection. */
const FULL_DOMAIN: TimeWindow = [0, EARTH_FORMATION]

/** The full-domain *symlog* `TimeScale`, shared by the two things in this component that must
 *  not track the timeline's current section or scale-kind: `advancePlayhead`'s `'scenes'`-mode
 *  pacing (always symlog, per ADR-016 — a scene's dwell/dissolve durations don't change when the
 *  user flips the linear toggle) and the event feed's lookback (selecting a short section must not shrink "what just happened" to a
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
  const setYearsPerSecond = useTimeStore((s) => s.setYearsPerSecond)
  const setPlaybackMode = useTimeStore((s) => s.setPlaybackMode)
  const globeExpanded = useTimeStore((s) => s.globeExpanded)
  const setGlobeExpanded = useTimeStore((s) => s.setGlobeExpanded)
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
  // The empire lineage whose card is open (ADR-059). It docks where the event card docks, so at
  // most one of the two is open.
  const [empireDetailId, setEmpireDetailId] = useState<string | null>(null)
  const isCompactViewport = useIsCompactViewport()

  // The timeline's animated scale lives here and is passed down to <Timeline>. Section
  // windows are constants from `sections.ts`, so `useAnimatedScale`'s memoised scales only
  // recompute while the window or the symlog/linear toggle is actually animating.
  const timelineScaleKind = scaleKind === 'linear' ? 'linear' : 'symlog'
  // A leaf section (no children — e.g. the Holocene's own "Modern") draws with the fixed
  // `SYMLOG_C` rather than `symlogKnee`'s own adaptive shrink, which is meant for a section that
  // has children to make room for (see `sectionSymlogKnee`'s doc comment).
  const timelineKnee = sectionSymlogKnee(sectionId)
  const timelineScale = useAnimatedScale(sectionById(sectionId).window, timelineScaleKind, timelineKnee)

  // Where SceneView's caption is portalled: the shell's subtitle position above the timeline.
  // SceneView renders the caption inside its own full-window layer, which sits beneath the
  // lens vignette; the portal keeps the caption driven by SceneView's own dissolve (so it can
  // never drift out of sync with the image) while placing it in the HUD above the vignette.
  const [captionHost, setCaptionHost] = useState<HTMLDivElement | null>(null)
  // The scene whose full caption passage is open in a panel. Only the short-landscape layout
  // offers the button that opens it, since that layout shows the caption's title alone (ADR-048).
  // Like the event detail panel, opening it pauses playback and closing it resumes, so the scene
  // under the panel stays the one it describes.
  const [captionDetailScene, setCaptionDetailScene] = useState<Scene | null>(null)
  const captionDetailHold = usePlaybackHold(playback.playing, setPlaying)

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

  useEffect(() => {
    installDevHook()
  }, [])

  // Initial t: open on the oldest scene, once, the first time the manifest
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

  // Where playback puts `t` after `PREFETCH_LOOKAHEAD_SECONDS`, by the same advance as the loop
  // below, so `SceneView` loads scenes in the order playback reaches them.
  const prefetchHorizonT = !playback.playing
    ? undefined
    : playback.mode === 'steady'
      ? advanceSteadyPlayhead(t, PREFETCH_LOOKAHEAD_SECONDS, playback, steadyTerritories)
      : advancePlayhead(t, PREFETCH_LOOKAHEAD_SECONDS, playback, FULL_DOMAIN_SYMLOG_SCALE, scenesPacing)

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
  // such a frame reading 'crossfade' too: see its own comment.
  const [steadyRegime, setSteadyRegime] = useState<{ regime: PresentationRegime; floored: boolean }>({
    regime: 'crossfade',
    floored: false,
  })
  // The `t` this component's own playback loop last advanced to and committed via `setT` — used
  // by `onFrame` below to tell "the loop's own next tick" apart from "something else moved `t`
  // since" (a scrub, a checkpoint/event jump, a keyboard step). `null` whenever there is no such
  // reference to compare against: before the loop has ever advanced anything, and reset on every
  // stop/(re)start so a resume never compares the fresh first frame against a many-seconds-stale
  // value left over from before playback paused. Without it, a scrub or seek made while steady
  // playback keeps running would take its regime from whatever territory the scrubbed-to `t`
  // lands in, and could hard-cut with no rate limit.
  const lastAdvancedTRef = useRef<GeoTime | null>(null)
  useEffect(() => {
    if (!playback.playing) {
      setSteadyRegime({ regime: 'crossfade', floored: false })
      lastAdvancedTRef.current = null
    }
  }, [playback.playing])

  // The event browser and the event detail card share one docked surface (`@/events`'s
  // `EventDock`), so they share one playback hold too: taken when the surface opens from closed,
  // kept across every switch between list and card, and resumed only when the surface closes.
  const eventOverlayHold = usePlaybackHold(playback.playing, setPlaying)
  const eventOverlayOpen = eventBrowserOpen || detailEventId !== null || empireDetailId !== null
  // Whether the open card came from a browser row, so its back button returns to the list with the
  // search and tags it was left with rather than a fresh one.
  const [detailFromBrowser, setDetailFromBrowser] = useState(false)
  const browserFilters = useRef<BrowseEventsFilters>({ query: '', tags: [] })

  const showEventBrowser = useCallback(
    (keepFilters: boolean): void => {
      if (!eventOverlayOpen) eventOverlayHold.pause()
      if (!keepFilters) browserFilters.current = { query: '', tags: [] }
      setDetailFromBrowser(false)
      setDetailEventId(null)
      setDetailMemberIds([])
      setEmpireDetailId(null)
      setEventBrowserOpen(true)
    },
    [eventOverlayOpen, eventOverlayHold, setDetailEventId],
  )

  // Opens the list fresh, from the `/` shortcut or the feed's "All events" button, in place of an
  // open card; a no-op while the list is already open.
  const openEventBrowser = useCallback((): void => {
    if (!eventBrowserOpen) showEventBrowser(false)
  }, [eventBrowserOpen, showEventBrowser])

  // The desktop-only `/` shortcut (window-level, not `Timeline`'s own onKeyDown, since it must
  // work wherever focus is — see `isOpenEventBrowserShortcut`'s own doc comment).
  useEffect(() => {
    if (isCompactViewport) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (eventBrowserOpen) return
      if (!isOpenEventBrowserShortcut({ key: event.key, target: event.target })) return
      event.preventDefault()
      openEventBrowser()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isCompactViewport, eventBrowserOpen, openEventBrowser])

  useEffect(() => {
    if (!playback.playing) {
      smoothedRateRef.current = null
      setRatePerSecond(null)
    }
  }, [playback.playing])

  // The playback loop (DESIGN §3): the one place `t` advances on its own. 'scenes' mode always
  // paces in full-domain symlog u, whatever the toggle or section (ADR-016). 'steady' mode
  // moves at its literal years-per-second rate (ADR-050) and, per scene territory, floors it
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
          ? advanceSteadyPlayhead(t, dtSeconds, playback, steadyTerritories)
          : advancePlayhead(t, dtSeconds, playback, FULL_DOMAIN_SYMLOG_SCALE, scenesPacing)

      if (playback.mode === 'steady') {
        // Evaluated at `next`, the `t` this frame renders, and forced to crossfade by `seeked`
        // (see `steadyFrameRegime`). A large dt crossing several territories in one call reads
        // only the last one.
        const pacing = steadyFrameRegime(steadyTerritories, next, playback.yearsPerSecond, seeked)
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
  const { scalarLayers, nodeLayers, rasters, eventLayers, featureSets, territories, nodePortraits } = useMemo(
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
    // the same `steadyRegime` that drives `SceneView`'s presented mix and the rate readout's
    // floored state below, so all three always agree about which frames are cutting.
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
  // ADR-059's `empires` territories, indexed once per published layer file.
  const empireLayer = territories.get('empires')?.data ?? null
  const empires = useMemo(() => (empireLayer === null ? null : buildEmpireIndex(empireLayer)), [empireLayer])

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

  // Only chartable scalars get a HUD readout and sparkline. `isHiddenFromHud`
  // additionally excludes a small, reversible set of layers (currently just CO2) from this list
  // specifically — see `@/layers/hudVisibility.ts` for the rationale and revert instructions.
  const hudScalarEntries = useMemo(
    () =>
      (readyManifest?.layers ?? []).filter(
        (l) => l.surface === 'hud' && l.dataKind === 'scalar' && l.chartable && !isHiddenFromHud(l.id),
      ),
    [readyManifest],
  )
  // The derived chain each arrival continues (ADR-032) — the detail panel's Route section lists it.
  const arrivalIndex = useMemo(() => buildArrivalIndex(readyManifest?.events ?? []), [readyManifest])
  const arrivalChainFor = useCallback(
    (eventId: string) =>
      traceToOrigin(arrivalIndex, eventId)
        .slice(1)
        .map((id) => ({ id, label: arrivalIndex.byEventId.get(id)?.event.label ?? id })),
    [arrivalIndex],
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

  // The event feed card an activation opened, if any. Looked up by id
  // rather than kept as the `TimelineEvent` itself, so the store only ever holds a plain id, the
  // same "what's expanded, not the expanded thing" shape the other overlays use.
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

  // Every way the card opens or changes event. `seek` moves the timeline to the event, so the scene
  // behind the card is the event's own; the globe's arrivals and Route links leave `t` alone.
  const showEventDetail = (
    event: TimelineEvent,
    members: readonly TimelineEvent[],
    { seek, fromBrowser }: { seek: boolean; fromBrowser: boolean },
  ): void => {
    if (!eventOverlayOpen) eventOverlayHold.pause()
    if (seek) setT(placementT(event))
    setEventBrowserOpen(false)
    setEmpireDetailId(null)
    setDetailFromBrowser(fromBrowser)
    setDetailEventId(event.id)
    setDetailMemberIds(members.map((member) => member.id))
  }

  const closeEventOverlay = (): void => {
    setEventBrowserOpen(false)
    setEmpireDetailId(null)
    setDetailFromBrowser(false)
    setDetailEventId(null)
    setDetailMemberIds([])
    eventOverlayHold.resume()
  }

  // A feed card: a lone event or a digest of its cluster, which seeks to the headline event.
  const openEventDetail = (event: TimelineEvent, members: readonly TimelineEvent[]): void =>
    showEventDetail(event, members, { seek: true, fromBrowser: false })

  // A click, or a second tap, on an arrival on the expanded globe. Opens over the globe, which
  // stays expanded underneath.
  const activateGlobeEvent = (eventId: string): void => {
    const event = manifest.events.find((e) => e.id === eventId)
    if (event !== undefined) showEventDetail(event, [event], { seek: false, fromBrowser: false })
  }

  // A click, or a second tap, on an empire's territory or label on the expanded globe: its card
  // replaces any open event card or list, and leaves `t` alone.
  const activateGlobeEmpire = (lineage: string): void => {
    if (!eventOverlayOpen) eventOverlayHold.pause()
    setEventBrowserOpen(false)
    setDetailFromBrowser(false)
    setDetailEventId(null)
    setDetailMemberIds([])
    setEmpireDetailId(lineage)
  }
  const empireDetail = empireDetailId === null ? null : (empires?.lineages.get(empireDetailId) ?? null)

  // A Route section's chain link: replaces the card's event.
  const openLinkedEventDetail = (eventId: string): void => {
    const event = manifest.events.find((e) => e.id === eventId)
    if (event !== undefined) showEventDetail(event, [event], { seek: false, fromBrowser: detailFromBrowser })
  }

  const stepEventDetail = (direction: EventStep): void => {
    const neighbour = detailEvent === null ? null : adjacentEvent(manifest.events, detailEvent.id, direction)
    if (neighbour !== null) showEventDetail(neighbour, [neighbour], { seek: true, fromBrowser: detailFromBrowser })
  }

  const openCaptionDetail = (scene: Scene): void => {
    captionDetailHold.pause()
    setCaptionDetailScene(scene)
  }

  const closeCaptionDetail = (): void => {
    setCaptionDetailScene(null)
    captionDetailHold.resume()
  }

  // A browser row: shows its card in the list's place, the timeline moved to the event.
  const activateBrowserEvent = (event: TimelineEvent): void =>
    showEventDetail(event, [event], { seek: true, fromBrowser: true })

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
            <button
              type="button"
              className={styles.captionButton}
              aria-label={`${scene.title} — show description`}
              aria-haspopup="dialog"
              data-testid="scene-caption-button"
              onClick={() => openCaptionDetail(scene)}
            >
              <span className={styles.captionTitle}>{scene.title}</span>
              <svg className={styles.captionInfo} viewBox="0 0 16 16" aria-hidden="true" focusable="false" data-testid="scene-caption-info">
                <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <circle cx="8" cy="4.9" r="0.85" fill="currentColor" />
                <path d="M8 7.2v4.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
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
              prefetchHorizonT={prefetchHorizonT}
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
              empires={empires}
              sceneLocation={currentSceneLocation}
              playbackBaseRate={playback.baseRate}
              cityLabelFadeWindowAt={cityLabelFadeWindowAt}
              feedEventIds={feedEventIds}
              hoveredFeedEventId={hoveredFeedEventId}
              onViewModeToggleHeightChange={setViewModeToggleHeightPx}
              onActivateEvent={activateGlobeEvent}
              onActivateEmpire={activateGlobeEmpire}
              selectedEmpire={empireDetail === null ? null : empireDetailId}
              eventDetailOpen={detailEventId !== null}
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
                  <div className={styles.sparkline}>
                    <Sparkline layer={layer} t={t} />
                  </div>
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
            onOpenBrowser={openEventBrowser}
          />
        }
        title={<TimeTitle t={t} />}
        badge={isStub ? <span className={styles.stubBadge}>Stub data</span> : null}
        eraShortcuts={eraShortcuts}
        ancestor={
          nodeLayer ? <AncestorPanel layer={nodeLayer} t={t} assetBase={manifest.assetBase} portraits={lineagePortraits} /> : null
        }
        caption={captionSlot}
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
              // Only what changed: `setPlaybackMode` and `setYearsPerSecond` carry the steady
              // context-default bookkeeping, which an unrelated play/pause must not trigger.
              if (next.playing !== playback.playing) setPlaying(next.playing)
              if (next.speed !== playback.speed) setSpeed(next.speed)
              if (next.yearsPerSecond !== playback.yearsPerSecond) setYearsPerSecond(next.yearsPerSecond)
              if (next.mode !== playback.mode) setPlaybackMode(next.mode)
            }}
            onOpenCluster={handleOpenCluster}
            ratePerSecond={ratePerSecond}
            rateFloored={steadyRegime.floored}
            overlayOpen={globeExpanded}
            sound={<SoundToggle {...audio} />}
          />
        }
      />
      {detailEvent && (
        <EventDetailPanel
          event={detailEvent}
          members={detailMembers}
          onClose={closeEventOverlay}
          onOpenBrowser={() => showEventBrowser(detailFromBrowser)}
          arrivalChainFor={arrivalChainFor}
          onOpenEvent={openLinkedEventDetail}
          neighbours={{
            older: adjacentEvent(manifest.events, detailEvent.id, 'older'),
            newer: adjacentEvent(manifest.events, detailEvent.id, 'newer'),
          }}
          onStep={stepEventDetail}
        />
      )}
      {empireDetail && (
        <EmpireDetailPanel
          summary={empireDetail}
          t={t}
          relatedEvents={empireDetail.lineage.events.flatMap((id) => {
            const event = manifest.events.find((e) => e.id === id)
            return event === undefined ? [] : [{ id: event.id, label: event.label }]
          })}
          onClose={closeEventOverlay}
          onOpenEvent={activateGlobeEvent}
          onJumpTo={setT}
        />
      )}
      {eventBrowserOpen && (
        <EventBrowser
          events={manifest.events}
          t={t}
          onClose={closeEventOverlay}
          onActivate={activateBrowserEvent}
          initialFilters={browserFilters.current}
          onFiltersChange={(filters) => {
            browserFilters.current = filters
          }}
        />
      )}
      {captionDetailScene && (
        <Panel label={captionDetailScene.title} onClose={closeCaptionDetail}>
          <p className={styles.captionDetail} data-testid="scene-caption-detail">
            {captionDetailScene.caption}
          </p>
        </Panel>
      )}
      {/* Mounted here, not inside `ShellLayout`, which stays a layout component. It sits after
          the shell so its own layer is that element's sibling, above the whole HUD, and it is
          rendered only past the loading/error branches above so every control it rings is
          already in the DOM to be measured. */}
      {ONBOARDING_TOUR}
    </>
  )
}

/** The lens's headline: the current time in large light numerals; beneath it the eon/era,
 *  after the time's other reading where it has one ("533 years ago" under "1492"). */
function TimeTitle({ t }: { t: GeoTime }) {
  const companion = formatCompanionReading(t)
  return (
    <div className={styles.timeTitle} data-testid="time-title">
      <span className={styles.time}>{formatGeoTime(t)}</span>
      <span className={styles.era}>
        <span>
          {companion !== null && <span className={styles.companion}>{companion}</span>}
          <span className={styles.eraName}>
            {companion !== null && ' · '}
            {eraNameForTime(t)}
          </span>
        </span>
      </span>
    </div>
  )
}
