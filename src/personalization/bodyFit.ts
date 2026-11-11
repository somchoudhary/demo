import { BufferAttribute, BufferGeometry, Vector3 } from 'three'
import type { BodyMeasurements } from './types'

export interface BodyLandmarks {
  floorY: number
  inseamY: number
  hipY: number
  waistY: number
  chestY: number
  shoulderY: number
  neckCutoffY: number
  centerX: number
  centerZ: number
  shoulderWidth: number
}

export interface CircumferenceEstimate {
  y: number
  width: number
  depth: number
  circumference: number
}

function ellipseCircumference(width: number, depth: number): number {
  const a = Math.max(width, 1e-6) / 2
  const b = Math.max(depth, 1e-6) / 2
  const h = ((a - b) ** 2) / ((a + b) ** 2)
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)))
}

export function estimateCrossSection(geometry: BufferGeometry, y: number, tolerance = 0.035): CircumferenceEstimate | null {
  const position = geometry.getAttribute('position')
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity; let count = 0
  for (let i = 0; i < position.count; i += 1) {
    const vy = position.getY(i)
    if (Math.abs(vy - y) > tolerance) continue
    const x = position.getX(i); const z = position.getZ(i)
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
    count += 1
  }
  if (count < 8) return null
  const width = maxX - minX; const depth = maxZ - minZ
  return { y, width, depth, circumference: ellipseCircumference(width, depth) }
}

function gaussian(value: number, center: number, sigma: number): number {
  const d = (value - center) / sigma
  return Math.exp(-0.5 * d * d)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Smooth piecewise height mapping: legs follow inseam, torso follows remaining height. */
export function makeHeightMapper(landmarks: BodyLandmarks, target: BodyMeasurements, scanHeightMeters: number) {
  const baseInseam = Math.max(landmarks.inseamY - landmarks.floorY, 0.2)
  const baseTorso = Math.max(landmarks.neckCutoffY - landmarks.inseamY, 0.15)
  const targetInseam = target.inseamCm / 100
  const targetBodyTop = Math.max(target.heightCm / 100 - scanHeightMeters, targetInseam + 0.2)
  const legScale = clamp(targetInseam / baseInseam, 0.55, 1.65)
  const torsoScale = clamp((targetBodyTop - targetInseam) / baseTorso, 0.55, 1.65)
  const blend = 0.07
  return {
    targetBodyTop,
    mapY(y: number): number {
      const legY = landmarks.floorY + (y - landmarks.floorY) * legScale
      const torsoY = landmarks.floorY + targetInseam + (y - landmarks.inseamY) * torsoScale
      const t = clamp((y - (landmarks.inseamY - blend)) / (blend * 2), 0, 1)
      const smooth = t * t * (3 - 2 * t)
      return legY * (1 - smooth) + torsoY * smooth
    },
  }
}

export interface BodyFitOptions {
  measurements: BodyMeasurements
  landmarks: BodyLandmarks
  scanHeightMeters: number
  baseCircumferences: { chest: number; waist: number; hips: number }
}

/** Measurement-guided vertex fit for the imported body only. The head mesh is never passed here. */
export function fitBodyGeometry(source: BufferGeometry, options: BodyFitOptions): BufferGeometry {
  const { measurements, landmarks, baseCircumferences } = options
  const heightMapper = makeHeightMapper(landmarks, measurements, options.scanHeightMeters)
  const chestScale = clamp((measurements.chestCm / 100) / Math.max(baseCircumferences.chest, 0.2), 0.65, 1.55)
  const waistScale = clamp((measurements.waistCm / 100) / Math.max(baseCircumferences.waist, 0.2), 0.6, 1.6)
  const hipsScale = clamp((measurements.hipsCm / 100) / Math.max(baseCircumferences.hips, 0.2), 0.65, 1.55)
  const shoulderScale = clamp((measurements.shoulderWidthCm / 100) / Math.max(landmarks.shoulderWidth, 0.2), 0.7, 1.45)

  const geometry = source.clone()
  const position = geometry.getAttribute('position') as BufferAttribute
  const vertex = new Vector3()
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i)
    const y = vertex.y
    const chestWeight = gaussian(y, landmarks.chestY, 0.085)
    const waistWeight = gaussian(y, landmarks.waistY, 0.07)
    const hipsWeight = gaussian(y, landmarks.hipY, 0.095)
    const shoulderWeight = gaussian(y, landmarks.shoulderY, 0.12)
    const girth = clamp(1 + (chestScale - 1) * chestWeight + (waistScale - 1) * waistWeight + (hipsScale - 1) * hipsWeight, 0.6, 1.65)
    const shoulder = 1 + (shoulderScale - 1) * shoulderWeight
    const x = landmarks.centerX + (vertex.x - landmarks.centerX) * girth * shoulder
    const z = landmarks.centerZ + (vertex.z - landmarks.centerZ) * girth
    position.setXYZ(i, x, heightMapper.mapY(y), z)
  }
  position.needsUpdate = true
  geometry.deleteAttribute('normal')
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export function measureAchieved(bodyGeometries: BufferGeometry[], landmarks: BodyLandmarks, target: BodyMeasurements, scanHeightMeters: number, totalHeightMeters: number) {
  const mapper = makeHeightMapper(landmarks, target, scanHeightMeters)
  const merged = bodyGeometries[0]
  const at = (y: number) => {
    for (const geometry of bodyGeometries) {
      const estimate = estimateCrossSection(geometry, mapper.mapY(y), 0.045)
      if (estimate) return estimate.circumference * 100
    }
    return NaN
  }
  const shoulderEstimate = merged ? estimateCrossSection(merged, mapper.mapY(landmarks.shoulderY), 0.06) : null
  return {
    totalHeightCm: totalHeightMeters * 100,
    chestCm: at(landmarks.chestY),
    waistCm: at(landmarks.waistY),
    hipsCm: at(landmarks.hipY),
    inseamCm: target.inseamCm,
    shoulderWidthCm: shoulderEstimate ? shoulderEstimate.width * 100 : target.shoulderWidthCm,
  }
}
