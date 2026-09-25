/**
 * The tour's steps, as data. Four things a viewer cannot work out by looking (IMPLEMENTATION
 * § Backlog — onboarding): that play runs the timeline through the scenes, that the timeline
 * scrubs, what the era shortcuts are, and that the corner orb opens.
 *
 * Each step names its target by CSS selector, resolved against the live DOM at runtime — never a
 * fixed coordinate, since three of the four targets genuinely move between the phone and desktop
 * layouts. The selectors reuse the `data-testid`s those controls already carry rather than
 * introducing a second attribute convention.
 *
 * The era step is the one place on screen a viewer is told what "Dinosaurs" and "Humans" are:
 * the pills carry no visible heading, only an `aria-label`, and both words are nicknames for a
 * real geological unit. Its copy names both halves of each pairing.
 */

export type TourStepId = 'play' | 'scrub' | 'eras' | 'globe' | 'about' | GlobeTourStepId

export type GlobeTourStepId = 'globe-view' | 'globe-empires' | 'globe-overlay'

/** The highlight ring's outline. `'circle'` for a target that is itself round (the globe orb's
 *  expand affordance is a circle inset inside the orb's square box), `'rounded'` otherwise. */
export type AnchorShape = 'circle' | 'rounded'

/** Copy that has to differ between the phone layout and the wider one: a phone is tapped, not
 *  clicked, and has no hover to describe. Keyed by the same 760px breakpoint the rest of the HUD
 *  restacks at (`@/lib/useIsCompactViewport`). */
export interface BreakpointCopy {
  compact: string
  wide: string
}

export interface TourStep {
  id: TourStepId
  /** A selector list is tried in the order written, and the first match with a drawn box wins —
   *  so a step can name a fallback for a target one layout doesn't render. */
  selector: string
  title: string
  body: BreakpointCopy
  shape: AnchorShape
  /** Desktop/pointer-fine layouts only (`OnboardingTour.tsx` drops it from the shown steps on a
   *  compact viewport) — for a step about something that isn't relevant on a phone, such as
   *  keyboard shortcuts. */
  desktopOnly?: boolean
}

/** The play button, via the transport cluster's own `data-testid`. Matched on either accessible
 *  name because the same button is named "Pause" while playing — the tour never starts playback,
 *  but a viewer is free to press play underneath it, and the ring has to keep its target. */
const PLAY_BUTTON_SELECTOR = '[data-testid="timeline-controls-core"] button:is([aria-label="Play"], [aria-label="Pause"])'

/** The About & credits button, via its accessible name — it carries no `data-testid` of its own
 *  (`ShellLayout.tsx`). */
const ABOUT_BUTTON_SELECTOR = '[aria-label="About & credits"]'

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'play',
    selector: PLAY_BUTTON_SELECTOR,
    title: 'Press play',
    body: {
      compact: 'Tap play and the timeline runs forward through 4.6 billion years, scene by scene.',
      wide: 'Click play and the timeline runs forward through 4.6 billion years, scene by scene.',
    },
    shape: 'circle',
  },
  {
    id: 'scrub',
    selector: '[data-testid="timeline-track-stack"]',
    title: 'The timeline scrubs',
    body: {
      compact: 'Drag the playhead to land anywhere in the whole 4.6 billion years.',
      wide: 'Drag the playhead, or click the track, to land anywhere in the whole 4.6 billion years.',
    },
    shape: 'rounded',
  },
  {
    id: 'eras',
    selector: '[data-testid="era-shortcuts"]',
    title: 'Two shortcuts to an era',
    body: {
      compact: 'Dinosaurs is the Mesozoic, Humans is the Holocene. Tap one to take the timeline to that era.',
      wide: 'Dinosaurs is the Mesozoic, Humans is the Holocene. Click one to take the timeline to that era.',
    },
    shape: 'rounded',
  },
  {
    id: 'globe',
    selector: '[data-testid="globe-expand"]',
    title: 'The globe opens',
    body: {
      compact: 'Tap the orb to fill the screen with the world as it was at this moment.',
      wide: 'Click the orb to fill the screen with the world as it was at this moment.',
    },
    shape: 'circle',
  },
  {
    id: 'about',
    selector: ABOUT_BUTTON_SELECTOR,
    title: 'Keyboard shortcuts',
    body: {
      compact: 'Open About for the full list of keyboard shortcuts.',
      wide: 'Open About for the full list of keyboard shortcuts, including search (/) and speed ([ ]).',
    },
    shape: 'rounded',
    desktopOnly: true,
  },
]

/** The empire territories are only drawn from 3400 BCE on, so the empires step names the moment
 *  the host jumps to when the viewer is outside that range (`GlobeTour`'s `onJumpToEmpires`). */
export const GLOBE_TOUR_JUMP_LEAD = 'Here is the world in 117 CE, with Rome at its height; the tour takes you back after.'

/** Shown the first time the globe is expanded: what the expanded view holds that the first tour
 *  cannot point at, since none of it exists until the globe opens. */
export const GLOBE_TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'globe-view',
    selector: '[data-testid="globe-view-mode-group"]',
    title: 'Globe or map',
    body: {
      compact: 'Switch between the globe and a flat map of the same moment.',
      wide: 'Switch between the globe and a flat map of the same moment. Drag to turn it, scroll to zoom.',
    },
    shape: 'rounded',
  },
  {
    id: 'globe-empires',
    selector: '[data-testid="globe-legend-corner"], [data-testid="globe-sphere-fit-frame"], [data-testid="globe-map-fit-frame"]',
    title: 'Empires and peoples',
    body: {
      compact: 'Tap an empire, a migration arc or a settlement, then tap again for its story.',
      wide: 'Hover over an empire to trace its borders, and click it, a migration arc or a settlement for its story.',
    },
    shape: 'rounded',
  },
  {
    id: 'globe-overlay',
    selector: '[data-testid="globe-overlay-select-stack"]',
    title: 'Map overlays',
    body: {
      compact: 'Shade the land by population density or by land cleared for farming.',
      wide: 'Shade the land by population density or by land cleared for farming, back to 10,000 BCE.',
    },
    shape: 'rounded',
  },
]
