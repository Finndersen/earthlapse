/**
 * The one stateful, Tone.js-owning hook (ADR-023, `audio-engine-spec.md`). Lazy-loads `tone`
 * only after the viewer's first "sound on" click, owns every player/synth, and writes
 * `stemGains`/`sceneSoundLoopGains`/`scoreParams` into their live gain/parameter values on a
 * throttled tick — never recreating a node needlessly, never blocking the render loop, never
 * touching `localStorage` outside a click handler's own effect.
 *
 * **Stem buffers load on demand** (ADR-023 amendment "on-demand loading", 2026-09-15), not all
 * upfront at construction: `buildRuntime` below creates only the buses and the score voice.
 * Every tick, `loadPlan.ts`'s `stemsNeeded` says which stems the next few seconds of playback
 * (or a small margin around a paused/scrubbed `t`) actually call for, `bufferCache.ts`'s
 * `StemBufferCache` turns that into a bounded set of fetches and evictions (nearest-needed-first,
 * capped concurrency, an idle timeout and a decoded-seconds LRU cap), and only once a stem's
 * buffer is ready does a loop-kind stem get an actual `Tone.Player` — starting at gain 0 with
 * its usual fade-in, so a late arrival is inaudible rather than a pop-in.
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

import {
  dominantScene,
  resolveAssetUrl,
  sceneAt,
  scenePlaybackSegments,
  usePresentedSceneMix,
  type PresentationRegime,
  type SceneMix,
} from '@/scene'
import type { PlaybackPacingSegment } from '@/timeline'
import type { GeoTime, Layer, Playback, ScalarValue } from '@/types/layer'
import type { AudioStem, Manifest } from '@/types/manifest'

import { StemBufferCache } from './bufferCache'
import { stemsNeeded } from './loadPlan'
import { DEFAULT_MASTER_VOLUME, loadAudioPrefs, saveAudioEnabled, saveAudioMasterVolume } from './persistence'
import type { TimeWindow } from './ramp'
import { scoreParams, type ScoreParams } from './score'
import { onceSoundOutlived, onceVoiceHasBeenPresented, sceneSoundLoopGains, useSceneSoundOnceTrigger } from './sceneSound'
import { stemGains } from './stemGains'
import { isStemId, type StemId } from './stemIds'
import { planStemVoices, stemLevelGain, type StemVoicePlan } from './stemVoices'

/** How often live gain/parameter values are recomputed and written, and how often the loader
 *  re-plans what to fetch/evict (ADR-023's engine contract: "full 60fps is unnecessary for a
 *  gain ramp; ~10-20 Hz is plenty and cheaper"). */
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
/** A once voice still sounding when its scene is no longer on screen fades out over this long. */
const ONCE_LEAVE_FADE_SECONDS = 1.5
/** Below this, a loop voice's gain is inaudible under any reasonable system/master volume —
 *  the threshold `loadPlan.ts`'s `stemsNeeded` also uses, so "needed" and "audible" agree. */
const SILENCE_GAIN_THRESHOLD = 0.01
/** A loop player whose target has sat at ~0 for this long stops the underlying `Tone.Player`
 *  (ADR-023 amendment "on-demand loading": "instead of running them silently") rather than
 *  looping a decoded buffer no one can hear — cheap CPU/battery on mobile in particular.
 *  Restarting it (`.start()` again, with the same fade-in) is instant: the buffer stays
 *  decoded until `StemBufferCache`'s own, separate idle-timeout/LRU rules evict it. Shorter
 *  than that eviction timeout, so a stem that lingers unneeded long enough is silenced well
 *  before its buffer is actually freed. */
const SILENT_PLAYER_STOP_MS = 20_000
/** `StemBufferCache` tuning (ADR-023 amendment "on-demand loading"). At most this many stem
 *  fetches run at once, so a big scrub or a cold start never saturates the connection with
 *  simultaneous requests. */
const MAX_CONCURRENT_LOADS = 3
/** A ready buffer not in the `stemsNeeded` set for longer than this is evicted. */
const BUFFER_IDLE_EVICT_MS = 60_000
/** While not playing, a fetch does not start until `t` has sat still for this long — a
 *  continuous drag is many small jumps in a row, each opening its own tiny idle lookahead
 *  window (`loadPlan.ts`'s `IDLE_U_DELTA`); without this, every position crossed along the way
 *  starts its own fetches (re-review fix: a 3s drag across the whole domain started ten
 *  separate stem fetches). Existing loop voices keep updating their gain targets every tick
 *  regardless — this only gates *new* fetches/evictions, never audible output. Well under a
 *  perceptible delay for a genuine pause (250-400ms is the deliberate-stop threshold most drag
 *  interactions already read as "let go", not "still moving"). */
const IDLE_FETCH_SETTLE_MS = 300
/** Assumed decoded size of a not-yet-fetched stem (`durationSeconds x this`), reserved against
 *  `DECODED_BYTES_CAP` for as long as its fetch is in flight (`StemBufferCache.markFetching`'s
 *  `estimatedBytes`) — stereo, 48 kHz, 32-bit float PCM, the catalogue's typical case
 *  (`sources/audio-stems/stems.toml`'s `afinfo` survey, cited in the ADR-023 amendment
 *  "on-demand loading" re-review). Replaced by the real decoded figure once the fetch lands;
 *  over-estimating a mono or 44.1 kHz stem's actual size is the safe direction for a reservation. */
const ASSUMED_BYTES_PER_SECOND = 2 /* channels */ * 48_000 /* Hz */ * 4 /* Float32 bytes/sample */
/** Total decoded *bytes* (not seconds — a stereo 48 kHz stem takes ~4x the memory of a mono
 *  24 kHz one of the same duration, so a duration-only figure was never a real memory bound;
 *  re-review fix) kept across every ready buffer, evicting least-recently-needed first past
 *  this — bounds memory on mobile regardless of how many distinct stems a long session has
 *  passed through. `StemBufferCache.plan()` never evicts a stem still in `needed` even over
 *  this cap (a currently-audible stem going silent to satisfy a memory budget would defeat the
 *  feature), so the cap can only ever trim history, not something currently audible — its real
 *  floor is whatever the densest era's own curves make simultaneously audible at once, in
 *  bytes. Measured live sweeping the whole timeline (Playwright, headless Chromium, log-spaced
 *  checkpoints 4.5 Ga -> present, `docs/DECISIONS.md` ADR-023 amendment "on-demand loading"
 *  re-review): peak ~148.5 MB decoded (13 buffers), post mono-downmix. 190 MB gives that a
 *  little over 25% headroom — comfortably still a mobile-sized budget (well under the ~250-280
 *  MB the same content would take stereo throughout) — without sitting right at the measured
 *  edge. */
export const DECODED_BYTES_CAP = 190 * 1024 * 1024

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
  /** `useTimeStore(s => s.playback)`, whole — the loader (`loadPlan.ts`'s `stemsNeeded`) reads
   *  `baseRate`/`speed` too, to size its lookahead window while playing. */
  playback: Playback
  /** The selected era section's window (ADR-024, `sectionById(sectionId).window`) — the hard
   *  bound on how far the loader's lookahead ever reaches; see `loadPlan.ts`'s doc comment. */
  sectionWindow: readonly [GeoTime, GeoTime]
  scalarLayers: ReadonlyMap<string, Layer<ScalarValue>>
  /** `'crossfade'` (default) or `'cut'` — `Experience.tsx`'s own `steadyPacing` result for the
   *  current frame (ADR-029), the same value driving `SceneView`'s presented mix and the "time
   *  compressed" marker. While `'cut'`: scene loop sounds mute (faded via the existing
   *  `GAIN_SMOOTH_SECONDS` ramp, not clicked — see `sceneLoop`'s own comment in the tick loop
   *  below) and once-mode scene sounds do not trigger, so a densely-scened stretch crossed in
   *  hard cuts never piles up several overlapping one-shots under images on screen for a
   *  fraction of a second each. The base ambience stems (`stemGains(t)`) are untouched either
   *  way — stretched over a slowed, floored playhead they read as a natural, unbroken build
   *  (ADR-023 amendment note). Optional so every existing caller (tests included) keeps today's
   *  behaviour unchanged. */
  presentationRegime?: PresentationRegime
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
  title: '',
  caption: '',
  width: 1,
  height: 1,
}
/** The `SceneMix` `EMPTY_SCENE` alone forms — shared by the component-level `sceneTarget` and
 *  the tick loop's own `currentTarget` recompute, both for while `manifest` is `null`/empty. */
const EMPTY_SCENE_MIX: SceneMix = { from: EMPTY_SCENE, to: EMPTY_SCENE, mix: 0 }
/** `sceneSoundLoopGains`' own empty-result shape, reused (never recomputed) while ADR-029's
 *  `'cut'` regime mutes every scene loop — see the tick loop's own comment at its call site. */
const EMPTY_SCENE_LOOP_GAINS: Partial<Record<string, number>> = {}

// -------------------------------------------------------------------------- Tone.js runtime
//
// Every Tone type below is named only via `typeof import('tone')` / `InstanceType<...>` — an
// `import type` erases entirely at build time, so this file still never pulls the real `tone`
// module in until `loadTone()` actually runs, inside the `enabled` effect below.

type ToneModule = typeof import('tone')
type ToneGain = InstanceType<ToneModule['Gain']>
type TonePlayer = InstanceType<ToneModule['Player']>
type ToneAudioBuffer = InstanceType<ToneModule['ToneAudioBuffer']>

type LoopPlan = Extract<StemVoicePlan, { kind: 'ambience-loop' | 'scene-loop' }>
/** A stem plan that is actually loadable — every `StemVoicePlan` kind except the two
 *  `buildRuntime` already warned about once and skips entirely (`missing`, `not-loop-safe`). */
type PlayableStemPlan = Exclude<StemVoicePlan, { kind: 'missing' } | { kind: 'not-loop-safe' }>

/** A lazily-created looping player: only exists while its stem is in the current `stemsNeeded`
 *  set (or was until recently — `StemBufferCache`'s idle timeout, not this). */
interface LoopVoice {
  player: TonePlayer
  gain: ToneGain
  plan: LoopPlan
  /** `stemLevelGain(plan.stem)`, fixed for the voice's life. */
  levelGain: number
  /** The curve/scene gain the tick last wrote, before `levelGain` (read by the dev hook). */
  target: number
  /** Whether the underlying `Tone.Player` is currently started — false while stopped for
   *  prolonged silence (`SILENT_PLAYER_STOP_MS`); the gain node and buffer stay alive either
   *  way, only the player transport stops. */
  running: boolean
  /** `performance.now()` when `target` first dropped to (near) 0, or `null` while audible —
   *  drives the `SILENT_PLAYER_STOP_MS` rule. */
  zeroSinceMs: number | null
}

/** A fired `once`-mode playback, tied to the scene that fired it so it can fade when that
 *  scene leaves the screen. */
interface OnceVoice {
  sceneId: string
  stemId: StemId
  player: TonePlayer
  gain: ToneGain
  leaving: boolean
  /** Whether `currentPresented` has, at some point since this voice fired, actually shown
   *  `sceneId` as dominant — `sceneSound.ts`'s `onceSoundOutlived`/`onceVoiceHasBeenPresented`,
   *  latched here since it must survive across ticks. Starts `false`: the picture has not caught
   *  up yet at the moment a voice is created. */
  hasBeenPresented: boolean
}

interface ScoreVoice {
  update: (params: ScoreParams, duckMultiplier: number) => void
  dispose: () => void
}

interface ToneRuntime {
  Tone: ToneModule
  assetBase: string
  masterGain: ToneGain
  ambienceBus: ToneGain
  onceBus: ToneGain
  score: ScoreVoice
  /** Every catalogued stem's playback plan (ADR-023 §1 vs §3: ambience curve, scene-only loop,
   *  scene-only one-shot, or unusable), computed once from the manifest — static for the
   *  runtime's life, unlike everything buffer-related below it. */
  stemPlans: ReadonlyMap<StemId, StemVoicePlan>
  bufferCache: StemBufferCache<ToneAudioBuffer>
  loopVoices: Map<StemId, LoopVoice>
  onceVoices: Set<OnceVoice>
  /** In-flight fetch/decode aborts, one per currently-loading stem — `runLoaderStep` aborts any
   *  whose stem has left `needed` (re-review fix: an in-flight fetch used to keep running to
   *  completion even after nothing wanted it any more), and `dispose()` aborts every remaining
   *  one so a response arriving after teardown never runs at all, not merely gets ignored. */
  inFlight: Map<StemId, AbortController>
  /** The most recent `stemsNeeded` result, written at the start of every `runLoaderStep` call —
   *  read asynchronously by a fetch's `.then()` to decide whether to still build a loop voice
   *  for a buffer that only just landed (re-review fix: a stem that fell out of `needed` while
   *  its fetch was in flight used to always get a player built anyway). */
  currentNeeded: ReadonlySet<StemId>
  /** The most recently presented `SceneMix` (`usePresentedSceneMix`'s output), written every
   *  tick — read asynchronously by a fetch's `.then()` to decide whether a pending `once` sound
   *  is still worth playing once its buffer lands (`pendingOnce` below), and by the tick loop
   *  itself to decide whether an already-sounding once voice has outlived its scene. */
  currentPresented: SceneMix
  /** The most recently computed raw *target* `SceneMix` (`sceneAt(manifest.scenes, t)`, pure and
   *  instantaneous — the same value `useAudioEngine` feeds `useSceneSoundOnceTrigger`), written
   *  every tick alongside `currentPresented`. `onceSoundOutlived` reads this instead of
   *  `currentPresented` until a voice's scene has actually been presented-dominant at least once
   *  — see its own doc comment for why both are needed. */
  currentTarget: SceneMix
  /** A scene's `once` sound that fired before its buffer was ready, keyed by stem id (at most
   *  one pending trigger per stem at a time — a second `once` firing for the same stem while the
   *  first is still loading simply replaces it, the same "only the latest matters" semantics a
   *  gain ramp already has). Resolved (played, or deliberately dropped) the moment the fetch
   *  lands, in `startLoadingStem`'s success handler (re-review fix: the previous fallback started
   *  a load and then never played anything when it arrived). `hasBeenPresented` is the same latch
   *  `OnceVoice` carries, updated every tick by `updatePendingOncePresence` while the trigger is
   *  still pending. */
  pendingOnce: Map<StemId, { sceneId: string; gain: number; firedAtMs: number; hasBeenPresented: boolean }>
  onUnusableStem: (id: string, reason: string) => void
  /** Set at the start of `dispose()` and checked by every in-flight fetch's callback, so a
   *  network response arriving after teardown never mutates (or creates Tone nodes on) a
   *  runtime that no longer exists. */
  disposed: boolean
  dispose: () => void
}

async function loadTone(): Promise<ToneModule> {
  return import('tone')
}

/** Development-only automation hook, mirroring `store/devHook.ts`'s own `window.__earthtime`
 *  (same `NODE_ENV === 'development'` gate, dead-code-eliminated from a production build) —
 *  kept local to this package rather than added to that file, since this package's scope
 *  boundary keeps it out of `web/src/store/**`. A headless run can't listen, so it exposes
 *  read-only snapshots instead: whether the `AudioContext` runs, the gain the last tick wrote
 *  for each looping stem (before its level trim), which `once` sounds are still playing, and
 *  the loader's own state (for a network-panel check to correlate against: what's loaded,
 *  loading or evicted, and the running decoded-seconds total). */
export interface AudioDevHook {
  getContextState: () => AudioContextState
  getStemTargets: () => Partial<Record<StemId, number>>
  getActiveOnceVoices: () => { sceneId: string; stemId: StemId; leaving: boolean }[]
  getLoaderState: () => {
    ready: StemId[]
    loading: StemId[]
    error: StemId[]
    decodedBytesTotal: number
  }
}

declare global {
  interface Window {
    __earthtimeAudio?: AudioDevHook
  }
}

function installAudioDevHook(Tone: ToneModule, runtime: ToneRuntime): void {
  if (process.env.NODE_ENV !== 'development') return
  window.__earthtimeAudio = {
    getContextState: () => Tone.getContext().state,
    getStemTargets: () => Object.fromEntries([...runtime.loopVoices.values()].map((voice) => [voice.plan.id, voice.target])),
    getActiveOnceVoices: () =>
      [...runtime.onceVoices].map(({ sceneId, stemId, leaving }) => ({ sceneId, stemId, leaving })),
    getLoaderState: () => {
      const ready: StemId[] = []
      const loading: StemId[] = []
      const error: StemId[] = []
      for (const id of runtime.bufferCache.trackedIds()) {
        const status = runtime.bufferCache.status(id)
        if (status === 'ready') ready.push(id)
        else if (status === 'loading') loading.push(id)
        else if (status === 'error') error.push(id)
      }
      return { ready, loading, error, decodedBytesTotal: runtime.bufferCache.decodedBytesTotal }
    },
  }
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

/** A stem fetch/decode failure, tagged with what actually failed — `startLoadingStem`'s
 *  `.catch()` reacts differently to each (re-review fix): `'aborted'` (its stem left `needed`
 *  mid-flight, `runLoaderStep`) drops the attempt entirely, not an error; `'network'` is
 *  retried with backoff (`StemBufferCache.markFailed`); `'decode'` (the browser cannot play
 *  this container/codec at all — a format gap, not a network blip) is never retried this
 *  session (`StemBufferCache.markPermanentlyFailed`). */
class StemLoadError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'decode' | 'aborted',
  ) {
    super(message)
    this.name = 'StemLoadError'
  }
}

/** Fetches `url` and decodes it into a plain `AudioBuffer` — the loader's one piece of real
 *  I/O. Fetch and decode are two separate `try`s so a failure at either stage is tagged with
 *  which one it was (`StemLoadError.kind`); `Tone.ToneAudioBuffer`'s own `url` constructor form
 *  did both in one un-abortable, un-distinguishable step (re-review fix: no way to cancel a
 *  fetch for a stem that stopped being needed, and every failure looked like a plain network
 *  error even when it was really "this browser cannot decode this format"). Mirrors
 *  `Tone.ToneAudioBuffer.load`'s own fetch + `getContext().decodeAudioData` (`node_modules/
 *  tone/Tone/core/context/ToneAudioBuffer.ts`), so decoding still goes through the same
 *  `AudioContext` every other Tone node shares. */
async function fetchAndDecodeStem(Tone: ToneModule, url: string, signal: AbortSignal): Promise<AudioBuffer> {
  let bytes: ArrayBuffer
  try {
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(`HTTP ${response.status} loading ${url}`)
    bytes = await response.arrayBuffer()
  } catch (error) {
    if (signal.aborted) throw new StemLoadError(`aborted loading ${url}`, 'aborted')
    throw new StemLoadError(error instanceof Error ? error.message : String(error), 'network')
  }
  try {
    return await Tone.getContext().decodeAudioData(bytes)
  } catch (error) {
    throw new StemLoadError(error instanceof Error ? error.message : String(error), 'decode')
  }
}

/** Assumed-stereo-48kHz estimate of a stem's decoded size, for `StemBufferCache.markFetching`'s
 *  `estimatedBytes` reservation — see `ASSUMED_BYTES_PER_SECOND`'s own doc comment. */
function estimatedStemBytes(stem: AudioStem): number {
  return stem.durationSeconds * ASSUMED_BYTES_PER_SECOND
}

/** A decoded buffer's real size in bytes — 32-bit float PCM, one 4-byte sample per channel per
 *  frame, the same figure `DECODED_BYTES_CAP` and `markFetching`'s estimate are denominated in. */
function decodedBufferBytes(buffer: ToneAudioBuffer): number {
  return buffer.length * buffer.numberOfChannels * 4
}

/** Builds the actual looping `Tone.Player`, once (and only once) `buffer` is decoded — starts
 *  immediately at the gain node's initial 0, with the player's own `fadeIn`, so its arrival is
 *  never audible as a pop-in (ADR-023 amendment "on-demand loading": "starting each loop at
 *  gain 0 with its existing fade-in so late arrival is inaudible"). */
function createLoopVoice(Tone: ToneModule, runtime: ToneRuntime, plan: LoopPlan, buffer: ToneAudioBuffer): void {
  const gain = new Tone.Gain(0).connect(runtime.ambienceBus)
  const region = plan.stem.loop
  const loopStart = region?.startSeconds ?? 0
  const player: TonePlayer = new Tone.Player({
    url: buffer,
    loop: true,
    // A published region skips a silent head/tail, a fade or a splice; absent, the whole clip
    // loops (Tone's defaults: 0 and the buffer end).
    ...(region === undefined ? {} : { loopStart: region.startSeconds, loopEnd: region.endSeconds }),
    fadeIn: AMBIENCE_FADE_SECONDS,
    fadeOut: AMBIENCE_FADE_SECONDS,
  }).connect(gain)
  player.start(undefined, loopStart)
  runtime.loopVoices.set(plan.id, {
    player,
    gain,
    plan,
    levelGain: stemLevelGain(plan.stem),
    target: 0,
    running: true,
    zeroSinceMs: null,
  })
}

function disposeLoopVoice(runtime: ToneRuntime, id: StemId): void {
  const voice = runtime.loopVoices.get(id)
  if (voice === undefined) return
  voice.player.dispose()
  voice.gain.dispose()
  runtime.loopVoices.delete(id)
}

/** Starts (or restarts, on `error` retry past its backoff) loading `id`'s buffer if `stemPlans`
 *  says it is loadable — a no-op for `missing`/`not-loop-safe` ids, which `buildRuntime` already
 *  warned about once, before any of this loading machinery ever runs.
 *
 * On success: a loop-kind stem gets its `Tone.Player` built (`createLoopVoice`), but only if it
 * is still in `runtime.currentNeeded` — the fetch can easily outlive the lookahead window that
 * asked for it (re-review fix: a buffer used to always get a player regardless, even for a stem
 * the loader had long since moved past). A pending `once` trigger for this id (`playOnce`'s
 * fallback) is resolved either way: played if its scene is still presented, dropped (with one
 * warning) if not.
 *
 * On failure: an aborted fetch (`runtime.inFlight`, `runLoaderStep`) is treated as never having
 * happened — `forget`, not `markFailed`, so it is offered again the instant it re-enters
 * `needed`, with no backoff penalty for something that was never really tried. A decode failure
 * is permanent for the session (`markPermanentlyFailed`); anything else backs off exponentially
 * (`markFailed`).
 *
 * Guards on `runtime.disposed` throughout so a response arriving after teardown touches
 * nothing — Tone nodes included, since `dispose()` has already torn those down. */
function startLoadingStem(Tone: ToneModule, runtime: ToneRuntime, id: StemId): void {
  const plan = runtime.stemPlans.get(id)
  if (plan === undefined || plan.kind === 'missing' || plan.kind === 'not-loop-safe') return
  const url = resolveAssetUrl(runtime.assetBase, plan.stem.file)
  const controller = new AbortController()
  runtime.inFlight.set(id, controller)
  runtime.bufferCache.markFetching(id, performance.now(), estimatedStemBytes(plan.stem))
  fetchAndDecodeStem(Tone, url, controller.signal)
    .then((audioBuffer) => {
      runtime.inFlight.delete(id)
      if (runtime.disposed) return
      const buffer: ToneAudioBuffer = new Tone.ToneAudioBuffer(audioBuffer)
      // Diffuse ambience beds don't need stereo width the way a directional one-shot might —
      // downmixing to mono roughly halves decoded memory for the catalogue's ambience-loop
      // stems, done client-side so it needs no pipeline dependency
      // (`sources/audio-stems/normalise.py`'s own "no transcoding happens here" stays true;
      // re-review fix: "mono downmix of diffuse beds").
      if (plan.kind === 'ambience-loop') buffer.toMono()
      runtime.bufferCache.markReady(id, buffer, decodedBufferBytes(buffer), performance.now())

      const pending = runtime.pendingOnce.get(id)
      if (pending !== undefined) {
        runtime.pendingOnce.delete(id)
        if (onceSoundOutlived(runtime.currentTarget, runtime.currentPresented, pending.sceneId, pending.hasBeenPresented)) {
          runtime.onUnusableStem(id, 'missed its once-mode cue (buffer arrived after its scene left the screen)')
        } else {
          startOnceVoice(Tone, runtime, pending.sceneId, id, pending.gain, plan, buffer, pending.hasBeenPresented)
        }
      }

      if ((plan.kind === 'ambience-loop' || plan.kind === 'scene-loop') && runtime.currentNeeded.has(id)) {
        createLoopVoice(Tone, runtime, plan, buffer)
      }
    })
    .catch((error: unknown) => {
      runtime.inFlight.delete(id)
      if (runtime.disposed) return
      if (error instanceof StemLoadError && error.kind === 'aborted') {
        runtime.bufferCache.forget(id)
        return
      }
      if (error instanceof StemLoadError && error.kind === 'decode') {
        runtime.bufferCache.markPermanentlyFailed(id, performance.now())
        runtime.onUnusableStem(id, 'cannot be decoded by this browser (unsupported audio format)')
        return
      }
      runtime.bufferCache.markFailed(id, performance.now())
      runtime.onUnusableStem(id, 'failed to load')
    })
}

function buildRuntime(Tone: ToneModule, manifest: Manifest, onUnusableStem: (id: string, reason: string) => void): ToneRuntime {
  const masterGain = new Tone.Gain(1).toDestination()
  const ambienceBus = new Tone.Gain(1).connect(masterGain)
  const onceBus = new Tone.Gain(1).connect(masterGain)
  const score = createScoreVoice(Tone, masterGain)

  const stemPlans = new Map<StemId, StemVoicePlan>()
  for (const plan of planStemVoices(manifest.audioStems)) {
    stemPlans.set(plan.id, plan)
    if (plan.kind === 'missing') onUnusableStem(plan.id, 'is not in manifest.audioStems')
    else if (plan.kind === 'not-loop-safe') onUnusableStem(plan.id, 'is an ambience stem published as not loop-safe')
  }

  const runtime: ToneRuntime = {
    Tone,
    assetBase: manifest.assetBase,
    masterGain,
    ambienceBus,
    onceBus,
    score,
    stemPlans,
    bufferCache: new StemBufferCache(MAX_CONCURRENT_LOADS, BUFFER_IDLE_EVICT_MS, DECODED_BYTES_CAP),
    loopVoices: new Map(),
    onceVoices: new Set(),
    inFlight: new Map(),
    currentNeeded: new Set(),
    currentPresented: EMPTY_SCENE_MIX,
    currentTarget: EMPTY_SCENE_MIX,
    pendingOnce: new Map(),
    onUnusableStem,
    disposed: false,
    dispose: () => {
      runtime.disposed = true
      // Abort every fetch still in flight first — its `.catch()` still runs (asynchronously),
      // but `disposed` is already true by the time it does, so it touches nothing further
      // (re-review fix: turning sound off used to leave in-flight fetches running to
      // completion, decoding into buffers nothing then disposed).
      for (const controller of runtime.inFlight.values()) controller.abort()
      runtime.inFlight.clear()
      runtime.pendingOnce.clear()
      score.dispose()
      for (const id of [...runtime.loopVoices.keys()]) disposeLoopVoice(runtime, id)
      for (const voice of runtime.onceVoices) {
        voice.player.dispose()
        voice.gain.dispose()
      }
      runtime.onceVoices.clear()
      for (const id of runtime.bufferCache.trackedIds()) runtime.bufferCache.handle(id)?.dispose()
      ambienceBus.dispose()
      onceBus.dispose()
      masterGain.dispose()
    },
  }
  return runtime
}

/** Builds and starts the actual one-shot `Tone.Player` for a scene's `once` sound — the part of
 *  `playOnce` that needs a ready buffer, factored out so `startLoadingStem`'s success handler
 *  can call it directly for a trigger that arrived before its buffer did (`pendingOnce`).
 *  `hasBeenPresented` seeds the new voice's own latch (`OnceVoice.hasBeenPresented`) — `false`
 *  for a freshly-fired trigger (`playOnce`), or whatever `pendingOnce` had already observed for
 *  one resolved from a buffer that landed late. */
function startOnceVoice(
  Tone: ToneModule,
  runtime: ToneRuntime,
  sceneId: string,
  stemId: StemId,
  gain: number,
  plan: PlayableStemPlan,
  buffer: ToneAudioBuffer,
  hasBeenPresented: boolean,
): void {
  const levelGain = stemLevelGain(plan.stem)
  // A loop-safe stem's `startSeconds` is always undefined (pipeline.audio validates it as
  // one-shot-only) — its `once` playback starts at 0, like the loop player itself absent a
  // `loop` region.
  const startSeconds = plan.kind === 'one-shot' ? plan.stem.startSeconds : undefined
  const oneShotGain = new Tone.Gain(clampVolume(gain) * levelGain).connect(runtime.onceBus)
  const voice: OnceVoice = {
    sceneId,
    stemId,
    gain: oneShotGain,
    leaving: false,
    hasBeenPresented,
    player: new Tone.Player({
      url: buffer,
      loop: false,
      fadeIn: ONCE_FADE_SECONDS,
      fadeOut: ONCE_FADE_SECONDS,
      onstop: () => {
        runtime.onceVoices.delete(voice)
        voice.player.dispose()
        oneShotGain.dispose()
      },
    }).connect(oneShotGain),
  }
  runtime.onceVoices.add(voice)
  // A published `startSeconds` skips a silent (or otherwise unwanted) lead-in so playback
  // starts right on the scene's `once` trigger (`AudioStem.startSeconds`).
  voice.player.start(undefined, startSeconds ?? 0)
}

/** Fires a scene's once-mode stem from whatever buffer the loader already has for it — no
 *  second network fetch if it is already `ready`. A no-op for an uncatalogued or unusable id.
 *
 * If the buffer is not ready yet (the loader should normally have prefetched it well ahead,
 * `loadPlan.ts`'s `ONCE_LOOKAHEAD_SECONDS` — this is the fallback for a slow connection or an
 * unlucky scrub straight onto the scene, not the normal path): records a `pendingOnce` entry
 * and kicks off (or leaves running) a load, rather than either silently dropping it forever or
 * playing it unconditionally whenever it happens to land — `startLoadingStem`'s success handler
 * is what actually resolves the pending entry, against whatever is presented *then*, not
 * against `gain`/`sceneId` captured stale from this call (re-review fix: the previous fallback
 * started a load and then never played anything when it arrived). */
function playOnce(Tone: ToneModule, runtime: ToneRuntime, sceneId: string, stemId: string, gain: number, nowMs: number): void {
  if (!isStemId(stemId)) return
  const plan = runtime.stemPlans.get(stemId)
  if (plan === undefined || plan.kind === 'missing' || plan.kind === 'not-loop-safe') return
  const buffer = runtime.bufferCache.handle(stemId)
  if (buffer === undefined) {
    runtime.pendingOnce.set(stemId, { sceneId, gain, firedAtMs: nowMs, hasBeenPresented: false })
    if (runtime.bufferCache.status(stemId) !== 'loading') startLoadingStem(Tone, runtime, stemId)
    return
  }
  startOnceVoice(Tone, runtime, sceneId, stemId, gain, plan, buffer, false)
}

/** Fades out every once voice whose scene is no longer the dominant on-screen scene
 *  (`onceSoundOutlived` — see its own doc comment for `target` vs `presented`), updating each
 *  voice's `hasBeenPresented` latch first. */
function fadeOutlivedOnceVoices(runtime: ToneRuntime, target: SceneMix, presented: SceneMix): void {
  for (const voice of runtime.onceVoices) {
    if (voice.leaving) continue
    voice.hasBeenPresented = onceVoiceHasBeenPresented(presented, voice.sceneId, voice.hasBeenPresented)
    if (!onceSoundOutlived(target, presented, voice.sceneId, voice.hasBeenPresented)) continue
    voice.leaving = true
    voice.gain.gain.rampTo(0, ONCE_LEAVE_FADE_SECONDS)
    voice.player.stop(`+${ONCE_LEAVE_FADE_SECONDS}`)
  }
}

/** Keeps every still-pending `once` trigger's `hasBeenPresented` latch current, the same way
 *  `fadeOutlivedOnceVoices` does for an already-started `OnceVoice` — a pending trigger can
 *  outlive several ticks while its buffer is still loading, and `startLoadingStem`'s success
 *  handler needs an up-to-date latch at whatever moment the buffer actually lands, not just the
 *  one `playOnce` captured when the trigger first fired. */
function updatePendingOncePresence(runtime: ToneRuntime, presented: SceneMix): void {
  for (const [id, pending] of runtime.pendingOnce) {
    if (pending.hasBeenPresented) continue
    if (dominantScene(presented).id === pending.sceneId) {
      runtime.pendingOnce.set(id, { ...pending, hasBeenPresented: true })
    }
  }
}

/**
 * The loader's one step per tick: plans fetches/evictions against `needed` and carries them
 * out. Never touches a buffer still backing an active `once` voice, even if `bufferCache` would
 * otherwise evict it this tick — it is picked up again the next tick once that voice ends
 * (`bufferCache`'s own bookkeeping is untouched meanwhile, so nothing is double-counted).
 *
 * Also aborts any fetch still in flight for a stem that has left `needed` since it started
 * (re-review fix: a fetch used to always run to completion even after nothing wanted it any
 * more) — its `.catch()` in `startLoadingStem` treats that as "never really tried", not a
 * failure, so the stem is offered again with no backoff penalty the moment it re-enters
 * `needed`.
 */
function runLoaderStep(Tone: ToneModule, runtime: ToneRuntime, needed: ReadonlySet<StemId>, nowMs: number): void {
  runtime.currentNeeded = needed
  for (const [id, controller] of runtime.inFlight) {
    if (!needed.has(id)) controller.abort()
  }

  const { toFetch, toEvict } = runtime.bufferCache.plan(needed, nowMs)

  for (const id of toFetch) startLoadingStem(Tone, runtime, id)

  if (toEvict.length === 0) return
  const activeOnceStemIds = new Set([...runtime.onceVoices].map((voice) => voice.stemId))
  for (const id of toEvict) {
    if (activeOnceStemIds.has(id)) continue
    disposeLoopVoice(runtime, id)
    runtime.bufferCache.handle(id)?.dispose()
    runtime.bufferCache.forget(id)
  }
}

/** Writes this tick's target gain into every currently-built loop voice, and stops (or
 *  restarts) its `Tone.Player` per `SILENT_PLAYER_STOP_MS` — see `LoopVoice`'s doc comment. A
 *  scene's own loop-mode sound can foreground an ambience stem above its curve while the scene
 *  is on screen; it never suppresses the curve, so the two combine with `Math.max` — the same
 *  rule `sceneSoundLoopGains` uses for two scenes sharing a stem. A scene-only loop has no
 *  curve and sounds only while its scene is presented. Returns the max scene-sound gain seen,
 *  for the score's own ducking. */
function updateLoopVoices(runtime: ToneRuntime, ambient: Record<string, number>, sceneLoop: Partial<Record<string, number>>, nowMs: number): number {
  let maxSceneSoundGain = 0
  for (const voice of runtime.loopVoices.values()) {
    const { plan } = voice
    const sceneGain = sceneLoop[plan.id] ?? 0
    maxSceneSoundGain = Math.max(maxSceneSoundGain, sceneGain)
    voice.target = plan.kind === 'ambience-loop' ? Math.max(ambient[plan.id] ?? 0, sceneGain) : sceneGain
    const effectiveGain = voice.target * voice.levelGain

    if (effectiveGain > SILENCE_GAIN_THRESHOLD) {
      voice.zeroSinceMs = null
      if (!voice.running) {
        voice.player.start(undefined, voice.plan.stem.loop?.startSeconds ?? 0)
        voice.running = true
      }
      voice.gain.gain.rampTo(effectiveGain, GAIN_SMOOTH_SECONDS)
    } else {
      voice.gain.gain.rampTo(0, GAIN_SMOOTH_SECONDS)
      if (voice.zeroSinceMs === null) {
        voice.zeroSinceMs = nowMs
      } else if (voice.running && nowMs - voice.zeroSinceMs > SILENT_PLAYER_STOP_MS) {
        voice.player.stop()
        voice.running = false
      }
    }
  }
  return maxSceneSoundGain
}

// -------------------------------------------------------------------------------- the hook

export function useAudioEngine(input: UseAudioEngineInput): AudioEngineControls {
  const { manifest, t, playing, playback, sectionWindow, scalarLayers, presentationRegime = 'crossfade' } = input

  const [prefs, setPrefs] = useState(() => ({ enabled: false, masterVolume: DEFAULT_MASTER_VOLUME }))
  useEffect(() => {
    setPrefs(loadAudioPrefs())
  }, [])

  const sceneTarget = manifest !== null && manifest.scenes.length > 0 ? sceneAt(manifest.scenes, t) : EMPTY_SCENE_MIX
  const presented = usePresentedSceneMix(sceneTarget)
  // The once-mode arrival trigger reads the raw, un-rate-limited `sceneTarget` -- a pure
  // function of `t` alone -- never `presented` (ADR-023 amendment 2026-09-15, "once-mode
  // arrival is target-driven, not presentation-driven"). `presented` is `sceneTarget` rate-
  // limited by `scene/presentation.ts`'s `step` to a floor of `MIN_TRANSITION_SECONDS` of real
  // wall-clock time per dissolve -- a floor independent of playback speed -- so at any speed
  // above 1x it can fall behind enough that `step`'s own "different pair, settled: rebase
  // straight from the on-screen scene to the target's current dominant scene" branch (its own
  // doc comment: "so playback never flashes through whatever scenes lie between them") skips a
  // scene as `presented.to` entirely: confirmed live (Playwright, headless Chromium, 8x
  // `'scenes'`-mode playback through apollo-11-launch's own densely-scened neighbours,
  // `data-testid="scene-caption"` sampled every 40ms) -- the presented caption sequence read
  // "green-revolution-fields" -> "shenzhen-sez-1980" directly, apollo-11-launch never dominant
  // even once, so no rate-limiter fix to `nextOnceTriggerState` alone (still keyed to
  // `presented`) can make its `rocket` cue fire; `presented` was never going to show it. The
  // engine already computes `sceneTarget` independently every render, straight from `t`
  // (`sceneAt`, pure and instantaneous, DESIGN §3/§4) -- sampling it, rather than `presented`,
  // means the arrival trigger sees every scene the playhead actually passes through, exactly
  // once each, the same guarantee CLAUDE.md's "`Layer.sample()` must be pure in `t`" already
  // asks of everything else `t` drives, extended here to a `t`-triggered *event*. `presented`
  // keeps driving loop-mode gains (`sceneSoundLoopGains`, below), which must stay visually
  // synced. Whether an already-*sounding* once voice has outlived its scene reads *both* mixes
  // (the tick loop's own `targetNow`/`presentedNow`, fed to `sceneSound.ts`'s `onceSoundOutlived`)
  // -- see that function's own doc comment for the same-day correction this needed: reading
  // `presented` alone here made a voice fire, then fade within a couple of ticks, almost every
  // time, since `presented` is still catching up to a scene the instant `sceneTarget` fires it.
  // ADR-029: while steady playback is hard-cutting through a dense scene cluster, a once-mode
  // scene's sound must not fire (no pile-up of several overlapping one-shots under images on
  // screen for a fraction of a second each) — reusing `nextOnceTriggerState`'s existing
  // `playing`/`wasPlaying` gate (its own doc comment) rather than adding a second, bespoke
  // condition: `'cut'` reads exactly like "not currently playing" to the trigger, so nothing
  // fires while it lasts, and the scene under the playhead the moment `'cut'` ends is armed off
  // rather than fired (the same "just pressed play" treatment a scene already sitting under the
  // playhead gets) instead of retroactively firing an arrival that never happened at normal pace.
  const onceFired = useSceneSoundOnceTrigger(sceneTarget, playing && presentationRegime !== 'cut')

  const flatBasalt = useMemo(() => (manifest === null ? [] : floodBasaltWindows(manifest)), [manifest])
  const catastrophes = useMemo(() => (manifest === null ? [] : catastropheWindows(manifest)), [manifest])
  // `loadPlan.ts`'s `stemsNeeded` needs this to predict `'scenes'`-mode playback the same way
  // `advancePlayhead` actually paces it (re-review fix) — computed once per manifest, like
  // `flatBasalt`/`catastrophes` above, not on every tick.
  const scenesPacing: readonly PlaybackPacingSegment[] = useMemo(
    () => (manifest === null ? [] : scenePlaybackSegments(manifest.scenes)),
    [manifest],
  )
  const co2Layer = scalarLayers.get('co2')
  const dayLengthLayer = scalarLayers.get('day_length')

  const runtimeRef = useRef<ToneRuntime | null>(null)
  const warnedMissingRef = useRef<Set<string>>(new Set())
  const onceDuckRef = useRef<{ sceneId: string; gain: number; untilMs: number; hasBeenPresented: boolean } | null>(null)

  // "Latest ref" mirrors of every tick-loop input that changes on essentially every render
  // during playback (`t` above all). The tick effect below must NOT depend on these directly —
  // during playback `t` changes on ~every rAF frame (`playback.ts`'s `onFrame` -> `setT`), so a
  // dependency array containing it would tear down and recreate the `setInterval` before its
  // 80ms delay ever elapsed, permanently starving the tick and silently freezing all live
  // audio. Kept current by the render-synced effect just below, read only inside the interval
  // callback.
  const tRef = useRef(t)
  const playbackRef = useRef(playback)
  const sectionWindowRef = useRef(sectionWindow)
  const manifestRef = useRef(manifest)
  const presentedRef = useRef(presented)
  const flatBasaltRef = useRef(flatBasalt)
  const catastrophesRef = useRef(catastrophes)
  const scenesPacingRef = useRef(scenesPacing)
  const co2LayerRef = useRef(co2Layer)
  const dayLengthLayerRef = useRef(dayLengthLayer)
  const presentationRegimeRef = useRef(presentationRegime)
  useEffect(() => {
    tRef.current = t
    playbackRef.current = playback
    sectionWindowRef.current = sectionWindow
    manifestRef.current = manifest
    presentedRef.current = presented
    flatBasaltRef.current = flatBasalt
    catastrophesRef.current = catastrophes
    scenesPacingRef.current = scenesPacing
    co2LayerRef.current = co2Layer
    dayLengthLayerRef.current = dayLengthLayer
    presentationRegimeRef.current = presentationRegime
  })

  const onUnusableStem = (id: string, reason: string): void => {
    if (warnedMissingRef.current.has(id)) return
    warnedMissingRef.current.add(id)
    // Deliberate, deduped diagnostic (spec: "log a single console.warn naming it"), never a
    // thrown error in the render/tick loop.
    console.warn(`audio: stem "${id}" ${reason} — playing silent`)
  }

  // Lazy Tone.js lifecycle: constructed only on false -> true, fully disposed on true -> false
  // (ADR-023 §2 / §4: pay nothing, including CPU, while sound is off). `buildRuntime` itself
  // loads no stem buffers — the tick loop below starts doing that on its first run once the
  // runtime exists, per this module's own doc comment.
  useEffect(() => {
    if (!prefs.enabled || manifest === null) return
    let cancelled = false
    loadTone()
      .then(async (Tone) => {
        await Tone.start()
        if (cancelled) return
        const runtime = buildRuntime(Tone, manifest, onUnusableStem)
        runtimeRef.current = runtime
        installAudioDevHook(Tone, runtime)
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
    if (onceFired === null || manifest === null) return
    const sound = onceFired.sound
    if (sound === undefined || sound.mode !== 'once') return
    const runtime = runtimeRef.current
    if (runtime === null) return
    const sceneId = onceFired.id
    const firedAtMs = performance.now()
    loadTone().then((Tone) => {
      playOnce(Tone, runtime, sceneId, sound.stem, sound.gain, firedAtMs)
    })
    const stem = manifest.audioStems.find((s) => s.id === sound.stem)
    const durationSeconds = Math.min(stem?.durationSeconds ?? ONCE_DUCK_MAX_SECONDS, ONCE_DUCK_MAX_SECONDS)
    onceDuckRef.current = { sceneId, gain: sound.gain, untilMs: performance.now() + durationSeconds * 1000, hasBeenPresented: false }
  }, [onceFired, manifest])

  // The one tick loop: recompute every pure mapping, run one loader planning step, and write
  // the results into the live Tone.js graph.
  //
  // Deliberately depends on `prefs.enabled` alone (mount/unmount once per enabled-toggle), not
  // on any of the fast-changing values the callback reads — those come from the "latest ref"
  // mirrors above instead. See their doc comment: depending on `t` here would clear and
  // recreate this `setInterval` on ~every rAF frame during playback, before the 80ms interval
  // ever got to fire, silently freezing all live audio at whatever was last computed.
  useEffect(() => {
    if (!prefs.enabled) return
    // Local to this effect instance (one per enabled-toggle), not a ref — nothing outside the
    // interval callback ever reads these, so they don't need to survive a re-render, only ticks
    // within the same running session (`IDLE_FETCH_SETTLE_MS`'s own doc comment).
    let lastFetchGateT = tRef.current
    let tSettledSinceMs = performance.now()
    const interval = window.setInterval(() => {
      const runtime = runtimeRef.current
      if (runtime === null) return

      const tickT = tRef.current
      const manifestNow = manifestRef.current
      const nowMs = performance.now()
      const playbackNow = playbackRef.current

      if (tickT !== lastFetchGateT) {
        lastFetchGateT = tickT
        tSettledSinceMs = nowMs
      }
      // While playing, the lookahead window already paces itself off real playback speed, so
      // every tick may start new fetches. While not playing, a continuous drag is many small
      // jumps in a row — wait for `t` to actually stop before starting anything new, so
      // scrubbing across eras reads as one settled position's worth of fetches, not a burst for
      // every position crossed along the way (re-review fix, `IDLE_FETCH_SETTLE_MS`).
      const settledEnoughToFetch = playbackNow.playing || nowMs - tSettledSinceMs >= IDLE_FETCH_SETTLE_MS

      const presentedNow = presentedRef.current
      runtime.currentPresented = presentedNow
      // Recomputed straight from `tickT`, the same way `useAudioEngine` derives the component-
      // level `sceneTarget` it feeds `useSceneSoundOnceTrigger` — pure and instantaneous in `t`,
      // so it never itself skips a scene the playhead actually visited (see `onceSoundOutlived`'s
      // own doc comment for why the tick loop needs this alongside `currentPresented`).
      const targetNow = manifestNow !== null && manifestNow.scenes.length > 0 ? sceneAt(manifestNow.scenes, tickT) : EMPTY_SCENE_MIX
      runtime.currentTarget = targetNow

      if (manifestNow !== null) {
        const needed = stemsNeeded({
          t: tickT,
          playback: playbackNow,
          sectionWindow: sectionWindowRef.current,
          scenes: manifestNow.scenes,
          audioStems: manifestNow.audioStems,
          flatBasaltWindows: flatBasaltRef.current,
          scenesPacing: scenesPacingRef.current,
        })
        if (settledEnoughToFetch) runLoaderStep(runtime.Tone, runtime, needed, nowMs)
      }

      const ambient = stemGains(tickT, flatBasaltRef.current)
      // ADR-029: muted (not computed at all, so `updateLoopVoices` ramps every scene-loop voice's
      // gain down through its existing `GAIN_SMOOTH_SECONDS` fade to 0 — never clicked) while
      // hard-cutting through a dense cluster; the ambience curve in `ambient` above is untouched
      // either way (`updateLoopVoices`'s own `Math.max(ambient[id] ?? 0, sceneGain)` for an
      // ambience-loop stem still combines the two normally once `sceneLoop` isn't empty again).
      const sceneLoop = presentationRegimeRef.current === 'cut' ? EMPTY_SCENE_LOOP_GAINS : sceneSoundLoopGains(presentedNow)
      updatePendingOncePresence(runtime, presentedNow)
      fadeOutlivedOnceVoices(runtime, targetNow, presentedNow)
      const duck = onceDuckRef.current
      if (duck !== null) duck.hasBeenPresented = onceVoiceHasBeenPresented(presentedNow, duck.sceneId, duck.hasBeenPresented)
      const onceDuckActive = duck !== null && nowMs < duck.untilMs && !onceSoundOutlived(targetNow, presentedNow, duck.sceneId, duck.hasBeenPresented)
      const onceGain = onceDuckActive ? duck.gain : 0

      const loopSceneSoundGain = updateLoopVoices(runtime, ambient, sceneLoop, nowMs)
      const maxSceneSoundGain = Math.max(onceGain, loopSceneSoundGain)

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
