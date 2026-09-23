/**
 * Which stem buffers should be loaded right now (ADR-023 amendment "on-demand loading"). Pure
 * and Tone-free, like `stemGains.ts`/`ramp.ts` — `bufferCache.ts` is the stateful fetch/evict
 * bookkeeping layer and `engine.ts` is the one that actually performs I/O, so this module never
 * does either and is unit testable without mounting anything.
 *
 * `stemsNeeded` answers one question: given where `t` is and where playback is about to carry
 * it, which stems' buffers does the engine need decoded in memory? Three contributions, unioned:
 *
 * - Every **ambience** stem (`stemGains.ts`) whose curve exceeds `GAIN_THRESHOLD` anywhere in
 *   the lookahead window — sampled, not solved analytically, since a curve is an arbitrary sum
 *   of ramps/bumps with no exposed closed form for "where does this cross 0.01".
 * - Every **scene loop** stem (`SceneRecord.sound`, mode `'loop'`) whose *presented* gain
 *   (`sceneSoundLoopGains(sceneAt(scenes, sampleT))` — the same pure target `engine.ts`'s
 *   `updateLoopVoices` reads) exceeds `GAIN_THRESHOLD` anywhere in the window. Sampled the same
 *   way as an ambience curve, deliberately not by checking `scene.t` alone: `sceneAt` holds a
 *   scene dominant well past its own `t`, until the dissolve reaches the log-midpoint of the gap
 *   to the next one (`scene/scene.ts`'s `DISSOLVE_WIDTH`), and ramps it in similarly before `t`
 *   — a `scene.t`-only check would miss both tails.
 * - Every **scene** stem (loop or `once`) whose scene's own `t` falls inside a second, wider
 *   `sceneArrivalWindow` — a `once` voice must have its buffer ready the instant the scene
 *   settles (there is no fallback fade-in the way a loop's gain ramp gives it), so scene stems
 *   get their own longer runway and are fetched ahead of ambience.
 *
 * The lookahead window (`lookaheadWindow`) is deliberately NOT "however far a computed velocity
 * says t will travel": `playback.mode === 'scenes'` paces at whatever rate fits each segment's
 * `durationSeconds` (`scene/pacing.ts`'s `scenePlaybackSegments`), and `'steady'` mode moves at
 * a literal `yearsPerSecond`. Both are exactly what `timeline/playback.ts`'s `advancePlayhead`
 * computes, so this module calls it directly rather than re-deriving an approximation.
 *
 * - **Playing**: `advancePlayhead(t, lookaheadSeconds, ..., scale, scenesPacing)` predicts where
 *   `t` will be after `lookaheadSeconds` of wall-clock playback, with the same pacing segments
 *   (`'scenes'`) or rate (`'steady'`) the real playhead uses. `'steady'` ignores the per-scene
 *   floor, so it can only overestimate how far `t` travels, and the section clamp below bounds
 *   that. The backstop behind (an immediate pause-and-reverse) is a fraction of that predicted
 *   distance in `u` of `scale` — full-domain symlog for `'scenes'`, a symlog scale of the selected
 *   section for `'steady'`. Playback only ever moves toward the present, so the window is
 *   asymmetric: most of the span ahead, a small backstop behind.
 * - **Not playing** (paused, or `t` being moved by a scrub/click/jump the engine cannot
 *   distinguish from one another): a small fixed `u` margin on the full-domain scale, symmetric
 *   in both directions — this is what keeps a big scrub or a section jump from bursting every
 *   stem it technically passed through: the window only ever covers a small neighbourhood of
 *   wherever `t` currently sits, never the ground crossed to get there. Direction cannot be
 *   inferred from a single external `t` value, so this deliberately does not try to (the
 *   alternative considered — measuring `t`'s own frame-to-frame velocity — is in
 *   DECISIONS.md); the companion fix for a *continuous* drag (many small jumps in a row) is
 *   `engine.ts`'s own fetch-start settle delay, not a wider window here.
 *
 * Both cases are clamped to `sectionWindow` (ADR-024's selected section): playback and ordinary
 * scrubbing stay inside it by construction, so this is the hard backstop against a runaway
 * lookahead span at an extreme speed deep in time.
 */

import { sceneAt } from '@/scene'
import { advancePlayhead, createSymlogScale, type PlaybackPacingSegment } from '@/timeline'
import type { GeoTime, Playback, TimeScale } from '@/types/layer'
import { EARTH_FORMATION } from '@/types/layer'
import type { AudioStem, Scene } from '@/types/manifest'

import type { TimeWindow } from './ramp'
import { sceneSoundLoopGains } from './sceneSound'
import { stemGains } from './stemGains'
import { AMBIENCE_STEM_IDS, isStemId, type StemId } from './stemIds'

/** A stem's curve (or scene loop gain) counts as "needed" once it clears this — below it the
 *  stem is inaudible under any reasonable master/system volume, so loading it early buys
 *  nothing. Matches `engine.ts`'s own `SILENCE_GAIN_THRESHOLD`, so "needed" and "audible" always
 *  agree. */
export const GAIN_THRESHOLD = 0.01

/** How many wall-clock seconds of *playing* playback the ordinary lookahead window covers, in
 *  the direction of travel — sized for a typical ambience curve or scene-loop gain crossing the
 *  threshold, not for a large one-shot clip's own fetch+decode time (that is
 *  `ONCE_LOOKAHEAD_SECONDS`'s job). A few times `TICK_MS`'s cadence (`engine.ts`) and
 *  comfortably more than a typical fetch+decode of a several-hundred-KB clip on an ordinary
 *  connection, without reaching so far ahead that a fast scrub session's worth of stems all look
 *  "needed" at once. Exported for direct use in tests that check the window against
 *  `advancePlayhead` itself. */
export const PLAYING_LOOKAHEAD_SECONDS = 6

/** How far ahead a scene's own arrival (`scene.t`) is searched for — wider than the ordinary
 *  lookahead specifically because a scene stem's buffer must be fully ready *before* the scene
 *  settles: a `once` voice has no gain ramp to hide a late arrival behind. */
export const ONCE_LOOKAHEAD_SECONDS = 20

/** The backstop span behind the direction of travel while playing, as a fraction of the
 *  forward span — covers an immediate pause-and-small-reverse without doubling the forward
 *  lookahead for the overwhelmingly common case of continuing to play forward. */
const PLAYING_BACKSTOP_FRACTION = 0.25

/** The symmetric full-domain-scale `u` margin used whenever `t` is not moving under the
 *  playback clock (paused, or being scrubbed/clicked/jumped — indistinguishable from one
 *  another given only a sequence of external `t` values). Small enough that a big scrub or
 *  section jump never reads as "every stem it crossed is needed", generous enough that a slow
 *  manual scrub keeps neighbouring stems warm rather than reloading on every small movement. */
const IDLE_U_DELTA = 0.004

/** The full-domain symlog scale (`timeline/scale.ts`'s default `SYMLOG_C` knee) — the same
 *  scale `'scenes'`-mode `advancePlayhead` always paces on (`timeline/index.ts`'s own doc
 *  comment), and `Experience.tsx`'s own module-scope `FULL_DOMAIN_SYMLOG_SCALE`. Recomputed
 *  here as its own module constant rather than threaded through as a prop — the same "one
 *  package, one fixed full-domain copy, for an unrelated purpose" pattern `timeline/scale.ts`'s
 *  own doc comment already describes `scene/pacing.ts` and `globe/effects/math.ts` using. */
const FULL_DOMAIN_SYMLOG_SCALE: TimeScale = createSymlogScale([0, EARTH_FORMATION])

function clamp(value: GeoTime, min: GeoTime, max: GeoTime): GeoTime {
  return Math.min(max, Math.max(min, value))
}

/** The scale the lookahead's backstop is measured in: full-domain symlog for `'scenes'` (the
 *  scale it paces on), a symlog scale of the selected section for `'steady'`. */
function predictionScale(mode: Playback['mode'], sectionWindow: readonly [GeoTime, GeoTime]): TimeScale {
  return mode === 'scenes' ? FULL_DOMAIN_SYMLOG_SCALE : createSymlogScale(sectionWindow)
}

/** The `[tFrom, tTo]` span (`tFrom <= t <= tTo`) the loader should treat as "coming up", per
 *  this module's doc comment. `lookaheadSeconds` defaults to the ordinary
 *  `PLAYING_LOOKAHEAD_SECONDS`; `stemsNeeded` calls this a second time with
 *  `ONCE_LOOKAHEAD_SECONDS` for the wider scene-arrival check. Exported for direct testing of
 *  the lookahead shape in isolation from which stems it happens to include. */
export function lookaheadWindow(
  t: GeoTime,
  playback: Pick<Playback, 'playing' | 'baseRate' | 'speed' | 'yearsPerSecond' | 'mode'>,
  sectionWindow: readonly [GeoTime, GeoTime],
  scenesPacing: readonly PlaybackPacingSegment[] = [],
  lookaheadSeconds: number = PLAYING_LOOKAHEAD_SECONDS,
): TimeWindow {
  const [tNewer, tOlder] = sectionWindow

  let tFrom: GeoTime
  let tTo: GeoTime
  if (playback.playing) {
    const scale = predictionScale(playback.mode, sectionWindow)
    tFrom = advancePlayhead(
      t,
      lookaheadSeconds,
      { playing: true, baseRate: playback.baseRate, speed: playback.speed, yearsPerSecond: playback.yearsPerSecond, mode: playback.mode },
      scale,
      playback.mode === 'scenes' ? scenesPacing : [],
    )
    const uAtT = scale.toUnit(t)
    const backstopU = Math.abs(scale.toUnit(tFrom) - uAtT) * PLAYING_BACKSTOP_FRACTION
    // `u` increases toward the present (`timeline/index.ts`'s orientation contract) — moving
    // *back* into the past is therefore a *smaller* u, the mirror of `tFrom`'s `advancePlayhead`
    // call above.
    tTo = scale.fromUnit(uAtT - backstopU)
  } else {
    const uAtT = FULL_DOMAIN_SYMLOG_SCALE.toUnit(t)
    tFrom = FULL_DOMAIN_SYMLOG_SCALE.fromUnit(uAtT + IDLE_U_DELTA)
    tTo = FULL_DOMAIN_SYMLOG_SCALE.fromUnit(uAtT - IDLE_U_DELTA)
  }

  const from = clamp(tFrom, tNewer, tOlder)
  const to = clamp(tTo, tNewer, tOlder)
  // `t` itself may already sit outside `[from, to]` once the clamps above collapse a
  // near-degenerate window at a section edge; widening to include it keeps the invariant
  // `tMin <= tMax` `ramp.ts` (and every sampler below) assumes, and "what's needed right now"
  // must always be in its own lookahead window regardless.
  return { tMin: Math.min(from, t), tMax: Math.max(to, t) }
}

/** Points to sample a curve/scene mix at across `[window.tMin, window.tMax]`, spaced evenly in
 *  `log1p(t)` — the same space every curve in `stemGains.ts` is authored in, so a fixed sample
 *  count resolves a curve's fastest-changing region (always near the window's `t = 0` end, if
 *  it has one) as reliably as its slowest. 33 points is enough to resolve the narrowest published
 *  bump/duck window (the ~1,300-year K-Pg vegetation collapse) whenever a lookahead window is
 *  itself narrow enough to be sampling right at that scale; a broad window (idle, deep time)
 *  needs far fewer points for the same curves, so this errs on the side of "cheap and correct"
 *  over "exactly optimal per window width". */
const GAIN_SAMPLE_COUNT = 33

function sampleLogSpace(window: TimeWindow): GeoTime[] {
  const { tMin, tMax } = window
  if (tMin >= tMax) return [tMin]
  const logMin = Math.log1p(tMin)
  const logMax = Math.log1p(tMax)
  const samples: GeoTime[] = new Array(GAIN_SAMPLE_COUNT)
  for (let i = 0; i < GAIN_SAMPLE_COUNT; i++) {
    const u = i / (GAIN_SAMPLE_COUNT - 1)
    samples[i] = Math.expm1(logMin + (logMax - logMin) * u)
  }
  return samples
}

export interface StemsNeededInput {
  t: GeoTime
  playback: Pick<Playback, 'playing' | 'baseRate' | 'speed' | 'yearsPerSecond' | 'mode'>
  /** The selected era section's window, `[tNewer, tOlder]` (ADR-024) — the hard bound on how
   *  far the lookahead window can reach. */
  sectionWindow: readonly [GeoTime, GeoTime]
  scenes: readonly Scene[]
  /** The published stem catalogue — only ids present here are ever returned, so a curve or
   *  scene referencing a stem the manifest doesn't (yet) carry never reaches the loader. */
  audioStems: readonly AudioStem[]
  flatBasaltWindows: readonly TimeWindow[]
  /** `scene/pacing.ts`'s `scenePlaybackSegments(scenes)`, structurally (this package imports
   *  only `timeline`'s `PlaybackPacingSegment` type, not `@/scene`, for it — the same
   *  decoupling `timeline/playback.ts` itself uses). Only consulted in `'scenes'`-mode playback;
   *  defaults to `[]` (flat-rate fallback, `advancePlayhead`'s own default) for every other
   *  caller. */
  scenesPacing?: readonly PlaybackPacingSegment[]
}

/**
 * The set of stem ids the loader should have a decoded buffer ready for, given `input`. Pure:
 * same inputs, same result, no I/O, no `tone` import (this module's own doc comment).
 *
 * The result's iteration order (a JS `Set`'s is its insertion order) is nearest-priority-first:
 * every once-mode scene stem ahead of everything else (a missed one-shot cue is the worst
 * outcome the loader can cause and cannot be masked by a gain ramp the way a late ambience fade
 * can), then nearest-`t`-first within each tier — `bufferCache.ts`'s `plan()` takes that order
 * directly as its fetch priority, so the loader never has to re-derive "how urgent" on its own.
 */
export function stemsNeeded(input: StemsNeededInput): ReadonlySet<StemId> {
  const { t, playback, sectionWindow, scenes, audioStems, flatBasaltWindows, scenesPacing = [] } = input
  const window = lookaheadWindow(t, playback, sectionWindow, scenesPacing)
  const sceneArrivalWindow = lookaheadWindow(t, playback, sectionWindow, scenesPacing, ONCE_LOOKAHEAD_SECONDS)
  const published = new Set(audioStems.map((stem) => stem.id))

  const candidates: { id: StemId; distance: number; priority: 0 | 1 }[] = []
  const seen = new Set<StemId>()

  function consider(id: string, distance: number, priority: 0 | 1): void {
    if (!isStemId(id)) return
    if (seen.has(id) || !published.has(id)) return
    seen.add(id)
    candidates.push({ id, distance, priority })
  }

  // Ambience curves and scene *loop* gains, sampled together across the ordinary window —
  // `t` itself is always included (distance 0) so whatever is audible this instant is always
  // "needed" regardless of where the sample grid happens to land.
  const orderedSamples = [t, ...sampleLogSpace(window)]
    .map((sampleT) => ({ sampleT, distance: Math.abs(sampleT - t) }))
    .sort((a, b) => a.distance - b.distance)
  for (const { sampleT, distance } of orderedSamples) {
    const gains = stemGains(sampleT, flatBasaltWindows)
    for (const id of AMBIENCE_STEM_IDS) {
      if (gains[id] > GAIN_THRESHOLD) consider(id, distance, 1)
    }
    if (scenes.length > 0) {
      const loopGains = sceneSoundLoopGains(sceneAt(scenes, sampleT))
      for (const [stemId, gain] of Object.entries(loopGains)) {
        if (gain !== undefined && gain > GAIN_THRESHOLD) consider(stemId, distance, 1)
      }
    }
  }

  // Scene arrivals (both `once` and `loop`), over the wider `sceneArrivalWindow` — a `once`
  // stem is priority 0 (ahead of every ambience/loop stem above); a `loop` scene stem arriving
  // soon is priority 1, same tier as everything above (it also gets caught by the sampling loop
  // once it is actually presented, this just gives it a head start).
  const orderedScenes = scenes
    .flatMap((scene) => {
      const sound = scene.sound
      if (sound === undefined || scene.t < sceneArrivalWindow.tMin || scene.t > sceneArrivalWindow.tMax) return []
      return [{ sound, distance: Math.abs(scene.t - t) }]
    })
    .sort((a, b) => a.distance - b.distance)
  for (const { sound, distance } of orderedScenes) {
    consider(sound.stem, distance, sound.mode === 'once' ? 0 : 1)
  }

  candidates.sort((a, b) => a.priority - b.priority || a.distance - b.distance)
  return new Set(candidates.map((c) => c.id))
}
