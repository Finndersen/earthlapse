'use client'

/**
 * One name per active empire lineage (ADR-059), expanded view only. Each presented frame's labels
 * come from `drawnEmpireLabels` (largest member, ranked by area, capped; a label that would overlap
 * a larger one moves a row above or below its anchor, and is dropped only if both rows collide), and
 * fade with the same presented crossfade the territory texture
 * uses: the outgoing frame's labels at `1 - mix`, the incoming frame's at `mix`. A label shared by
 * both frames (same lineage and text) holds steady through the crossfade at the incoming anchor,
 * so a lineage whose territory steps to a new snapshot keeps its name on screen while scrubbing.
 * Labels rest at `EMPIRE_LABEL_REST_OPACITY`; the hovered or selected lineage's draws at full and
 * the rest recede to `EMPIRE_LABEL_DIM_OPACITY`.
 */

import { type CSSProperties, useMemo, useRef } from 'react'
import type * as THREE from 'three'

import type { Mix } from '@/lib/presentedMix'

import { EMPIRE_LABEL_DIM_OPACITY, EMPIRE_LABEL_REST_OPACITY, empireColour } from './empireStyle'
import {
  declutterLabelBoxes,
  empireLabelsAt,
  type EmpireFrame,
  type EmpireLabel,
  type LabelHalfExtents,
  type PlacedLabelBox,
} from './empires'
import { EMPIRE_LABEL_BOX, EMPIRE_LABEL_STYLE, empireLabelTickStyle, GlobeLabel, useScreenSeparation } from './GlobeLabel'
import { unfoldedLiftedPosition } from './projection'

/** Clear space kept around each label when decluttering, in CSS px. */
const EMPIRE_LABEL_GAP_PX = 4

/** A label's half extents in CSS px, estimated from its text: the label font is monospaced, so the
 *  width is the character count times one advance plus the colour tick before it. */
function labelHalfExtentsPx(text: string): LabelHalfExtents {
  const width = text.length * EMPIRE_LABEL_BOX.advancePx + EMPIRE_LABEL_BOX.chromeWidthPx
  return { halfWidth: width / 2 + EMPIRE_LABEL_GAP_PX, halfHeight: EMPIRE_LABEL_BOX.heightPx / 2 + EMPIRE_LABEL_GAP_PX }
}

/** How far inside the sphere's limb an empire label finishes fading out, in the cosine units of
 *  `sphereMarkerVisibility`'s fade band. A label is centred on its anchor, so without this one near
 *  the limb hangs half off the sphere. */
const EMPIRE_LABEL_LIMB_INSET = 0.12

/** The rows a colliding label tries after its anchor: one box height above, then below. */
const EMPIRE_LABEL_ROWS = [0, -1, 1] as const

/** One row's vertical step in CSS px: the text line plus the clear space above and below it. */
const EMPIRE_LABEL_ROW_PX = EMPIRE_LABEL_BOX.heightPx + 2 * EMPIRE_LABEL_GAP_PX

/** The labels drawn for one frame: `empireLabelsAt`'s ranked, capped set, highlighted lineages
 *  placed first so a hovered or selected empire always keeps its name, each in the first row where
 *  it overlaps nothing already placed. `worldPerPx` is one CSS pixel in object space. The hit test
 *  reads the same set, so a hidden label's anchor never answers for a drawn neighbour. */
export function drawnEmpireLabels(
  frame: EmpireFrame,
  cap: number,
  unfold: number,
  worldPerPx: number,
  highlight: ReadonlySet<string>,
): PlacedLabelBox<EmpireLabel>[] {
  const ranked = empireLabelsAt(frame, cap)
  const ordered = [...ranked.filter((label) => highlight.has(label.lineage)), ...ranked.filter((label) => !highlight.has(label.lineage))]
  return declutterLabelBoxes(
    ordered,
    (label) => unfoldedLiftedPosition({ lat: label.lat, lon: label.lon }, unfold, 1, 0, 0),
    (label) => {
      const { halfWidth, halfHeight } = labelHalfExtentsPx(label.text)
      return { halfWidth: halfWidth * worldPerPx, halfHeight: halfHeight * worldPerPx }
    },
    EMPIRE_LABEL_ROWS,
  )
}

/** The label style for a row: the anchor-centred style, shifted a whole row up or down. */
function rowStyle(row: number): CSSProperties {
  if (row === 0) return EMPIRE_LABEL_STYLE
  return { ...EMPIRE_LABEL_STYLE, transform: `translate(-50%, calc(-50% + ${row * EMPIRE_LABEL_ROW_PX}px))` }
}

/** The opacity factor for a label: full for a highlighted lineage, dimmed while a highlighted
 *  lineage is on screen, else at rest. */
function labelEmphasis(lineage: string, highlight: ReadonlySet<string>, highlightShown: boolean): number {
  if (highlight.has(lineage)) return 1
  return highlightShown ? EMPIRE_LABEL_DIM_OPACITY : EMPIRE_LABEL_REST_OPACITY
}

interface PlacedLabel {
  key: string
  label: EmpireLabel
  row: number
  opacity: number
}

export interface EmpireLabelsProps {
  presented: Mix<EmpireFrame>
  cap: number
  unfold: number
  radius: number
  /** The hovered and the selected lineage, whose labels draw at full opacity. */
  highlight: ReadonlySet<string>
}

export function EmpireLabels({ presented, cap, unfold, radius, highlight }: EmpireLabelsProps) {
  const groupRef = useRef<THREE.Group>(null)
  const worldPerPx = useScreenSeparation(1, true)

  const { from, to, mix } = presented
  const placed = useMemo(() => {
    const byKey = new Map<string, PlacedLabel>()
    const add = (frame: EmpireFrame, weight: number): void => {
      if (weight <= 0) return
      for (const { label, row } of drawnEmpireLabels(frame, cap, unfold, worldPerPx, highlight)) {
        const key = `${label.lineage}:${label.text}`
        const existing = byKey.get(key)
        if (existing !== undefined) {
          existing.opacity = Math.min(1, existing.opacity + weight)
          existing.label = label
          existing.row = row
        } else {
          byKey.set(key, { key, label, row, opacity: weight })
        }
      }
    }
    if (to.key === from.key) {
      add(to, 1)
    } else {
      add(from, 1 - mix)
      add(to, mix)
    }
    return [...byKey.values()]
  }, [from, to, mix, cap, unfold, worldPerPx, highlight])
  const highlightShown = useMemo(
    () => [from, to].some((frame) => frame.snapshots.some((snapshot) => highlight.has(snapshot.lineage))),
    [from, to, highlight],
  )

  return (
    <group ref={groupRef}>
      {placed.map(({ key, label, row, opacity }) => (
        <GlobeLabel
          key={key}
          text={label.text}
          lat={label.lat}
          lon={label.lon}
          opacity={opacity * labelEmphasis(label.lineage, highlight, highlightShown)}
          unfold={unfold}
          radius={radius}
          groupRef={groupRef}
          style={rowStyle(row)}
          tickStyle={empireLabelTickStyle(empireColour(label.colourSlot))}
          limbInset={EMPIRE_LABEL_LIMB_INSET}
        />
      ))}
    </group>
  )
}
