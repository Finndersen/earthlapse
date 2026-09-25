/**
 * Development/QA automation hook: exposes the time store, plus DOM-driven conveniences, on
 * `window.__earthlapse` so a browser-driven check can set `t`, pause playback, flip view toggles
 * and read state back without reloading the page or approximating positions via pixel drags.
 *
 * Gated on `process.env.NODE_ENV === 'development'` OR `NEXT_PUBLIC_EARTHLAPSE_QA === '1'`, both
 * inlined by Next at build time: an ordinary production build dead-code-eliminates everything
 * below the early return, and only a static export built with the QA env var carries this
 * surface (`web/scripts/qa`).
 *
 * Two mechanisms back this surface:
 * - `setT`/`getState` and the playback/globe-expand setters call straight into `useTimeStore`
 *   — real store state (DESIGN §12).
 * - `getGlobeViewMode`/`setGlobeViewMode`/`setLayerToggle` do not: the Globe/Map toggle and the
 *   legend's per-overlay toggles are deliberately local component state, not lifted to the store
 *   (`Globe.tsx`'s `mapMode` doc comment: "pure chrome with no bearing on playback or `t`"). This
 *   module has no access to them and must not reach into React internals, so it drives the same
 *   accessible controls a person would — reading `aria-pressed` and calling `.click()` on the
 *   real buttons. That couples these functions to `Globe.tsx`'s/`Legend.tsx`'s copy and ARIA
 *   structure: a label change breaks them loudly (they throw) rather than silently no-op.
 *
 * `setTourOpen` is neither: it calls `@/onboarding`'s own session-scoped visibility store, the
 * one path the tour's Skip button also takes.
 *
 * The sphere<->map unfold tween's own progress (`Globe.tsx`'s `unfold`, 0..1) is deliberately not
 * exposed: it is local animation state with no DOM reflection, and the panel's own CSS resize is
 * a separate, independently-timed transition (see `GlobeCameraControls`'s doc comment on the two
 * having drifted apart). A harness needing a mid-transition frame must trigger the toggle and
 * sample after a calibrated wait instead.
 */

import { setGlobeTourOpen, setOnboardingTourOpen } from '@/onboarding'
import type { SectionId } from '@/timeline/sections'
import type { PlaybackMode } from '@/types/layer'

import { useTimeStore } from './time'

/** Present only once the app shell has actually mounted real content: `Experience.tsx` renders
 *  nothing but a "Loading manifest…" string until the manifest has loaded and the initial `t`
 *  has been applied (see that component's own `initialised` doc comment). */
const APP_READY_SELECTOR = '[data-testid="time-title"]'

/** Stable keys a harness can pass to `setLayerToggle`, mapped to the legend row's own visible
 *  labels (`Legend.tsx`'s `LegendRow.label` and `compactLabel`) — the only thing that actually
 *  identifies a row in the DOM, since toggle state itself is local to `Globe.tsx`. Both spellings
 *  are listed because the legend prints the short one on a phone viewport, where a harness still
 *  has to be able to reach the row. Extend this alongside any new legend row. */
const LAYER_TOGGLE_LABELS: Record<string, readonly string[]> = {
  'human-civilisation': ['Human civilisation', 'People'],
}

export interface EarthlapseDevHook {
  setT: (t: number) => void
  getState: typeof useTimeStore.getState
  /** Pauses (`false`) or resumes (`true`) playback — a still frame is otherwise never
   *  guaranteed, since `usePlaybackLoop` keeps advancing `t` every animation frame while
   *  `playback.playing` is true. */
  setPlaying: (playing: boolean) => void
  setPlaybackMode: (mode: PlaybackMode) => void
  /** Sets the active mode's rate: the scenes multiplier, or steady years per second. */
  setPlaybackRate: (rate: number) => void
  /** `useTimeStore`'s `selectSection`: moves `t` to the section's start only if it lies outside. */
  selectSection: (id: SectionId) => void
  /** Expands or collapses the globe overlay (`useTimeStore`'s `globeExpanded`). */
  setGlobeExpanded: (expanded: boolean) => void
  /** Reads which of the expanded globe's "Globe"/"Map" toggle is currently pressed by
   *  inspecting the real DOM control (see this module's own doc comment) — `null` when the
   *  globe isn't expanded (WebGL-unavailable or collapsed), since the toggle doesn't exist then. */
  getGlobeViewMode: () => 'globe' | 'map' | null
  /** Clicks the corresponding "Globe"/"Map" button. Throws if the globe isn't expanded (the
   *  toggle only renders then) — never silently no-ops. */
  setGlobeViewMode: (mode: 'globe' | 'map') => void
  /** Opens the first-visit tour (`@/onboarding`), or dismisses it and records it as seen — the
   *  same single path its own Skip button takes. Dismissing also marks the globe tour seen, so it
   *  never opens over a shot that expands the globe. The harness runs in a fresh browser context
   *  whose `localStorage` is empty, so the tour would otherwise open over every shot in the run;
   *  `run.mjs` dismisses it immediately after load and the one shot that guards the tour itself
   *  re-opens it. Session state, so this does not need a reload — which is what makes it
   *  expressible here at all (`run.mjs` loads the page exactly once). */
  setTourOpen: (open: boolean) => void
  /** Clicks a legend overlay row's On/Off control by stable key (see `LAYER_TOGGLE_LABELS`).
   *  Throws for an unknown key or a row not currently in the DOM (out of its data domain, or
   *  the globe isn't expanded — the legend only renders then). */
  setLayerToggle: (key: string, on: boolean) => void
  /** Resolves once the app shell has mounted, every image/texture fetch this module has seen
   *  in flight has settled, and a couple of animation frames have had a chance to paint the
   *  result — see `instrumentResourceLoading`'s own doc comment for exactly what "seen" covers.
   *  A harness should always await this (plus, per shot, one or two more raw `rAF` ticks after
   *  driving an action) instead of a blind `waitForTimeout`. */
  ready: () => Promise<void>
}

declare global {
  interface Window {
    __earthlapse?: EarthlapseDevHook
  }
}

/** In-flight image/texture load count this module has actually observed — see
 *  `instrumentResourceLoading`. Module-scoped rather than per-call state since it tracks the
 *  whole page, not any one caller's request. */
let pendingLoads = 0
let instrumented = false

function trackPendingLoad(): () => void {
  pendingLoads += 1
  let released = false
  return () => {
    if (released) return
    released = true
    pendingLoads = Math.max(0, pendingLoads - 1)
  }
}

/**
 * Patches `window.fetch` and `HTMLImageElement.prototype.src` to count in-flight loads, so
 * `ready()` knows when every image/texture this page knows about has finished loading, without
 * touching `Globe.tsx` or `scene/*` directly.
 *
 * Covers both texture paths: `globe/textureCache.ts`'s `fetch` + `createImageBitmap`, and
 * `scene/textureCache.ts`'s `THREE.TextureLoader` (like `SceneFallbackView`'s plain `<img>`, both
 * ultimately set `.src` on an `HTMLImageElement`) — patching the shared `src` setter on the
 * prototype catches all three call sites at once. It cannot see a resource loaded some other way
 * (Tone.js audio decode, say): `ready()` is scoped to the current scene image and globe textures.
 *
 * Installed once per page load (`instrumented` guards a StrictMode double-mount); harmless to
 * leave patched for the rest of the session.
 */
function instrumentResourceLoading(): void {
  if (instrumented) return
  instrumented = true

  const originalFetch = window.fetch.bind(window)
  window.fetch = ((...args: Parameters<typeof fetch>) => {
    const release = trackPendingLoad()
    return originalFetch(...args).finally(release)
  }) as typeof fetch

  const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
  if (srcDescriptor?.set !== undefined) {
    const originalSet = srcDescriptor.set
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...srcDescriptor,
      set(this: HTMLImageElement, value: string) {
        const release = trackPendingLoad()
        this.addEventListener('load', release, { once: true })
        this.addEventListener('error', release, { once: true })
        originalSet.call(this, value)
      },
    })
  }
}

function pollUntil(predicate: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const tick = (): void => {
      if (predicate()) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    tick()
  })
}

function nextFrames(count: number): Promise<void> {
  if (count <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    requestAnimationFrame(() => nextFrames(count - 1).then(resolve))
  })
}

async function ready(): Promise<void> {
  await pollUntil(() => document.querySelector(APP_READY_SELECTOR) !== null)
  // Settle twice with a couple of frames in between: a load that resolves and immediately
  // starts another (the preload window both texture caches keep ahead of `t`) must not read as
  // "done" off a single zero reading.
  await pollUntil(() => pendingLoads === 0)
  await nextFrames(2)
  await pollUntil(() => pendingLoads === 0)
  await nextFrames(2)
}

function findAccessibleButton(text: string, requireAriaPressed: boolean): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === text && (!requireAriaPressed || button.hasAttribute('aria-pressed')),
  )
}

function getGlobeViewMode(): 'globe' | 'map' | null {
  const mapButton = findAccessibleButton('Map', true)
  if (mapButton === undefined) return null
  return mapButton.getAttribute('aria-pressed') === 'true' ? 'map' : 'globe'
}

function setGlobeViewMode(mode: 'globe' | 'map'): void {
  const label = mode === 'map' ? 'Map' : 'Globe'
  const button = findAccessibleButton(label, true)
  if (button === undefined) throw new Error(`globe view toggle "${label}" not found — is the globe expanded?`)
  button.click()
}

function findLayerToggleGroup(labels: readonly string[]): HTMLElement {
  const labelEl = Array.from(document.querySelectorAll('span')).find((span) => labels.includes(span.textContent?.trim() ?? ''))
  const group = labelEl?.parentElement?.querySelector('[role="group"]')
  if (!(group instanceof HTMLElement)) {
    throw new Error(
      `layer toggle "${labels[0]}" not found in the DOM — is the globe expanded and the row in its data domain?`,
    )
  }
  return group
}

function setLayerToggle(key: string, on: boolean): void {
  const labels = LAYER_TOGGLE_LABELS[key]
  if (labels === undefined) throw new Error(`unknown layer toggle key "${key}"`)
  const group = findLayerToggleGroup(labels)
  const buttonText = on ? 'On' : 'Off'
  const button = Array.from(group.querySelectorAll('button')).find((b) => b.textContent?.trim() === buttonText)
  if (button === undefined) throw new Error(`layer toggle "${labels[0]}" has no "${buttonText}" button`)
  button.click()
}

export function installDevHook(): void {
  if (process.env.NODE_ENV !== 'development' && process.env.NEXT_PUBLIC_EARTHLAPSE_QA !== '1') return
  instrumentResourceLoading()
  window.__earthlapse = {
    setT: (t) => useTimeStore.getState().setT(t),
    getState: useTimeStore.getState,
    setPlaying: (playing) => useTimeStore.getState().setPlaying(playing),
    setPlaybackMode: (mode) => useTimeStore.getState().setPlaybackMode(mode),
    setPlaybackRate: (rate) => {
      const store = useTimeStore.getState()
      if (store.playback.mode === 'scenes') store.setSpeed(rate)
      else store.setYearsPerSecond(rate)
    },
    selectSection: (id) => useTimeStore.getState().selectSection(id),
    setGlobeExpanded: (expanded) => useTimeStore.getState().setGlobeExpanded(expanded),
    getGlobeViewMode,
    setGlobeViewMode,
    setTourOpen: (open) => {
      setOnboardingTourOpen(open)
      if (!open) setGlobeTourOpen(false)
    },
    setLayerToggle,
    ready,
  }
}
