'use client'

/**
 * One name per active empire lineage (ADR-059), expanded view only. Each presented frame's labels
 * come from `empireLabelsAt` (largest member, ranked by area, capped), are thinned so no two
 * chips overlap on screen (`declutterLabelBoxes`), and fade with the same presented crossfade the territory texture
 * uses: the outgoing frame's labels at `1 - mix`, the incoming frame's at `mix`. A label shared by
 * both frames (same lineage and text) holds steady through the crossfade at the incoming anchor,
 * so a lineage whose territory steps to a new snapshot keeps its name on screen while scrubbing.
 */

import { useMemo, useRef } from 'react'
import type * as THREE from 'three'

import type { Mix } from '@/lib/presentedMix'

import { empireColour } from './empireStyle'
import { declutterLabelBoxes, empireLabelsAt, type EmpireFrame, type EmpireLabel, type LabelHalfExtents } from './empires'
import { EMPIRE_LABEL_CHIP, empireLabelStyle, GlobeLabel, useScreenSeparation } from './GlobeLabel'
import { unfoldedLiftedPosition } from './projection'

/** Clear space kept around each chip when decluttering, in CSS px. */
const EMPIRE_LABEL_GAP_PX = 4

/** A chip's half extents in CSS px, estimated from its text: the label font is monospaced, so the
 *  width is the character count times one advance plus the chip's padding and borders. */
function labelHalfExtentsPx(text: string): LabelHalfExtents {
  const width = text.length * EMPIRE_LABEL_CHIP.advancePx + EMPIRE_LABEL_CHIP.chromeWidthPx
  return { halfWidth: width / 2 + EMPIRE_LABEL_GAP_PX, halfHeight: EMPIRE_LABEL_CHIP.heightPx / 2 + EMPIRE_LABEL_GAP_PX }
}

/** How far inside the sphere's limb an empire label finishes fading out, in the cosine units of
 *  `sphereMarkerVisibility`'s fade band. A chip is centred on its anchor, so without this one near
 *  the limb hangs half off the sphere. */
const EMPIRE_LABEL_LIMB_INSET = 0.12

interface PlacedLabel {
  key: string
  label: EmpireLabel
  opacity: number
}

export interface EmpireLabelsProps {
  presented: Mix<EmpireFrame>
  cap: number
  unfold: number
  radius: number
}

export function EmpireLabels({ presented, cap, unfold, radius }: EmpireLabelsProps) {
  const groupRef = useRef<THREE.Group>(null)
  const worldPerPx = useScreenSeparation(1, true)

  const { from, to, mix } = presented
  const placed = useMemo(() => {
    const byKey = new Map<string, PlacedLabel>()
    const add = (frame: EmpireFrame, weight: number): void => {
      if (weight <= 0) return
      const labels = declutterLabelBoxes(
        empireLabelsAt(frame, cap),
        (label) => unfoldedLiftedPosition({ lat: label.lat, lon: label.lon }, unfold, 1, 0, 0),
        (label) => {
          const { halfWidth, halfHeight } = labelHalfExtentsPx(label.text)
          return { halfWidth: halfWidth * worldPerPx, halfHeight: halfHeight * worldPerPx }
        },
      )
      for (const label of labels) {
        const key = `${label.lineage}:${label.text}`
        const existing = byKey.get(key)
        if (existing !== undefined) {
          existing.opacity = Math.min(1, existing.opacity + weight)
          existing.label = label
        } else {
          byKey.set(key, { key, label, opacity: weight })
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
  }, [from, to, mix, cap, unfold, worldPerPx])

  return (
    <group ref={groupRef}>
      {placed.map(({ key, label, opacity }) => (
        <GlobeLabel
          key={key}
          text={label.text}
          lat={label.lat}
          lon={label.lon}
          opacity={opacity}
          unfold={unfold}
          radius={radius}
          groupRef={groupRef}
          style={empireLabelStyle(empireColour(label.colourSlot))}
          limbInset={EMPIRE_LABEL_LIMB_INSET}
        />
      ))}
    </group>
  )
}
