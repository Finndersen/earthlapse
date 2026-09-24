'use client'

/**
 * One name per active empire lineage (ADR-059), expanded view only. Which labels show is decided
 * on screen, every frame, by `useDrawnEmpireLabels`: among the labels whose anchor is on screen
 * and on the near side of the sphere, highlighted lineages first and then by area, each is placed
 * on its anchor or a row above or below, and dropped only when all three collide with a label
 * already placed (`placeEmpireLabels`). No count cap: crowding alone thins them, so zooming in
 * names more. React state changes only when the drawn set or a row changes, not per frame.
 *
 * Labels fade with the same presented crossfade the territory texture uses: the outgoing frame's
 * at `1 - mix`, the incoming frame's at `mix`. A label shared by both frames (same lineage and
 * text) holds steady through the crossfade at the incoming anchor, so a lineage whose territory
 * steps to a new snapshot keeps its name on screen while scrubbing. Labels rest at
 * `EMPIRE_LABEL_REST_OPACITY`; the hovered or selected lineage's draws at full and the rest recede
 * to `EMPIRE_LABEL_DIM_OPACITY`.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { type CSSProperties, type MutableRefObject, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import type { Mix } from '@/lib/presentedMix'

import { EMPIRE_LABEL_DIM_OPACITY, EMPIRE_LABEL_REST_OPACITY, empireColour } from './empireStyle'
import { empireLabelsAt, placeEmpireLabels, type EmpireFrame, type EmpireLabel, type LabelHalfExtents, type PlacedLabelBox } from './empires'
import { EMPIRE_LABEL_BOX, EMPIRE_LABEL_STYLE, empireLabelTickStyle, GlobeLabel, globeLabelVisibility } from './GlobeLabel'
import { MARKER_MAP_LIFT, MARKER_SPHERE_LIFT } from './humanStyle'
import { unfoldedLiftedPosition } from './projection'

/** Clear space kept around each label when decluttering, in CSS px. */
const EMPIRE_LABEL_GAP_PX = 4

/** A label's half extents in CSS px, estimated from its text: the label font is monospaced, so the
 *  width is the character count times one advance plus the colour tick before it. */
function labelHalfExtentsPx(label: EmpireLabel): LabelHalfExtents {
  const width = label.text.length * EMPIRE_LABEL_BOX.advancePx + EMPIRE_LABEL_BOX.chromeWidthPx
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

/** The labels placed for each side of the presented crossfade. */
export interface DrawnEmpireLabels {
  from: readonly PlacedLabelBox<EmpireLabel>[]
  to: readonly PlacedLabelBox<EmpireLabel>[]
}

const NONE_DRAWN: DrawnEmpireLabels = { from: [], to: [] }

function placementSignature(frame: EmpireFrame, placed: readonly PlacedLabelBox<EmpireLabel>[]): string {
  return `${frame.key}:${placed.map(({ label, row }) => `${label.lineage}/${label.text}/${row}`).join(',')}`
}

const scratchNdc = new THREE.Vector3()

/**
 * The labels drawn for `presented`'s two frames, re-placed every frame from the camera but held in
 * React state only when the placement changes. `groupRef` is the group the anchors' local
 * positions are in.
 */
function useDrawnEmpireLabels(
  presented: Mix<EmpireFrame>,
  unfold: number,
  radius: number,
  highlight: ReadonlySet<string>,
  groupRef: MutableRefObject<THREE.Group | null>,
): DrawnEmpireLabels {
  const { camera, size } = useThree()
  const [drawn, setDrawn] = useState<DrawnEmpireLabels>(NONE_DRAWN)
  const signatureRef = useRef('')
  const { from, to } = presented
  const rankedFrom = useMemo(() => empireLabelsAt(from), [from])
  const rankedTo = useMemo(() => empireLabelsAt(to), [to])

  useFrame(() => {
    const group = groupRef.current
    if (group === null) return
    const screenOf = (label: EmpireLabel): readonly [number, number] | null => {
      const local = unfoldedLiftedPosition({ lat: label.lat, lon: label.lon }, unfold, radius, MARKER_SPHERE_LIFT, MARKER_MAP_LIFT)
      if (globeLabelVisibility(local, group, camera, radius, unfold, EMPIRE_LABEL_LIMB_INSET, scratchNdc) <= 0) return null
      return [((scratchNdc.x + 1) / 2) * size.width, ((1 - scratchNdc.y) / 2) * size.height]
    }
    const place = (ranked: readonly EmpireLabel[]) => placeEmpireLabels(ranked, highlight, screenOf, labelHalfExtentsPx, EMPIRE_LABEL_ROWS)
    const placedTo = place(rankedTo)
    const placedFrom = from.key === to.key ? placedTo : place(rankedFrom)
    const signature = `${placementSignature(from, placedFrom)}|${placementSignature(to, placedTo)}`
    if (signature === signatureRef.current) return
    signatureRef.current = signature
    setDrawn({ from: placedFrom, to: placedTo })
  })

  return drawn
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
  unfold: number
  radius: number
  /** The hovered and the selected lineage, whose labels draw at full opacity. */
  highlight: ReadonlySet<string>
  /** Told the labels drawn for the incoming frame each time they change (and `[]` on unmount), so
   *  the hit test answers only for a name that is on screen. */
  onDrawn: (labels: readonly EmpireLabel[]) => void
}

export function EmpireLabels({ presented, unfold, radius, highlight, onDrawn }: EmpireLabelsProps) {
  const groupRef = useRef<THREE.Group>(null)
  const drawn = useDrawnEmpireLabels(presented, unfold, radius, highlight, groupRef)

  useEffect(() => {
    onDrawn(drawn.to.map(({ label }) => label))
    return () => onDrawn([])
  }, [drawn.to, onDrawn])

  const { from, to, mix } = presented
  const placed = useMemo(() => {
    const byKey = new Map<string, PlacedLabel>()
    const add = (labels: readonly PlacedLabelBox<EmpireLabel>[], weight: number): void => {
      if (weight <= 0) return
      for (const { label, row } of labels) {
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
      add(drawn.to, 1)
    } else {
      add(drawn.from, 1 - mix)
      add(drawn.to, mix)
    }
    return [...byKey.values()]
  }, [drawn, from.key, to.key, mix])
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
