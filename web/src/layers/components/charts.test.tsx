import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SeriesData } from '@/data/curated'
import { createLinearScale } from '@/timeline'
import { EARTH_FORMATION } from '@/types/layer'

import { createScalarLayer } from '../factories'
import { CO2_DATA, CO2_MANIFEST, POPULATION_DATA, POPULATION_MANIFEST } from '../fixtures'
import { LayerChart } from './LayerChart'
import { Sparkline } from './Sparkline'

afterEach(cleanup)

const FULL_SCALE = createLinearScale([0, EARTH_FORMATION])

describe('<Sparkline>', () => {
  it('renders without throwing across a domain narrower than the scale, and marks the playhead', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const { container } = render(<Sparkline layer={layer} t={1e8} scale={FULL_SCALE} />)
    expect(container.querySelector('svg')).not.toBeNull()
    // A playhead line is always drawn, even where the layer itself has no data at every
    // sampled point in view (the absent region is simply not traced by a <polyline>).
    expect(container.querySelector('line')).not.toBeNull()
  })

  it('plots a series spanning decades on a log axis, so the 277 -> 427 ppm rise stays visible', () => {
    const data: SeriesData = {
      id: 'co2',
      unit: 'ppm',
      interpolation: 'log-linear',
      samples: [
        { t: 0, value: 427, lower: null, upper: null },
        { t: 275, value: 277, lower: null, upper: null },
        { t: 5e8, value: 7000, lower: null, upper: null },
      ],
    }
    const layer = createScalarLayer(CO2_MANIFEST, data)
    const dotY = (t: number): number => {
      const { container } = render(<Sparkline layer={layer} t={t} scale={FULL_SCALE} />)
      const cy = Number(container.querySelector('circle')?.getAttribute('cy'))
      cleanup()
      return cy
    }
    // The drawable height is 30 viewBox units. A linear axis up to 7,000 ppm separates these
    // two dots by under 1 unit; the log axis separates them by several.
    expect(dotY(275) - dotY(0)).toBeGreaterThan(2)
  })

  it('breaks the line across a declared gap rather than bridging it (ADR-027)', () => {
    const data: SeriesData = {
      id: 'co2',
      unit: 'ppm',
      interpolation: 'log-linear',
      samples: [
        { t: 0, value: 420, lower: null, upper: null },
        { t: 1e9, value: 400, lower: null, upper: null },
        { t: 2e9, value: 300, lower: null, upper: null },
        { t: EARTH_FORMATION, value: 4000, lower: null, upper: null },
      ],
      gaps: [{ fromIndex: 1, toIndex: 2 }],
    }
    const layer = createScalarLayer(CO2_MANIFEST, data)
    const { container } = render(<Sparkline layer={layer} t={0} scale={FULL_SCALE} />)
    // Fully covered domain, no gap: one continuous <polyline>. The 1e9-2e9 gap splits it in two.
    expect(container.querySelectorAll('polyline').length).toBe(2)
  })

  // Sampling directly against the *passed* `scale`'s own domain (here, `FULL_SCALE`, spanning all
  // 4.6 Gyr) would starve a narrow-domain layer: population's real 12,015-year domain is under 6%
  // of that span. `Sparkline` windows sampling to `layer.timeDomain` instead (see its own doc
  // comment) — these tests assert the drawn trace actually reflects that, not just that
  // `scale.domain` is technically wider than the layer's.
  function points(container: HTMLElement): string {
    return container.querySelector('polyline')?.getAttribute('points') ?? ''
  }
  function pointCount(container: HTMLElement): number {
    const raw = points(container).trim()
    return raw === '' ? 0 : raw.split(' ').length
  }
  function firstX(container: HTMLElement): number {
    return Number(points(container).split(' ')[0]?.split(',')[0])
  }
  function lastX(container: HTMLElement): number {
    const parts = points(container).trim().split(' ')
    return Number(parts[parts.length - 1]?.split(',')[0])
  }

  it("windows sampling to the layer's own domain, not the much wider scale passed in", () => {
    const layer = createScalarLayer(POPULATION_MANIFEST, POPULATION_DATA)
    // FULL_SCALE spans the whole 4.6 Gyr domain — population's own domain is a sliver of it.
    // t=10 is population's own newest sample, so the whole trace has been "reached" (below) —
    // isolates domain-windowing from the growth-over-time behaviour those tests cover instead.
    const { container } = render(<Sparkline layer={layer} t={10} scale={FULL_SCALE} />)
    // Before the fix this was ~5 of 97 samples, all bunched in the last few view-box units.
    expect(pointCount(container)).toBeGreaterThan(80)
    // The trace should span close to the sparkline's own full width (PAD=3, VIEW_WIDTH=200),
    // not a sliver pinned to one edge.
    expect(firstX(container)).toBeLessThan(10)
    expect(lastX(container)).toBeGreaterThan(190)
  })

  it("still shows CO2's trace across its own real published domain (570 Myr), not the full 4.6 Gyr one", () => {
    // Unlike the fixture manifest (which defaults to the full domain), the real published CO2
    // layer's own timeDomain is [0, 5.7e8] — 84% of FULL_SCALE's own warped width, not all of it.
    // t=0 is CO2's own newest edge (present), so the whole trace has been "reached".
    const realCo2Manifest = { ...CO2_MANIFEST, timeDomain: [0, 5.7e8] as [number, number] }
    const layer = createScalarLayer(realCo2Manifest, CO2_DATA)
    const { container } = render(<Sparkline layer={layer} t={0} scale={FULL_SCALE} />)
    expect(firstX(container)).toBeLessThan(10)
    expect(lastX(container)).toBeGreaterThan(190)
  })

  it('clamps the playhead to the domain edge when `t` sits outside it, rather than off-screen', () => {
    const layer = createScalarLayer(POPULATION_MANIFEST, POPULATION_DATA)
    // Deep in the Precambrian — nowhere near population's [10, 12025] domain.
    const { container } = render(<Sparkline layer={layer} t={1e9} scale={FULL_SCALE} />)
    const playhead = container.querySelector('line')
    // PAD=3: the near edge of the plot, not clamped to some arbitrary interior position.
    expect(Number(playhead?.getAttribute('x1'))).toBeCloseTo(3, 0)
  })

  // A sparkline must never draw before `t` reaches it: these tests assert the trace is
  // `t`-driven, mirroring the globe's arrival arcs/city markers (never rendered before their own
  // moment) — a reveal driven by `t`, not a fade on inactivity, so it doesn't conflict with the
  // project's "nothing hides on inactivity" rule.
  it('draws nothing at all — no trace, no dot — when `t` is older than the whole domain (the "no data" case)', () => {
    const layer = createScalarLayer(POPULATION_MANIFEST, POPULATION_DATA)
    // Older than population's own oldest domain edge (12,025) — nothing has happened yet.
    const { container } = render(<Sparkline layer={layer} t={20_000} scale={FULL_SCALE} />)
    expect(container.querySelectorAll('polyline').length).toBe(0)
    expect(container.querySelector('circle')).toBeNull()
    // The bare "you are here" playhead line is kept — see Sparkline.tsx's own doc comment.
    expect(container.querySelector('line')).not.toBeNull()
  })

  it('draws only the reached portion at an intermediate `t`, growing toward the present', () => {
    const layer = createScalarLayer(POPULATION_MANIFEST, POPULATION_DATA)
    const widthAt = (t: number): number => {
      const { container } = render(<Sparkline layer={layer} t={t} scale={FULL_SCALE} />)
      const w = lastX(container) - firstX(container)
      cleanup()
      return w
    }
    const early = widthAt(11_000) // deep in the domain, little reached
    const mid = widthAt(5_000)
    const late = widthAt(10) // population's own newest sample — fully reached
    expect(early).toBeGreaterThan(0)
    // Monotonically longer as `t` moves toward the present — a full trace at every `t` (i.e. no
    // `t`-driven growth) would make early/mid/late all read as the same, already-maximal width.
    expect(mid).toBeGreaterThan(early)
    expect(late).toBeGreaterThan(mid)
  })

  it("never traces past the playhead's own position", () => {
    const layer = createScalarLayer(POPULATION_MANIFEST, POPULATION_DATA)
    const { container } = render(<Sparkline layer={layer} t={5_000} scale={FULL_SCALE} />)
    const playheadX = Number(container.querySelector('line')?.getAttribute('x1'))
    expect(lastX(container)).toBeLessThanOrEqual(playheadX + 0.01)
  })
})

describe('<LayerChart>', () => {
  it('renders the plot with its uncertainty band straight away — no second toggle', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    // t=0 (present, CO2's own newest edge): the whole series has been "reached" (below), so
    // nothing here is split into a ghost — isolates band rendering from the reached/future
    // split those tests cover instead.
    const { container } = render(<LayerChart layer={layer} t={0} scale={FULL_SCALE} onClose={() => {}} />)
    expect(container.querySelector('svg')).not.toBeNull()
    // One area wash per traced segment; any polygon beyond those is the uncertainty band.
    expect(container.querySelectorAll('polygon').length).toBeGreaterThan(container.querySelectorAll('polyline').length)
  })

  it('closes through its own close button', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const onClose = vi.fn()
    const { getByRole } = render(<LayerChart layer={layer} t={1e8} scale={FULL_SCALE} onClose={onClose} />)
    fireEvent.click(getByRole('button', { name: `Close ${CO2_MANIFEST.name} chart` }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape while mounted', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const onClose = vi.fn()
    render(<LayerChart layer={layer} t={1e8} scale={FULL_SCALE} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stops listening for Escape once unmounted', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const onClose = vi.fn()
    const { unmount } = render(<LayerChart layer={layer} t={1e8} scale={FULL_SCALE} onClose={onClose} />)
    unmount()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ignores keys other than Escape', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const onClose = vi.fn()
    render(<LayerChart layer={layer} t={1e8} scale={FULL_SCALE} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows "no data" in the header when the playhead sits outside the layer domain', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    // Beyond CO2_MANIFEST.timeDomain's own upper bound (EARTH_FORMATION), not merely CO2_DATA's
    // narrower sample range — the "no record" case below covers that one instead.
    const { container } = render(
      <LayerChart layer={layer} t={EARTH_FORMATION + 1} scale={FULL_SCALE} onClose={() => {}} />,
    )
    expect(container.textContent).toMatch(/no data/)
  })

  it('shows "no record" — not "no data" — in the header inside a declared gap (ADR-027)', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const { container } = render(<LayerChart layer={layer} t={3.2e6} scale={FULL_SCALE} onClose={() => {}} />)
    expect(container.textContent).toMatch(/no record/)
    expect(container.textContent).not.toMatch(/no data/)
  })

  // A chart opened to inspect data shouldn't simply hide the future (unreadable at an early `t`,
  // axis jumping around): the not-yet-reached portion instead draws as a faint, fill-less
  // "ghost" (`chartLineGhost`) alongside the full-weight reached portion, and a genuine gap
  // (ADR-027) must still read as a real break, never as (or adjacent-looking to) the ghost.
  it('draws the not-yet-reached portion as a ghost line, distinct from the full-weight reached one', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    // Mid-domain: plenty reached (older than 1e8) and plenty not yet reached (newer than 1e8).
    const { container } = render(<LayerChart layer={layer} t={1e8} scale={FULL_SCALE} onClose={() => {}} />)
    const solid = Array.from(container.querySelectorAll('polyline')).filter((el) => !el.getAttribute('class')?.includes('Ghost'))
    const ghost = Array.from(container.querySelectorAll('polyline')).filter((el) => el.getAttribute('class')?.includes('Ghost'))
    expect(solid.length).toBeGreaterThan(0)
    expect(ghost.length).toBeGreaterThan(0)
  })

  it('draws nothing but ghost — no area, no band — once every point is in the future', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    // Older than CO2_MANIFEST's own oldest domain edge (EARTH_FORMATION) would read "no data";
    // instead pick a `t` just barely older than every sample (but still inside the manifest's
    // full domain) so every point is future and the header still reads a real "no record"/value
    // rather than "no data" muddying the assertion.
    const { container } = render(<LayerChart layer={layer} t={5.7e8 + 1} scale={FULL_SCALE} onClose={() => {}} />)
    const solid = Array.from(container.querySelectorAll('polyline')).filter((el) => !el.getAttribute('class')?.includes('Ghost'))
    const ghost = Array.from(container.querySelectorAll('polyline')).filter((el) => el.getAttribute('class')?.includes('Ghost'))
    expect(solid.length).toBe(0)
    expect(ghost.length).toBeGreaterThan(0)
    // No area wash, no band — see this file's own JSX comment: neither ever pairs with a ghost.
    expect(container.querySelectorAll('polygon').length).toBe(0)
  })

  it('keeps a real declared gap (ADR-027) a true break, never bridged by the ghost', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    // CO2_DATA's own gap sits between t=805,743.87 and t=1e7. t=3.2e6 (inside the gap) means
    // everything from the gap's own far edge (1e7) to EARTH_FORMATION is still unreached — so a
    // ghost should trace that unreached remainder, but never across the gap itself.
    const { container } = render(<LayerChart layer={layer} t={3.2e6} scale={FULL_SCALE} onClose={() => {}} />)
    const ghost = Array.from(container.querySelectorAll('polyline')).filter((el) => el.getAttribute('class')?.includes('Ghost'))
    // One ghost run (the far side of the gap) — not bridged into the near side across the gap.
    expect(ghost.length).toBe(1)
    const points = ghost[0]!.getAttribute('points')!.trim().split(' ')
    const firstX = Number(points[0]!.split(',')[0])
    // The gap's own far edge sits well short of the plot's own left pad (PAD_X=0, VIEW_WIDTH=600)
    // — a ghost starting at x=0 would mean it wrongly reached all the way back across the gap.
    expect(firstX).toBeGreaterThan(0)
  })

  it("keeps the axis stable across `t` — the printed min/max don't move as the reveal grows", () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const early = render(<LayerChart layer={layer} t={5.7e8} scale={FULL_SCALE} onClose={() => {}} />)
    const earlyText = early.container.textContent
    cleanup()
    const late = render(<LayerChart layer={layer} t={0} scale={FULL_SCALE} onClose={() => {}} />)
    const lateText = late.container.textContent
    // Both header/axis labels are present in textContent; the axis figures (not the "current
    // value" line, which does change) should read identically at both ends of the reveal.
    const axisFigures = (text: string | null): string[] =>
      (text ?? '').match(/[\d.]+ (ppm|people|°C|m)/g) ?? []
    // The playhead's own current-value figure differs between the two `t`s, but the axis
    // min/max (the last two matches) must not.
    const earlyAxis = axisFigures(earlyText).slice(-2)
    const lateAxis = axisFigures(lateText).slice(-2)
    expect(earlyAxis).toEqual(lateAxis)
    expect(earlyAxis.length).toBe(2)
  })

  it('plots a wide-range series (population, ~1,600x) on a log axis, labelled so the shape is never misread', () => {
    const layer = createScalarLayer(POPULATION_MANIFEST, POPULATION_DATA)
    const populationScale = createLinearScale(POPULATION_MANIFEST.timeDomain)
    const { container, getByRole } = render(
      <LayerChart layer={layer} t={2025} scale={populationScale} onClose={() => {}} />,
    )
    expect(container.textContent).toMatch(/log scale/)
    expect(getByRole('img', { name: /log scale/ })).not.toBeNull()
  })

  it('plots a narrow-range series (a flat, near-constant temperature) on a linear axis, unlabelled', () => {
    const flatData: SeriesData = {
      id: 'temperature',
      unit: '°C',
      interpolation: 'linear',
      samples: [
        { t: 0, value: 14.9, lower: null, upper: null },
        { t: 1e6, value: 15.1, lower: null, upper: null },
      ],
    }
    const layer = createScalarLayer({ ...CO2_MANIFEST, id: 'temperature', unit: '°C' }, flatData)
    const { container } = render(<LayerChart layer={layer} t={0} scale={FULL_SCALE} onClose={() => {}} />)
    expect(container.textContent).not.toMatch(/log scale/)
  })

  it("keeps the printed axis min/max in raw units even on a log axis — never log(value)", () => {
    const layer = createScalarLayer(POPULATION_MANIFEST, POPULATION_DATA)
    const populationScale = createLinearScale(POPULATION_MANIFEST.timeDomain)
    const { container } = render(<LayerChart layer={layer} t={10} scale={populationScale} onClose={() => {}} />)
    // POPULATION_DATA's real max, formatted the same way ScalarReadout formats it.
    expect(container.textContent).toMatch(/7\.3 billion/)
  })

  // The curve (240-sample resample, segments, axis) is a pure function of `layer`/`scale`, not
  // `t` — only the playhead value and the reached/future split depend on it. A render that only
  // moves `t` must not redo the resample: this is what an unmemoised regression would break.
  it('does not re-sample the layer when only `t` changes', () => {
    const base = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const sample = vi.fn(base.sample)
    const layer = { ...base, sample }
    const { rerender } = render(<LayerChart layer={layer} t={1e8} scale={FULL_SCALE} onClose={() => {}} />)
    const afterMount = sample.mock.calls.length
    sample.mockClear()
    rerender(<LayerChart layer={layer} t={2e8} scale={FULL_SCALE} onClose={() => {}} />)
    // Only the playhead's own `layer.sample(t)` call — never another full resample.
    expect(sample.mock.calls.length).toBe(1)
    expect(sample.mock.calls[0]?.[0]).toBe(2e8)
    expect(afterMount).toBeGreaterThan(1)
  })
})
