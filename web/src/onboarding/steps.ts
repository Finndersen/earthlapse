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

export type TourStepId = 'play' | 'scrub' | 'eras' | 'globe'

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
  selector: string
  title: string
  body: BreakpointCopy
  shape: AnchorShape
}

/** The play button, via the transport cluster's own `data-testid`. Matched on either accessible
 *  name because the same button is named "Pause" while playing — the tour never starts playback,
 *  but a viewer is free to press play underneath it, and the ring has to keep its target. */
const PLAY_BUTTON_SELECTOR = '[data-testid="timeline-controls-core"] button:is([aria-label="Play"], [aria-label="Pause"])'

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
]
