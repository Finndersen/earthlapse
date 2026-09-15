/**
 * Era sections (ADR-024): a fixed tree of named stretches of time the timeline can be narrowed
 * to. Picking one gives the timeline a bounded window with more resolution; there is still no
 * free zoom (ADR-021).
 *
 * Earth → the six eons/eras → ICS periods (only where subdividing helps) →
 * Quaternary → Pleistocene/Holocene → six human-history sections inside the Holocene.
 *
 * Geological boundaries are the base ages printed on the International Commission on
 * Stratigraphy's International Chronostratigraphic Chart, v2024/12 (Cohen, K.M., Finney, S.C.,
 * Gibbard, P.L. & Fan, J.-X. (2013; updated) The ICS International Chronostratigraphic Chart.
 * Episodes 36: 199-204; https://stratigraphy.org/ICSchart/ChronostratChart2024-12.pdf).
 * Historical boundaries are calendar years converted with the same fixed reference year the
 * curated event set uses (`t = 2025 - CE_year`, data/events.yaml), each with its own citation.
 *
 * A boundary age is the *base* of the younger unit (the stratigraphic convention: 66.0 Ma is
 * where the Cenozoic starts), so `sectionAt` gives a shared boundary to the younger section.
 *
 * > **Follow-up pass item 7 (ADR-024 amendment).** Each section also carries a short
 * > `abbreviation`, drawn by `SectionBands` in place of `label` when a band is too narrow for
 * > the full name — never blank, and never below `sectionLayout.ts`'s own width floor, which is
 * > sized to fit at least the abbreviation.
 */

import { EARTH_FORMATION, type GeoTime } from '@/types/layer'

import { SYMLOG_C, symlogKnee, type TimeWindow } from './scale'

const GA = 1e9
const MA = 1e6

/** `t = PRESENT_CE_YEAR - CE_year` — data/events.yaml's own fixed reference year. */
const PRESENT_CE_YEAR = 2025

function yearsBeforePresent(ceYear: number): GeoTime {
  return PRESENT_CE_YEAR - ceYear
}

const ICS_CHART =
  'International Commission on Stratigraphy, International Chronostratigraphic Chart v2024/12 ' +
  '(https://stratigraphy.org/ICSchart/ChronostratChart2024-12.pdf)'

// Base ages, ICS v2024/12, oldest first.
const ARCHEAN_BASE = 4031 * MA
const PROTEROZOIC_BASE = 2.5 * GA
const MESOPROTEROZOIC_BASE = 1.6 * GA
const NEOPROTEROZOIC_BASE = 1.0 * GA
const CRYOGENIAN_BASE = 720 * MA
const EDIACARAN_BASE = 635 * MA
const PHANEROZOIC_BASE = 538.8 * MA
const ORDOVICIAN_BASE = 486.85 * MA
const SILURIAN_BASE = 443.1 * MA
const DEVONIAN_BASE = 419.62 * MA
const CARBONIFEROUS_BASE = 358.86 * MA
const PERMIAN_BASE = 298.9 * MA
const MESOZOIC_BASE = 251.902 * MA
const JURASSIC_BASE = 201.4 * MA
const CRETACEOUS_BASE = 143.1 * MA
const CENOZOIC_BASE = 66.0 * MA
const NEOGENE_BASE = 23.04 * MA
const QUATERNARY_BASE = 2.58 * MA
/** The chart gives the Holocene base as 11,700 years before AD 2000 (b2k); shifted onto this
 *  package's AD 2025 present. */
const HOLOCENE_BASE = 11_700 + (PRESENT_CE_YEAR - 2000)

const WRITING_BASE = yearsBeforePresent(-3200)
const MEDIEVAL_BASE = yearsBeforePresent(500)
const EARLY_MODERN_BASE = yearsBeforePresent(1500)
const INDUSTRIAL_BASE = yearsBeforePresent(1760)
const MODERN_BASE = yearsBeforePresent(1914)

interface SectionDefinition {
  label: string
  /** Short form for a band too narrow to set `label` in full (follow-up pass item 7). Always
   *  legible on its own (never mid-word-truncated to the point of being cryptic) and never
   *  longer than `label`. The band's title and accessible name always carry the full `label`
   *  regardless of which form is drawn — see `sectionLayout.ts`'s doc comment. */
  abbreviation: string
  parentId: string | null
  /** [newest, oldest] years BP, the same orientation as `TimeWindow`. */
  window: TimeWindow
  citation: string
}

const SECTION_DEFINITIONS = {
  earth: { label: 'Earth', abbreviation: 'Earth', parentId: null, window: [0, EARTH_FORMATION], citation: ICS_CHART },

  hadean: { label: 'Hadean', abbreviation: 'Hadean', parentId: 'earth', window: [ARCHEAN_BASE, EARTH_FORMATION], citation: ICS_CHART },
  archean: { label: 'Archean', abbreviation: 'Archean', parentId: 'earth', window: [PROTEROZOIC_BASE, ARCHEAN_BASE], citation: ICS_CHART },
  proterozoic: {
    label: 'Proterozoic',
    abbreviation: 'Proteroz.',
    parentId: 'earth',
    window: [PHANEROZOIC_BASE, PROTEROZOIC_BASE],
    citation: ICS_CHART,
  },
  paleozoic: { label: 'Paleozoic', abbreviation: 'Paleozoic', parentId: 'earth', window: [MESOZOIC_BASE, PHANEROZOIC_BASE], citation: ICS_CHART },
  mesozoic: { label: 'Mesozoic', abbreviation: 'Mesozoic', parentId: 'earth', window: [CENOZOIC_BASE, MESOZOIC_BASE], citation: ICS_CHART },
  cenozoic: { label: 'Cenozoic', abbreviation: 'Cenozoic', parentId: 'earth', window: [0, CENOZOIC_BASE], citation: ICS_CHART },

  paleoproterozoic: {
    label: 'Paleoproterozoic',
    abbreviation: 'Paleoprot.',
    parentId: 'proterozoic',
    window: [MESOPROTEROZOIC_BASE, PROTEROZOIC_BASE],
    citation: ICS_CHART,
  },
  mesoproterozoic: {
    label: 'Mesoproterozoic',
    abbreviation: 'Mesoprot.',
    parentId: 'proterozoic',
    window: [NEOPROTEROZOIC_BASE, MESOPROTEROZOIC_BASE],
    citation: ICS_CHART,
  },
  neoproterozoic: {
    label: 'Neoproterozoic',
    abbreviation: 'Neoprot.',
    parentId: 'proterozoic',
    window: [PHANEROZOIC_BASE, NEOPROTEROZOIC_BASE],
    citation: ICS_CHART,
  },

  tonian: {
    label: 'Tonian',
    abbreviation: 'Tonian',
    parentId: 'neoproterozoic',
    window: [CRYOGENIAN_BASE, NEOPROTEROZOIC_BASE],
    citation: ICS_CHART,
  },
  cryogenian: {
    label: 'Cryogenian',
    abbreviation: 'Cryogen.',
    parentId: 'neoproterozoic',
    window: [EDIACARAN_BASE, CRYOGENIAN_BASE],
    citation: ICS_CHART,
  },
  ediacaran: {
    label: 'Ediacaran',
    abbreviation: 'Ediacaran',
    parentId: 'neoproterozoic',
    window: [PHANEROZOIC_BASE, EDIACARAN_BASE],
    citation: ICS_CHART,
  },

  cambrian: { label: 'Cambrian', abbreviation: 'Cambrian', parentId: 'paleozoic', window: [ORDOVICIAN_BASE, PHANEROZOIC_BASE], citation: ICS_CHART },
  ordovician: {
    label: 'Ordovician',
    abbreviation: 'Ordovic.',
    parentId: 'paleozoic',
    window: [SILURIAN_BASE, ORDOVICIAN_BASE],
    citation: ICS_CHART,
  },
  silurian: { label: 'Silurian', abbreviation: 'Silurian', parentId: 'paleozoic', window: [DEVONIAN_BASE, SILURIAN_BASE], citation: ICS_CHART },
  devonian: { label: 'Devonian', abbreviation: 'Devonian', parentId: 'paleozoic', window: [CARBONIFEROUS_BASE, DEVONIAN_BASE], citation: ICS_CHART },
  carboniferous: {
    label: 'Carboniferous',
    abbreviation: 'Carbonif.',
    parentId: 'paleozoic',
    window: [PERMIAN_BASE, CARBONIFEROUS_BASE],
    citation: ICS_CHART,
  },
  permian: { label: 'Permian', abbreviation: 'Permian', parentId: 'paleozoic', window: [MESOZOIC_BASE, PERMIAN_BASE], citation: ICS_CHART },

  triassic: { label: 'Triassic', abbreviation: 'Triassic', parentId: 'mesozoic', window: [JURASSIC_BASE, MESOZOIC_BASE], citation: ICS_CHART },
  jurassic: { label: 'Jurassic', abbreviation: 'Jurassic', parentId: 'mesozoic', window: [CRETACEOUS_BASE, JURASSIC_BASE], citation: ICS_CHART },
  cretaceous: {
    label: 'Cretaceous',
    abbreviation: 'Cretac.',
    parentId: 'mesozoic',
    window: [CENOZOIC_BASE, CRETACEOUS_BASE],
    citation: ICS_CHART,
  },

  paleogene: { label: 'Paleogene', abbreviation: 'Paleogene', parentId: 'cenozoic', window: [NEOGENE_BASE, CENOZOIC_BASE], citation: ICS_CHART },
  neogene: { label: 'Neogene', abbreviation: 'Neogene', parentId: 'cenozoic', window: [QUATERNARY_BASE, NEOGENE_BASE], citation: ICS_CHART },
  quaternary: { label: 'Quaternary', abbreviation: 'Quatern.', parentId: 'cenozoic', window: [0, QUATERNARY_BASE], citation: ICS_CHART },

  pleistocene: {
    label: 'Pleistocene',
    abbreviation: 'Pleistoc.',
    parentId: 'quaternary',
    window: [HOLOCENE_BASE, QUATERNARY_BASE],
    citation: ICS_CHART,
  },
  holocene: { label: 'Holocene', abbreviation: 'Holocene', parentId: 'quaternary', window: [0, HOLOCENE_BASE], citation: ICS_CHART },

  'first-farmers': {
    label: 'First farmers',
    abbreviation: 'Farmers',
    parentId: 'holocene',
    window: [WRITING_BASE, HOLOCENE_BASE],
    citation:
      'Opens with the Holocene (ICS v2024/12); cultivation and herding begin in the Fertile Crescent in the ' +
      'early Holocene — Zeder, M.A. (2011) The Origins of Agriculture in the Near East. Current Anthropology ' +
      '52(S4): S221-S235.',
  },
  'ancient-civilisations': {
    label: 'Ancient civilisations',
    abbreviation: 'Ancient',
    parentId: 'holocene',
    window: [MEDIEVAL_BASE, WRITING_BASE],
    citation:
      'c. 3200 BCE: the first writing (proto-cuneiform at Uruk, early Egyptian hieroglyphs) — Woods, C. (ed.) ' +
      '(2010) Visible Language: Inventions of Writing in the Ancient Middle East and Beyond. Oriental ' +
      'Institute Museum Publications 32.',
  },
  'medieval-world': {
    label: 'Medieval world',
    abbreviation: 'Medieval',
    parentId: 'holocene',
    window: [EARLY_MODERN_BASE, MEDIEVAL_BASE],
    citation:
      'AD 500, the conventional close of antiquity after the end of the Western Roman Empire (476) — ' +
      'Wickham, C. (2009) The Inheritance of Rome: A History of Europe from 400 to 1000. Allen Lane.',
  },
  'early-modern': {
    label: 'Early modern',
    abbreviation: 'Early mod.',
    parentId: 'holocene',
    window: [INDUSTRIAL_BASE, EARLY_MODERN_BASE],
    citation:
      'AD 1500, the conventional start of the early modern period (print, the 1492 Atlantic crossing) — ' +
      'Cameron, E. (ed.) (2001) Early Modern Europe: An Oxford History. Oxford University Press.',
  },
  'industrial-age': {
    label: 'Industrial age',
    abbreviation: 'Industrial',
    parentId: 'holocene',
    window: [MODERN_BASE, INDUSTRIAL_BASE],
    citation:
      'AD 1760, the onset of the Industrial Revolution — Ashton, T.S. (1948) The Industrial Revolution ' +
      '1760-1830. Oxford University Press.',
  },
  modern: {
    label: 'Modern',
    abbreviation: 'Modern',
    parentId: 'holocene',
    window: [0, MODERN_BASE],
    citation:
      'AD 1914, the outbreak of the First World War closing the "long nineteenth century" — Hobsbawm, E. ' +
      '(1994) Age of Extremes: The Short Twentieth Century, 1914-1991. Michael Joseph.',
  },
} as const satisfies Record<string, SectionDefinition>

export type SectionId = keyof typeof SECTION_DEFINITIONS

export const ROOT_SECTION_ID: SectionId = 'earth'

export interface TimelineSection {
  id: SectionId
  label: string
  abbreviation: string
  parentId: SectionId | null
  window: TimeWindow
  citation: string
}

function buildSections(): ReadonlyMap<SectionId, TimelineSection> {
  const sections = new Map<SectionId, TimelineSection>()
  for (const [id, definition] of Object.entries(SECTION_DEFINITIONS) as [SectionId, SectionDefinition][]) {
    sections.set(id, {
      id,
      label: definition.label,
      abbreviation: definition.abbreviation,
      parentId: definition.parentId as SectionId | null,
      window: definition.window,
      citation: definition.citation,
    })
  }
  return sections
}

const SECTIONS = buildSections()

/** Children per parent, oldest first (screen left to right). */
function buildChildren(): ReadonlyMap<SectionId, readonly TimelineSection[]> {
  const children = new Map<SectionId, TimelineSection[]>()
  for (const section of SECTIONS.values()) {
    if (section.parentId === null) continue
    const siblings = children.get(section.parentId) ?? []
    siblings.push(section)
    children.set(section.parentId, siblings)
  }
  for (const siblings of children.values()) siblings.sort((a, b) => b.window[1] - a.window[1])
  return children
}

const CHILDREN = buildChildren()

/**
 * Throws unless every parent's children tile its window exactly, oldest to newest, with no gap
 * or overlap. Checked once at module load so a mistyped boundary fails at startup instead of
 * leaving a stretch of time that no section covers.
 */
function assertChildrenTileParents(): void {
  for (const [parentId, children] of CHILDREN) {
    const parent = SECTIONS.get(parentId)!
    let expectedOldest = parent.window[1]
    for (const child of children) {
      if (child.window[1] !== expectedOldest || child.window[0] >= child.window[1]) {
        throw new Error(`sections: '${child.id}' does not continue '${parentId}' contiguously at ${expectedOldest}`)
      }
      expectedOldest = child.window[0]
    }
    if (expectedOldest !== parent.window[0]) {
      throw new Error(`sections: children of '${parentId}' stop at ${expectedOldest}, not ${parent.window[0]}`)
    }
  }
}

assertChildrenTileParents()

export function sectionById(id: SectionId): TimelineSection {
  const section = SECTIONS.get(id)
  if (section === undefined) throw new Error(`sectionById: unknown section '${id}'`)
  return section
}

export function childSections(id: SectionId): readonly TimelineSection[] {
  return CHILDREN.get(id) ?? []
}

/**
 * The symlog knee `section`'s own window should be drawn with (ADR-024 amendment, re-review
 * fix 2026-09-15). `scale.ts`'s `symlogKnee(window)` shrinks the knee for any window narrower
 * than its threshold, purely from the window's own span — reasonable for a section that *has*
 * children (the whole point is giving whichever child sits nearest the present edge room, the
 * same way `SYMLOG_C` itself gives the Holocene room against the full 4.6 Gyr domain), but wrong
 * for a **leaf** section: there is nothing below it to make room for, so the same formula only
 * over-compresses the leaf's own display. A concrete case that motivated this: "Modern" (the
 * Holocene's own 0-111-year leaf) shrinks to `MIN_SYMLOG_KNEE` under the bare formula, and the
 * last 10 years alone then draw over half the track — steady-mode pacing (which paces off
 * exactly this knee, `advanceSteadyPlayhead`) spends the same lopsided share of wall-clock time
 * there. A leaf instead draws with the fixed `SYMLOG_C`, which — for a span already far under
 * 10,000 years, as every leaf here is — reads close to true-proportional across the whole
 * window, matching how a short, undivided stretch of time ought to look. Every non-leaf section
 * (the full domain down through the Neogene, then Quaternary, Holocene and each of its still-
 * subdivided ancestors) is unaffected: this returns exactly `symlogKnee(section.window)`, the
 * same value the amendment introduced, for any section with at least one child.
 */
export function sectionSymlogKnee(id: SectionId): GeoTime {
  const section = sectionById(id)
  return childSections(id).length === 0 ? SYMLOG_C : symlogKnee(section.window)
}

export function parentSection(id: SectionId): TimelineSection | undefined {
  const { parentId } = sectionById(id)
  return parentId === null ? undefined : sectionById(parentId)
}

/** Root first, `id` last — the breadcrumb. */
export function sectionPath(id: SectionId): readonly TimelineSection[] {
  const path: TimelineSection[] = []
  for (let section: TimelineSection | undefined = sectionById(id); section; section = parentSection(section.id)) {
    path.unshift(section)
  }
  return path
}

/** Inclusive at both edges: a playhead resting on a boundary belongs to either neighbour. */
export function sectionContains(section: TimelineSection, t: GeoTime): boolean {
  return t >= section.window[0] && t <= section.window[1]
}

/** The child of `id` containing `t`, with a shared boundary going to the younger child (the
 *  boundary is its base), or `undefined` for a leaf or a `t` outside `id`. */
export function childSectionAt(id: SectionId, t: GeoTime): TimelineSection | undefined {
  const children = childSections(id)
  for (let i = children.length - 1; i >= 0; i--) {
    if (sectionContains(children[i]!, t)) return children[i]
  }
  return undefined
}

/** The deepest section containing `t` at most `depth` levels below the root (0 is the root
 *  itself). Stops early at a leaf. */
export function sectionAt(t: GeoTime, depth: number): TimelineSection {
  const root = sectionById(ROOT_SECTION_ID)
  if (!sectionContains(root, t)) {
    throw new Error(`sectionAt: t=${t} is outside [0, ${EARTH_FORMATION}]`)
  }
  let section = root
  for (let level = 0; level < depth; level++) {
    const child = childSectionAt(section.id, t)
    if (child === undefined) break
    section = child
  }
  return section
}

/** The sibling immediately younger than `id` (to its right), if any. */
export function nextSibling(id: SectionId): TimelineSection | undefined {
  const { parentId } = sectionById(id)
  if (parentId === null) return undefined
  const siblings = childSections(parentId)
  const index = siblings.findIndex((s) => s.id === id)
  return siblings[index + 1]
}

/** The sibling immediately older than `id` (to its left), if any. */
export function previousSibling(id: SectionId): TimelineSection | undefined {
  const { parentId } = sectionById(id)
  if (parentId === null) return undefined
  const siblings = childSections(parentId)
  const index = siblings.findIndex((s) => s.id === id)
  return index > 0 ? siblings[index - 1] : undefined
}

/** Climbs from `id` up through its ancestors, returning the first `sibling(...)` any of them
 *  has — the shared shape of "the next thing to move to" both `continuationSection` (always
 *  `nextSibling`) and `previousSiblingStep` (always `previousSibling`) use. */
function climbToSibling(id: SectionId, sibling: (id: SectionId) => TimelineSection | undefined): TimelineSection | undefined {
  for (let section: TimelineSection | undefined = sectionById(id); section; section = parentSection(section.id)) {
    const found = sibling(section.id)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Where playback goes after running off the younger edge of `id`: the next sibling or, if `id`
 * is the last child, its parent's next sibling, and so on up the tree. The Permian leads to the
 * Mesozoic, not the Triassic. `undefined` only for a section whose younger edge is the present.
 * Also what the "next section" keyboard shortcut and breadcrumb button reach (follow-up pass
 * item 6) — one rule serves both, since a viewer moving forward by hand expects the same
 * destination playback would carry them to.
 */
export function continuationSection(id: SectionId): TimelineSection | undefined {
  return climbToSibling(id, nextSibling)
}

/**
 * The mirror image of `continuationSection`, for the "previous section" keyboard shortcut
 * (PageUp / Shift+←) and its breadcrumb button (follow-up pass item 6): the previous sibling,
 * or, if `id` is the first child, its parent's previous sibling, climbing the tree until one is
 * found. `undefined` only when `id` sits in the very first branch of the tree at every level
 * (the Hadean, and nowhere else) — there is nothing older to step back to.
 */
export function previousSiblingStep(id: SectionId): TimelineSection | undefined {
  return climbToSibling(id, previousSibling)
}

/**
 * The section to show once `t` has moved, starting from `currentId`. It stays put while `t` is
 * still inside (edges included, so scrubbing onto an edge never switches). Otherwise it climbs
 * from `currentId` and returns the first sibling at any level that contains `t`. Playback
 * running off the end of the last child moves up to the parent's next sibling. A jump elsewhere
 * (an event card, say) keeps the viewer at the deepest level that still makes sense. The root
 * contains every valid `t`, so this always finds a section.
 */
export function sectionFollowingT(currentId: SectionId, t: GeoTime): SectionId {
  let section = sectionById(currentId)
  if (sectionContains(section, t)) return currentId
  for (let parent = parentSection(section.id); parent; parent = parentSection(section.id)) {
    const containing = childSectionAt(parent.id, t)
    if (containing !== undefined) return containing.id
    section = parent
  }
  if (!sectionContains(section, t)) {
    throw new Error(`sectionFollowingT: t=${t} is outside [0, ${EARTH_FORMATION}]`)
  }
  return section.id
}

/** The eon/era name under the shell's large time readout: the top-level section containing
 *  `t`. */
export function eraNameForTime(t: GeoTime): string {
  return sectionAt(t, 1).label
}

/** `t` after selecting `id`: kept if it is already inside, otherwise the section's start (its
 *  oldest edge), since playback runs oldest to newest. */
export function sectionEntryT(id: SectionId, t: GeoTime): GeoTime {
  const section = sectionById(id)
  return sectionContains(section, t) ? t : section.window[1]
}
