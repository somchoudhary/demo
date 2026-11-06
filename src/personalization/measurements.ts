import type { BodyMeasurements, ScanAlignment } from './types'

export const MEASUREMENT_FIELDS: { key: keyof BodyMeasurements; label: string; min: number; max: number; help: string }[] = [
  { key: 'heightCm', label: 'Height', min: 120, max: 230, help: 'Barefoot standing height.' },
  { key: 'chestCm', label: 'Chest', min: 60, max: 170, help: 'Fullest chest circumference.' },
  { key: 'waistCm', label: 'Waist', min: 50, max: 170, help: 'Natural waist circumference.' },
  { key: 'hipsCm', label: 'Hips', min: 60, max: 190, help: 'Fullest hip circumference.' },
  { key: 'inseamCm', label: 'Inseam', min: 45, max: 120, help: 'Floor to crotch length.' },
  { key: 'shoulderWidthCm', label: 'Shoulder width', min: 28, max: 65, help: 'Across the back, shoulder point to shoulder point.' },
]

export function validateMeasurements(values: BodyMeasurements): string[] {
  const errors: string[] = []
  for (const field of MEASUREMENT_FIELDS) {
    const value = values[field.key]
    if (!Number.isFinite(value)) errors.push(`${field.label} must be a number.`)
    else if (value < field.min || value > field.max) errors.push(`${field.label} must be between ${field.min} and ${field.max} cm.`)
  }
  if (Number.isFinite(values.inseamCm) && Number.isFinite(values.heightCm) && values.inseamCm >= values.heightCm * 0.75) {
    errors.push('Inseam looks too large for the entered height.')
  }
  return errors
}

export function validateAlignment(alignment: ScanAlignment): string[] {
  const errors: string[] = []
  if (!Number.isFinite(alignment.scalePercent) || alignment.scalePercent !== 100) errors.push('Scan scale is locked at 100% so the supplied face geometry is not resized.')
  for (const key of ['offsetXCm', 'offsetYCm', 'offsetZCm'] as const) {
    if (!Number.isFinite(alignment[key]) || Math.abs(alignment[key]) > 20) errors.push('Placement offsets must be within ±20 cm.')
  }
  for (const key of ['yawDeg', 'pitchDeg', 'rollDeg'] as const) {
    if (!Number.isFinite(alignment[key]) || Math.abs(alignment[key]) > 180) errors.push('Rotation values must be within ±180°.')
  }
  return errors
}

export function cmToMeters(cm: number): number {
  return cm / 100
}
