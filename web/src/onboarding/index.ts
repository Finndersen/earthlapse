/**
 * web/src/onboarding — the first-visit tour (IMPLEMENTATION § Backlog — onboarding). Four steps
 * ringing the controls that are not self-evident: play, the scrubbable timeline, the era
 * shortcuts and the expandable globe.
 *
 * - `OnboardingTour` — the whole feature, mounted once from `app/Experience.tsx`. Renders nothing
 *   until an effect has read the persisted flag, and nothing ever again once dismissed.
 * - `setOnboardingTourOpen(open)` — the one dismissal path, shared by the tour's Skip button and
 *   by `store/devHook.ts` (the visual-QA harness loads the page once, in a fresh browser context
 *   whose `localStorage` is empty, so it has to dismiss the tour through the hook rather than by
 *   reloading with the flag set).
 *
 * The package owns no application state: it never imports `store/time.ts`, so the tour cannot
 * start playback, expand the globe or move `t`.
 */

export { OnboardingTour } from './OnboardingTour'
export { setOnboardingTourOpen } from './visibility'
