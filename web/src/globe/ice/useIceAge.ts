'use client'

import { useMemo } from 'react'

import { usePresentedNumericRecord } from '@/lib/presentedMix'
import type { GeoTime } from '@/types/layer'

import { MIN_EFFECT_TRANSITION_SECONDS } from '../effects/presentation'
import { iceAgeCaption, iceAgeStateAt, type IceAgeLayers, type IceAgeState } from './iceAge'

/** The rate limiter moves every field by at most one unit per `MIN_EFFECT_TRANSITION_SECONDS`;
 *  sea level is presented in units of this many metres so a glacial-to-interglacial swing takes
 *  about as long to fade as the ice sheets themselves. */
const SEA_LEVEL_PRESENTATION_UNIT_M = 100

interface PresentedFields {
  iceVolume: number
  seaLevel: number
  northernGate: number
  antarcticGate: number
}

export interface PresentedIceAge {
  state: IceAgeState
  caption: string
}

/**
 * The ice age at `t`, rate-limited on screen exactly like the other globe effects
 * (`effects/presentation.ts`): the target stays pure in `t`, only what is displayed catches up,
 * so a scrub from the LGM to the present fades the sheets rather than snapping them. The caption
 * follows the target, as `useGlobeEffects`' does.
 */
export function useIceAge(t: GeoTime, layers: IceAgeLayers | null): PresentedIceAge {
  const target = useMemo(() => iceAgeStateAt(t, layers), [t, layers])
  const targetFields = useMemo(
    (): PresentedFields => ({
      iceVolume: target.iceVolume,
      seaLevel: target.seaLevelM / SEA_LEVEL_PRESENTATION_UNIT_M,
      northernGate: target.northernGate,
      antarcticGate: target.antarcticGate,
    }),
    [target],
  )
  const presented = usePresentedNumericRecord(targetFields, MIN_EFFECT_TRANSITION_SECONDS)
  const state = useMemo(
    (): IceAgeState => ({
      iceVolume: presented.iceVolume,
      seaLevelM: presented.seaLevel * SEA_LEVEL_PRESENTATION_UNIT_M,
      northernGate: presented.northernGate,
      antarcticGate: presented.antarcticGate,
    }),
    [presented],
  )
  return { state, caption: iceAgeCaption(target) }
}
