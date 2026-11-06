import { describe, expect, it } from 'vitest'
import { validateAlignment, validateMeasurements } from './measurements'
import { DEFAULT_ALIGNMENT, DEFAULT_MEASUREMENTS } from './types'

describe('measurement validation', () => {
  it('accepts the default adult measurements', () => {
    expect(validateMeasurements(DEFAULT_MEASUREMENTS)).toEqual([])
  })
  it('rejects out-of-range and non-finite values', () => {
    expect(validateMeasurements({ ...DEFAULT_MEASUREMENTS, heightCm: 10 }).join(' ')).toMatch(/Height/)
    expect(validateMeasurements({ ...DEFAULT_MEASUREMENTS, waistCm: Number.NaN }).join(' ')).toMatch(/Waist/)
  })
  it('rejects an inseam that cannot fit the height', () => {
    expect(validateMeasurements({ ...DEFAULT_MEASUREMENTS, heightCm: 150, inseamCm: 118 }).join(' ')).toMatch(/Inseam/)
  })
  it('only allows bounded rigid/uniform alignment', () => {
    expect(validateAlignment(DEFAULT_ALIGNMENT)).toEqual([])
    expect(validateAlignment({ ...DEFAULT_ALIGNMENT, scalePercent: 110 }).join(' ')).toMatch(/locked at 100%/)
    expect(validateAlignment({ ...DEFAULT_ALIGNMENT, offsetXCm: 40 }).join(' ')).toMatch(/offsets/)
  })
})
