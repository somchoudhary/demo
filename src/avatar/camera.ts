import { Box3, Vector3 } from 'three'

export type PresetView = 'front' | 'side' | 'back'
export type CameraView = PresetView | 'free'
export type ViewerCommand = { id: number; type: PresetView | 'reset' | 'zoomIn' | 'zoomOut' }

export const VIEW_DIRECTIONS: Record<PresetView, Vector3> = {
  front: new Vector3(0, 0, 1),
  side: new Vector3(1, 0, 0),
  back: new Vector3(0, 0, -1),
}

export interface CameraFraming {
  target: Vector3
  position: Vector3
  fitDistance: number
  minDistance: number
  maxDistance: number
  near: number
  far: number
}

/** Fit the measured body, including hair and fingertips, with a deliberate safety margin. */
export function frameBounds(bounds: Box3, aspect: number, fovDegrees: number, direction = VIEW_DIRECTIONS.front): CameraFraming {
  if (bounds.isEmpty()) throw new Error('Cannot frame an empty avatar bounding box.')
  const size = bounds.getSize(new Vector3())
  const target = bounds.getCenter(new Vector3())
  if (![size.x, size.y, size.z, target.x, target.y, target.z].every(Number.isFinite) || size.y <= 0) {
    throw new Error('Avatar bounds are invalid or non-finite.')
  }
  const safeAspect = Math.max(aspect, 0.2)
  const tangent = Math.tan((fovDegrees * Math.PI) / 360)
  const dir = direction.clone().normalize()
  const horizontalExtent = Math.abs(dir.x) * size.z + Math.abs(dir.z) * size.x + Math.abs(dir.y) * size.x
  const verticalExtent = Math.abs(dir.y) * size.z + Math.hypot(dir.x, dir.z) * size.y
  const verticalDistance = verticalExtent / (2 * tangent)
  const horizontalDistance = horizontalExtent / (2 * tangent * safeAspect)
  const fitDistance = Math.max(verticalDistance, horizontalDistance) * 1.2 + size.length() * 0.12
  const minDistance = Math.max(size.y * 0.28, 0.1)
  return {
    target,
    position: target.clone().addScaledVector(dir, fitDistance),
    fitDistance,
    minDistance,
    maxDistance: fitDistance * 3,
    near: Math.max(size.y / 200, 0.005),
    far: Math.max(size.y * 100, 50),
  }
}

export function zoomPercent(fitDistance: number, currentDistance: number): number {
  return Math.round((fitDistance / Math.max(currentDistance, 0.001)) * 100)
}
