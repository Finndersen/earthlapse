/**
 * The one stateful, Tone.js-owning hook (ADR-023, `audio-engine-spec.md`). Lazy-loads `tone`
 * only after the viewer's first "sound on" click, owns every player/synth, and writes
 * `stemGains`/`sceneSoundLoopGains`/`scoreParams` into their live gain/parameter values on a
 * throttled tick — never recreating a node, never blocking the render loop, never touching
 * `localStorage` outside a click handler's own effect.
 *
 * Deliberate, documented deviation from `audio-engine-spec.md`'s literal signature: the spec
 * writes `useAudioEngine(input): void` with `enabled`/`masterVolume` supplied by the caller,
 * on the assumption `Experience.tsx` already holds that state. It doesn't, and the spec's own
 * scope boundary ("its only required changes to files outside itself are: one hook call + one
 * component render inside Experience.tsx") is the more fundamental constraint of the two — a
 * second piece of app-wide toggle state has nowhere to live in `Experience.tsx` without either
 * growing that file or duplicating `useTimeStore`'s "the one piece of global state" role
 * (`store/time.ts`). So this hook owns the toggle's persisted state itself and returns the
 * controls `<SoundToggle>` renders from — `Experience.tsx` gets exactly one hook call and one
 * component render, and this package still owns 100% of the audio state, matching the module
 * layout's own "the one stateful hook" framing more literally than the drafted signature does.
 *
 * Also takes `scalarLayers` (`Experience.tsx`'s own already-built `buildLayers` output)
 * instead of re-deriving `co2`/`day_length` values from `manifest.layers` itself — reusing the
 * `Layer<ScalarValue>.sample(t)` abstraction every other HUD readout already reads through,
 * rather than a second, duplicate fetch-and-parse path for the same published data.
 */

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { resolveAssetUrl, sceneAt, usePresentedSceneMix } from '@/scene'
import type { GeoTime, Layer, ScalarValue } from '@/types/layer'
import type { AudioStem, Manifest } from '@/types/manifest'

import { DEFAULT_MASTER_VOLUME, loadAudioPrefs, saveAudioEnabled, saveAudioMasterVolume } from './persistence'
import type { TimeWindow } from './ramp'
import { scoreParams, type ScoreParams } from './score'
import { sceneSoundLoopGains, useSceneSoundOnceTrigger } from './sceneSound'
import { stemGains } from './stemGains'
import { STEM_IDS, type AmbienceStemId } from './stemIds'

/** How often live gain/parameter values are recomputed and written (ADR-023's engine
 *  contract: "full 60fps is unnecessary for a gain ramp; ~10-20 Hz is plenty and cheaper"). */
const TICK_MS = 80
/** Ramp time for every `rampTo` call below — long enough that a stem or score parameter
 *  changing target every tick never zippers, short enough to track a fast scrub. */
const GAIN_SMOOTH_SECONDS = 0.5
/** ADR-023 §2: the score recedes by up to 60% while a scene's own sound is prominent. */
const SCORE_DUCK_AMOUNT = 0.6
/** A fired once-mode effect ducks the score for at most this long, even if a stem's own
 *  published `durationSeconds` (ADR-023 §4/§5) is longer or missing. */
const ONCE_DUCK_MAX_SECONDS = 20
const AMBIENCE_FADE_SECONDS = 1.5
const ONCE_FADE_SECONDS = 0.05

export interface AudioEngineControls {
  enabled: boolean
  masterVolume: number
  setEnabled: (enabled: boolean) => void
  setMasterVolume: (volume: number) => void
}

export interface UseAudioEngineInput {
  /** `null` while `useAppData` is still loading (`Experience.tsx` calls every hook
   *  unconditionally, before its own `data.status === 'ready'` branch — matching how
   *  `buildLayers(manifest: Manifest | null, ...)` already tolerates the same "not loaded
   *  yet" state) — the engine stays fully inert until it arrives. */
  manifest: Manifest | null
  t: GeoTime
  /** `useTimeStore(s => s.playback.playing)` — see `sceneSound.ts`'s once-trigger contract:
   *  true exactly while `t` is advancing under the playback clock, never merely "was moving a
   *  moment ago". */
  playing: boolean
  scalarLayers: ReadonlyMap<string, Layer<ScalarValue>>
}

function clampVolume(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** Normalises a manifest-sourced `[tMin, tMax]` pair into `ramp.ts`'s own `tMin <= tMax`
 *  invariant. `bump`/`rampLog` assert that invariant strictly (a real internal-programming-
 *  error signal for windows this package constructs itself) — but `manifest.events` is data
 *  fetched over the network, and a published event with its two bounds swapped (a data bug
 *  upstream, not a code bug here) must never turn into an uncaught throw inside this package's
 *  tick loop. Normalising once, at the point this untrusted data enters the package, is the
 *  boundary this belongs at — everything downstream (`bump`/`rampLog`) can then keep asserting
 *  the invariant strictly. */
function normaliseWindow(tMin: GeoTime, tMax: GeoTime): TimeWindow {
  return { tMin: Math.min(tMin, tMax), tMax: Math.max(tMin, tMax) }
}

function floodBasaltWindows(manifest: Manifest): TimeWindow[] {
  const windows: TimeWindow[] = []
  for (const event of manifest.events) {
    if (event.effect?.kind !== 'flood-basalt') continue
    for (const w of event.effect.windows) windows.push(normaliseWindow(w.tMin, w.tMax))
  }
  return windows
}

function catastropheWindows(manifest: Manifest): TimeWindow[] {
  return manifest.events.filter((e) => e.tags?.includes('catastrophe')).map((e) => normaliseWindow(e.tMin, e.tMax))
}

function scalarAt(layer: Layer<ScalarValue> | undefined, t: GeoTime): number | null {
  if (layer === undefined) return null
  return layer.sample(t)?.value ?? null
}

/** A harmless placeholder `SceneMix` for while `manifest` is `null` or has no scenes yet —
 *  `sceneAt` throws on an empty scene list, and `usePresentedSceneMix`/
 *  `useSceneSoundOnceTrigger` must still be called on every render (rules of hooks) even
 *  before there is a real manifest to derive a target from. Carries no `sound`, so it never
 *  contributes anything audible. */
const EMPTY_SCENE: Manifest['scenes'][number] = {
  id: '__audio_engine_empty__',
  t: 0,
  chapterId: '',
  image: '',
  shot: 'WIDE_RIDGE',
  caption: '',
  width: 1,
  height: 1,
}

// -------------------------------------------------------------------------- Tone.js runtime
//
// Every Tone type below is named only via `typeof import('tone')` / `InstanceType<...>` — an
// `import type` erases entirely at build time, so this file still never pulls the real `tone`
// module in until `loadTone()` actually runs, inside the `enabled` effect below.

type ToneModule = typeof import('tone')
type ToneGain = InstanceType<ToneModule['Gain']>
type TonePlayer = InstanceType<ToneModule['Player']>

interface StemVoice {
  player: TonePlayer
  gain: ToneGain
  stem: AudioStem
}

interface ScoreVoice {
  update: (params: ScoreParams, duckMultiplier: number) => void
  dispose: () => void
}

interface ToneRuntime {
  masterGain: ToneGain
  stemPlayers: Map<AmbienceStemId, StemVoice>
  onceBus: ToneGain
  score: ScoreVoice
  dispose: () => void
}

async function loadTone(): Promise<ToneModule> {
  return import('tone')
}

/** Development-only automation hook, mirroring `store/devHook.ts`'s own `window.__earthtime`
 *  (same `NODE_ENV === 'development'` gate, dead-code-eliminated from a production build) —
 *  kept local to this package rather than added to that file, since this package's scope
 *  boundary keeps it out of `web/src/store/**`. Exposes just enough for a browser-driven check
 *  to confirm the `AudioContext` is actually running after the sound toggle is clicked, since
 *  a headless run can't listen for the real thing. */
declare global {
  interface Window {
    __earthtimeAudio?: { getContextState: () => AudioContextState }
  }
}

function installAudioDevHook(Tone: ToneModule): void {
  if (process.env.NODE_ENV !== 'development') return
  window.__earthtimeAudio = { getContextState: () => Tone.getContext().state }
}

function createScoreVoice(Tone: ToneModule, destination: ToneGain): ScoreVoice {
  const voiceGain = new Tone.Gain(0.16)
  const filter = new Tone.Filter(1200, 'lowpass').connect(voiceGain)
  const root = new Tone.Oscillator(55, 'sine').connect(filter).start()
  const fifth = new Tone.Oscillator(55 * 1.5, 'sine').connect(filter).start()
  const tremolo = new Tone.Tremolo(0.1, 0.35).start()
  voiceGain.connect(tremolo)
  const outGain = new Tone.Gain(1).connect(destination)
  tremolo.connect(outGain)
  // "Never loops, never ends" (ADR-023 §2): two independent, slow, incommensurate-rate LFOs
  // continuously nudge filter cutoff and detune so the same WorldState(t) never sounds
  // identical twice — a texture layered on top of the parameters `scoreParams` computes, not
  // part of that pure function itself.
  const cutoffDrift = new Tone.LFO(0.0137, -180, 180).start()
  cutoffDrift.connect(filter.detune)
  const detuneDrift = new Tone.LFO(0.0091, -6, 6).start()
  detuneDrift.connect(fifth.detune)

  return {
    update(params, duckMultiplier) {
      root.frequency.rampTo(params.rootHz, GAIN_SMOOTH_SECONDS)
      // Perfect fifth (dissonance 0) narrows toward a tritone-ish interval as dissonance
      // rises toward 1 — the "open/major -> minor/dissonant cluster" shift ADR-023 §2 names.
      const intervalRatio = 1.5 - 0.146 * params.dissonance
      fifth.frequency.rampTo(params.rootHz * intervalRatio, GAIN_SMOOTH_SECONDS)
      filter.frequency.rampTo(params.filterCutoffHz, GAIN_SMOOTH_SECONDS)
      tremolo.frequency.rampTo(params.pulseHz, GAIN_SMOOTH_SECONDS)
      outGain.gain.rampTo(duckMultiplier, GAIN_SMOOTH_SECONDS)
    },
    dispose() {
      cutoffDrift.dispose()
      detuneDrift.dispose()
      root.dispose()
      fifth.dispose()
      filter.dispose()
      voiceGain.dispose()
      tremolo.dispose()
      outGain.dispose()
    },
  }
}

function buildRuntime(Tone: ToneModule, manifest: Manifest, onMissingStem: (id: string) => void): ToneRuntime {
  const masterGain = new Tone.Gain(1).toDestination()
  const ambienceBus = new Tone.Gain(1).connect(masterGain)
  const onceBus = new Tone.Gain(1).connect(masterGain)

  const stemPlayers = new Map<AmbienceStemId, StemVoice>()
  for (const id of STEM_IDS) {
    const stem = manifest.audioStems.find((s) => s.id === id)
    if (stem === undefined) {
      onMissingStem(id)
      continue
    }
    const gain = new Tone.Gain(0).connect(ambienceBus)
    const url = resolveAssetUrl(manifest.assetBase, stem.file)
    const player: TonePlayer = new Tone.Player({
      url,
      loop: true,
      fadeIn: AMBIENCE_FADE_SECONDS,
      fadeOut: AMBIENCE_FADE_SECONDS,
      onload: () => player.start(),
      onerror: () => onMissingStem(id),
    }).connect(gain)
    stemPlayers.set(id, { player, gain, stem })
  }

  const score = createScoreVoice(Tone, masterGain)

  return {
    masterGain,
    stemPlayers,
    onceBus,
    score,
    dispose: () => {
      score.dispose()
      for (const { player, gain } of stemPlayers.values()) {
        player.dispose()
        gain.dispose()
      }
      ambienceBus.dispose()
      onceBus.dispose()
      masterGain.dispose()
    },
  }
}

/** Fires a once-mode stem from the same buffer its loop player already has (ADR-023 §3: "can
 *  reuse the same ten stem sources") — no second network fetch. A no-op if that stem has no
 *  loop player (missing from the manifest, per `onMissingStem`'s own already-logged warning). */
function playOnce(Tone: ToneModule, stemPlayers: Map<AmbienceStemId, StemVoice>, onceBus: ToneGain, stemId: string, gain: number): void {
  if (!(STEM_IDS as readonly string[]).includes(stemId)) return
  const voice = stemPlayers.get(stemId as AmbienceStemId)
  if (voice === undefined || !voice.player.loaded) return
  const oneShotGain = new Tone.Gain(clampVolume(gain)).connect(onceBus)
  const oneShot: TonePlayer = new Tone.Player({
    url: voice.player.buffer,
    loop: false,
    fadeIn: ONCE_FADE_SECONDS,
    fadeOut: ONCE_FADE_SECONDS,
    onstop: () => {
      oneShot.dispose()
      oneShotGain.dispose()
    },
  }).connect(oneShotGain)
  oneShot.start()
}

// -------------------------------------------------------------------------------- the hook

export function useAudioEngine(input: UseAudioEngineInput): AudioEngineControls {
  const { manifest, t, playing, scalarLayers } = input

  const [prefs, setPrefs] = useState(() => ({ enabled: false, masterVolume: DEFAULT_MASTER_VOLUME }))
  useEffect(() => {
    setPrefs(loadAudioPrefs())
  }, [])

  const sceneTarget = manifest !== null && manifest.scenes.length > 0 ? sceneAt(manifest.scenes, t) : { from: EMPTY_SCENE, to: EMPTY_SCENE, mix: 0 }
  const presented = usePresentedSceneMix(sceneTarget)
  const onceFired = useSceneSoundOnceTrigger(presented, playing)

  const flatBasalt = useMemo(() => (manifest === null ? [] : floodBasaltWindows(manifest)), [manifest])
  const catastrophes = useMemo(() => (manifest === null ? [] : catastropheWindows(manifest)), [manifest])
  const co2Layer = scalarLayers.get('co2')
  const dayLengthLayer = scalarLayers.get('day_length')

  const runtimeRef = useRef<ToneRuntime | null>(null)
  const warnedMissingRef = useRef<Set<string>>(new Set())
  const onceDuckRef = useRef<{ gain: number; untilMs: number } | null>(null)

  // "Latest ref" mirrors of every tick-loop input that changes on essentially every render
  // during playback (`t` above all). The tick effect below must NOT depend on these directly —
  // during playback `t` changes on ~every rAF frame (`playback.ts`'s `onFrame` -> `setT`), so a
  // dependency array containing `t` would tear down and recreate the `setInterval` before it
  // ever gets to fire, permanently starving the tick that writes gains/score into the live
  // Tone.js graph. Kept current by the render-synced effect just below, read only inside the
  // interval callback.
  const tRef = useRef(t)
  const presentedRef = useRef(presented)
  const flatBasaltRef = useRef(flatBasalt)
  const catastrophesRef = useRef(catastrophes)
  const co2LayerRef = useRef(co2Layer)
  const dayLengthLayerRef = useRef(dayLengthLayer)
  useEffect(() => {
    tRef.current = t
    presentedRef.current = presented
    flatBasaltRef.current = flatBasalt
    catastrophesRef.current = catastrophes
    co2LayerRef.current = co2Layer
    dayLengthLayerRef.current = dayLengthLayer
  })

  const onMissingStem = (id: string): void => {
    if (warnedMissingRef.current.has(id)) return
    warnedMissingRef.current.add(id)
    // Deliberate, deduped diagnostic (spec: "log a single console.warn naming it"), never a
    // thrown error in the render/tick loop.
    console.warn(`audio: stem "${id}" is not in manifest.audioStems (or failed to load) — playing silent`)
  }

  // Lazy Tone.js lifecycle: constructed only on false -> true, fully disposed on true -> false
  // (ADR-023 §2 / §4: pay nothing, including CPU, while sound is off).
  useEffect(() => {
    if (!prefs.enabled || manifest === null) return
    let cancelled = false
    loadTone()
      .then(async (Tone) => {
        await Tone.start()
        if (cancelled) return
        runtimeRef.current = buildRuntime(Tone, manifest, onMissingStem)
        installAudioDevHook(Tone)
      })
      .catch((error: unknown) => {
        console.warn('audio: failed to start Tone.js', error)
      })
    return () => {
      cancelled = true
      runtimeRef.current?.dispose()
      runtimeRef.current = null
    }
    // Reacts only to `enabled` and to the null -> non-null transition of `manifest` (the
    // "still loading" -> "ready" edge) — not to every later manifest object identity change,
    // since a manifest that changed shape under an already-playing session isn't a case this
    // app has (one load per page); re-running this whole lazy-construct/dispose cycle on every
    // later render would only add churn, not correctness.
  }, [prefs.enabled, manifest !== null])

  // Suspend the AudioContext while the tab is hidden — no sense spending CPU on audio no one
  // can hear, and resume promptly when it becomes visible again.
  useEffect(() => {
    if (!prefs.enabled) return
    function onVisibilityChange(): void {
      if (runtimeRef.current === null) return
      loadTone().then((Tone) => {
        const ctx = Tone.getContext()
        if (document.hidden) {
          // `rawContext` is typed `AudioContext | OfflineAudioContext` (Tone's own
          // `AnyAudioContext`); only a live `AudioContext` — never offline rendering — reaches
          // this browser-only, tab-visibility-driven path, and only `AudioContext.suspend()`
          // takes no argument.
          ;(ctx.rawContext as AudioContext).suspend().catch(() => {})
        } else {
          ctx.resume().catch(() => {})
        }
      })
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [prefs.enabled])

  // Master volume: applied to the master bus continuously (smoothed), not gated on the tick
  // below, so dragging the volume slider feels immediate.
  useEffect(() => {
    runtimeRef.current?.masterGain.gain.rampTo(clampVolume(prefs.masterVolume), 0.1)
  }, [prefs.masterVolume, prefs.enabled])

  // Fire a once-mode effect the render after useSceneSoundOnceTrigger reports one.
  useEffect(() => {
    const sound = onceFired?.sound
    if (sound === undefined || sound.mode !== 'once' || manifest === null) return
    const runtime = runtimeRef.current
    if (runtime === null) return
    loadTone().then((Tone) => {
      playOnce(Tone, runtime.stemPlayers, runtime.onceBus, sound.stem, sound.gain)
    })
    const stem = manifest.audioStems.find((s) => s.id === sound.stem)
    const durationSeconds = Math.min(stem?.durationSeconds ?? ONCE_DUCK_MAX_SECONDS, ONCE_DUCK_MAX_SECONDS)
    onceDuckRef.current = { gain: sound.gain, untilMs: performance.now() + durationSeconds * 1000 }
  }, [onceFired, manifest])

  // The one tick loop: recompute every pure mapping and write the results into the live
  // Tone.js graph. Never creates a node here — only `.rampTo`/`.value` writes.
  //
  // Deliberately depends on `prefs.enabled` alone (mount/unmount once per enabled-toggle), not
  // on any of the fast-changing values the callback reads — those come from the "latest ref"
  // mirrors above instead. See their doc comment: depending on `t` here would clear and
  // recreate this `setInterval` on ~every rAF frame during playback, before the 80ms interval
  // ever got to fire, silently freezing all live audio at whatever was last computed.
  useEffect(() => {
    if (!prefs.enabled) return
    const interval = window.setInterval(() => {
      const runtime = runtimeRef.current
      if (runtime === null) return

      const tickT = tRef.current
      const ambient = stemGains(tickT, flatBasaltRef.current)
      const sceneLoop = sceneSoundLoopGains(presentedRef.current)
      const now = performance.now()
      const onceDuck = onceDuckRef.current !== null && now < onceDuckRef.current.untilMs ? onceDuckRef.current.gain : 0
      let maxSceneSoundGain = onceDuck

      for (const [id, voice] of runtime.stemPlayers) {
        // A scene's own loop-mode sound can foreground a stem above its ambient baseline
        // while the scene is on screen; it never suppresses the ambient curve, so the two
        // combine with Math.max — the same rule sceneSoundLoopGains itself uses to combine
        // two scenes that share a stem.
        const sceneGain = sceneLoop[id] ?? 0
        maxSceneSoundGain = Math.max(maxSceneSoundGain, sceneGain)
        const target = Math.max(ambient[id], sceneGain)
        voice.gain.gain.rampTo(target, GAIN_SMOOTH_SECONDS)
      }

      const params = scoreParams(
        tickT,
        { co2Ppm: scalarAt(co2LayerRef.current, tickT), dayLengthHours: scalarAt(dayLengthLayerRef.current, tickT) },
        catastrophesRef.current,
      )
      runtime.score.update(params, 1 - SCORE_DUCK_AMOUNT * maxSceneSoundGain)
    }, TICK_MS)
    return () => window.clearInterval(interval)
  }, [prefs.enabled])

  return {
    enabled: prefs.enabled,
    masterVolume: prefs.masterVolume,
    setEnabled: (enabled) => {
      setPrefs((p) => ({ ...p, enabled }))
      saveAudioEnabled(enabled)
    },
    setMasterVolume: (masterVolume) => {
      const clamped = clampVolume(masterVolume)
      setPrefs((p) => ({ ...p, masterVolume: clamped }))
      saveAudioMasterVolume(clamped)
    },
  }
}
