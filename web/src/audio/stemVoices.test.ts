import { describe, expect, it } from 'vitest'

import type { AudioStem } from '@/types/manifest'

import { STEM_IDS } from './stemIds'
import { planStemVoices, stemLevelGain, type StemVoicePlan } from './stemVoices'

function stem(id: string, loopSafe: boolean, levelTrimDb = 0): AudioStem {
  return {
    id,
    file: `audio/${id}.mp3`,
    title: id,
    author: 'test',
    licence: 'CC0',
    sourceUrl: '',
    durationSeconds: 20,
    loopSafe,
    levelTrimDb,
  }
}

describe('stemLevelGain', () => {
  it('converts the published trim in dB to a linear gain multiplier', () => {
    expect(stemLevelGain(stem('traffic', true, 0))).toBe(1)
    expect(stemLevelGain(stem('insects', true, 20))).toBeCloseTo(10, 10)
    expect(stemLevelGain(stem('traffic', true, -6))).toBeCloseTo(0.501, 3)
  })
})

describe('planStemVoices', () => {
  it('loops ambience and loop-safe scene stems, and gives one-shot scene stems a buffer only', () => {
    const wind = stem('wind', true)
    const geothermal = stem('geothermal', true)
    const impact = stem('impact', false)
    const rocket = stem('rocket', false)

    const plans = planStemVoices([wind, geothermal, impact, rocket])
    const byId = new Map(plans.map((plan) => [plan.id, plan]))

    expect(byId.get('wind')).toEqual<StemVoicePlan>({ kind: 'ambience-loop', id: 'wind', stem: wind })
    expect(byId.get('geothermal')).toEqual<StemVoicePlan>({ kind: 'scene-loop', id: 'geothermal', stem: geothermal })
    expect(byId.get('impact')).toEqual<StemVoicePlan>({ kind: 'one-shot', id: 'impact', stem: impact })
    expect(byId.get('rocket')).toEqual<StemVoicePlan>({ kind: 'one-shot', id: 'rocket', stem: rocket })
    expect(byId.get('traffic')).toEqual<StemVoicePlan>({ kind: 'missing', id: 'traffic' })
  })

  it('never plans a looping voice for impact, even if published loop-safe by mistake it stays scene-only', () => {
    const plans = planStemVoices([stem('impact', true)])
    const impact = plans.find((plan) => plan.id === 'impact')
    expect(impact?.kind).toBe('scene-loop')
    expect(plans.some((plan) => plan.kind === 'ambience-loop' && (plan.id as string) === 'impact')).toBe(false)
  })

  it('refuses to loop an ambience stem that is not loop-safe', () => {
    const insects = stem('insects', false)
    const plan = planStemVoices([insects]).find((p) => p.id === 'insects')
    expect(plan).toEqual<StemVoicePlan>({ kind: 'not-loop-safe', id: 'insects', stem: insects })
  })

  it('plans every catalogued id once, in catalogue order, and ignores retired published ids', () => {
    const plans = planStemVoices([stem('machinery', true)])
    expect(plans.map((plan) => plan.id)).toEqual(STEM_IDS)
    expect(plans.every((plan) => plan.kind === 'missing')).toBe(true)
  })
})
