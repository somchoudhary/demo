import type { AvatarSource } from '../avatar/types'

export interface BodyMeasurements {
  /** All values are centimeters. */
  heightCm: number
  chestCm: number
  waistCm: number
  hipsCm: number
  inseamCm: number
  shoulderWidthCm: number
}

export interface ScanAlignment {
  /** Locked at 100%. The supplied scan is never resized or deformed. */
  scalePercent: number
  /** Rigid placement offsets in centimeters. */
  offsetXCm: number
  offsetYCm: number
  offsetZCm: number
  /** Rigid orientation in degrees. */
  yawDeg: number
  pitchDeg: number
  rollDeg: number
}

export interface FaceLockProof {
  verified: boolean
  method: 'local-vertex-sha256-before-after-glb-roundtrip'
  meshCount: number
  vertexCount: number
  triangleCount: number
  positionSha256: string
  indexSha256: string
  /** Local head vertices are never edited after generation; only parent node placement may change. */
  maxLocalVertexDeltaMeters: number
}

export interface BodyFitReport {
  target: BodyMeasurements
  achieved: {
    totalHeightCm: number
    chestCm: number
    waistCm: number
    hipsCm: number
    inseamCm: number
    shoulderWidthCm: number
  }
  note: string
}

export interface PersonalizationReport {
  createdAt: string
  localOnly: true
  scanFileName: string
  scanSha256: string
  referencePhoto?: { fileName: string; sha256: string; usedForGeometry: boolean }
  faceLock: FaceLockProof
  bodyFit: BodyFitReport
  alignment: ScanAlignment
  exportBytes: number
  exportSha256: string
}

export interface GeneratedAvatar {
  source: AvatarSource
  blobUrl: string
  glb: ArrayBuffer
  report: PersonalizationReport
  fileName: string
}

export type GenerationStage =
  | 'reading-inputs'
  | 'loading-base'
  | 'validating-scan'
  | 'fitting-body'
  | 'attaching-scan'
  | 'exporting'
  | 'verifying-face-lock'

export interface GenerationProgress {
  stage: GenerationStage
  message: string
}

export const DEFAULT_ALIGNMENT: ScanAlignment = {
  scalePercent: 100,
  offsetXCm: 0,
  offsetYCm: 0,
  offsetZCm: 0,
  yawDeg: 0,
  pitchDeg: 0,
  rollDeg: 0,
}

export const DEFAULT_MEASUREMENTS: BodyMeasurements = {
  heightCm: 170,
  chestCm: 96,
  waistCm: 80,
  hipsCm: 98,
  inseamCm: 78,
  shoulderWidthCm: 42,
}
