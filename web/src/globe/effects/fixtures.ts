/**
 * Shared fixture data for this directory's tests, mirroring `web/src/layers/fixtures.ts`'s own
 * convention (a plain data file, not a `.test.ts`, so several test files can share it). Dates
 * and `effect` shapes match `data/globe_regimes.yaml` and `data/events.yaml` exactly — the
 * crossfade math this directory tests only makes sense against the real boundaries (two
 * regimes with a 50 Myr cited overlap, two more that only touch) — but every other field
 * (`description`, `citation`, `importance`) is trimmed to a plausible placeholder, the same
 * trade-off `web/src/layers/fixtures.ts` makes.
 */

import type { TimelineEvent } from '@/types/layer'

/** All five `globe-regimes` events, unfiltered — `regimeWeightsAt` needs the full set, not a
 *  `sample(t)` slice (see `regimes.ts`'s doc comment). */
export const REGIME_EVENTS: readonly TimelineEvent[] = [
  {
    id: 'magma-ocean-regime',
    label: 'Magma ocean and newborn Moon',
    tMin: 4.35e9,
    tMax: 4.52e9,
    importance: 0.9,
    description: 'placeholder',
    citation: 'Barboni et al. 2017',
    effect: { kind: 'regime-magma-ocean', windows: [{ tMin: 4.35e9, tMax: 4.52e9 }] },
  },
  {
    id: 'hadean-water-world-regime',
    label: 'Hadean water world',
    tMin: 4.0e9,
    tMax: 4.4e9,
    importance: 0.7,
    description: 'placeholder',
    citation: 'Wilde et al. 2001',
    effect: { kind: 'regime-water-world', windows: [{ tMin: 4.0e9, tMax: 4.4e9 }] },
  },
  {
    id: 'archean-haze-regime',
    label: 'Archean haze, scattered protocrust',
    tMin: 2.4e9,
    tMax: 4.0e9,
    importance: 0.6,
    description: 'placeholder',
    citation: 'Lyons et al. 2014',
    effect: { kind: 'regime-archean', windows: [{ tMin: 2.4e9, tMax: 4.0e9 }] },
  },
  {
    id: 'paleoproterozoic-glaciation-regime',
    label: 'Paleoproterozoic glaciation',
    tMin: 2.426e9,
    tMax: 2.46e9,
    importance: 0.5,
    description: 'placeholder',
    citation: 'Gumsley et al. 2017',
    effect: { kind: 'ice-shell', windows: [{ tMin: 2.426e9, tMax: 2.46e9 }] },
  },
  {
    id: 'proterozoic-unknown-geography-regime',
    label: 'Proterozoic, geography unknown',
    tMin: 1.0e9,
    tMax: 2.4e9,
    importance: 0.5,
    description: 'placeholder',
    citation: 'Merdith et al. 2021',
    effect: { kind: 'regime-unknown-geography', windows: [{ tMin: 1.0e9, tMax: 2.4e9 }] },
  },
]

/** The three `events-core` events that carry a G6-in-scope effect, matching
 *  `data/events.yaml` exactly. */
export const EFFECT_EVENTS: readonly TimelineEvent[] = [
  {
    id: 'moon-forming-impact',
    label: 'Moon-forming impact',
    tMin: 4.35e9,
    tMax: 4.52e9,
    importance: 0.9,
    description: 'placeholder',
    citation: 'Barboni et al. 2017',
    effect: { kind: 'giant-impact', windows: [{ tMin: 4.35e9, tMax: 4.52e9 }] },
  },
  {
    id: 'snowball-earth',
    label: 'Snowball Earth glaciations',
    tMin: 6.35e8,
    tMax: 7.2e8,
    importance: 0.85,
    description: 'placeholder',
    citation: 'Rooney et al. 2015',
    effect: {
      kind: 'ice-shell',
      windows: [
        { tMin: 6.61e8, tMax: 7.17e8 },
        { tMin: 6.35e8, tMax: 6.39e8 },
      ],
    },
  },
  {
    id: 'k-pg-impact',
    label: 'K-Pg impact',
    tMin: 6.6032e7,
    tMax: 6.6054e7,
    importance: 1.0,
    description: 'placeholder',
    citation: 'Renne et al. 2013',
    effect: {
      kind: 'impact-winter',
      anchor: { lat: 21.3, lon: -89.5 },
      windows: [{ tMin: 6.6032e7, tMax: 6.6054e7 }],
    },
  },
]
