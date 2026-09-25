/**
 * web/src/onboarding — the tours (IMPLEMENTATION § Backlog — onboarding). The first-visit tour
 * rings the controls that are not self-evident: play, the scrubbable timeline, the era shortcuts
 * and the expandable globe. The globe tour, shown the first time the globe opens, covers the
 * Globe/Map switch, the empire and migration layer, and the map overlays.
 *
 * - `OnboardingTour`, `GlobeTour` — mounted once each from `app/Experience.tsx`. Each renders
 *   nothing until an effect has read its persisted flag, and nothing ever again once dismissed.
 * - `setOnboardingTourOpen(open)`, `setGlobeTourOpen(open)` — each tour's one dismissal path,
 *   shared by its Skip button and by `store/devHook.ts` (the visual-QA harness loads the page
 *   once, in a fresh browser context whose `localStorage` is empty, so it has to dismiss the
 *   tours through the hook rather than by reloading with the flags set).
 *
 * The package owns no application state: it never imports `store/time.ts`. The one time a tour
 * moves `t`, it asks the host to (`GlobeTour`'s `onJumpToEmpires`).
 */

export { GlobeTour, OnboardingTour } from './OnboardingTour'
export { setGlobeTourOpen, setOnboardingTourOpen } from './visibility'
