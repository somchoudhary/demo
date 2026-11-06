import type { Box3, Group } from 'three'

/**
 * Asset boundary for the viewer. A future photo/face/measurement service can
 * produce a custom AvatarSource without changing AvatarViewer or its controls.
 * No personalization service is implemented in phase 1.
 */
export interface AvatarSource {
  id: string
  label: string
  kind: 'base' | 'custom'
  /** Same-origin URL, blob URL, or a CORS-enabled glTF/GLB URL. */
  url: string
  format?: 'glb' | 'gltf'
  /** Opt into the known MPFB rig relaxation; custom assets default to their authored pose. */
  pose?: 'asset-default' | 'neutral-standing'
  /** Optional content integrity contract, checked before parsing. */
  integrity?: { bytes: number; sha256: string }
}

export type AvatarLoadStage = 'request' | 'download' | 'integrity' | 'decode' | 'validation'

export interface AvatarLoadProgress {
  stage: AvatarLoadStage
  loadedBytes: number
  totalBytes?: number
}

export interface HumanAnatomyChecks {
  head: boolean
  neck: boolean
  torso: boolean
  arms: boolean
  hands: boolean
  fingers: boolean
  legs: boolean
  feet: boolean
}

export interface AvatarDiagnostics {
  bytes: number
  meshCount: number
  skinnedMeshCount: number
  vertexCount: number
  triangleCount: number
  jointCount: number
  materialCount: number
  textureCount: number
  loadedTextureCount: number
  morphTargetCount: number
  textureNames: string[]
  dimensionsMeters: { width: number; height: number; depth: number }
  anatomy: HumanAnatomyChecks
}

export interface LoadedAvatar {
  source: AvatarSource
  scene: Group
  /** World-space bounds of the actual posed, skinned geometry, in glTF meters. */
  bounds: Box3
  diagnostics: AvatarDiagnostics
  dispose: () => void
}

export interface AvatarLoadOptions {
  signal?: AbortSignal
  onProgress?: (progress: AvatarLoadProgress) => void
}

/** Replace this implementation to load a reconstructed or measurement-adjusted avatar. */
export interface AvatarRepository {
  load(source: AvatarSource, options?: AvatarLoadOptions): Promise<LoadedAvatar>
}

export type AvatarViewerState =
  | { status: 'loading'; progress: AvatarLoadProgress }
  | { status: 'ready'; diagnostics: AvatarDiagnostics }
  | { status: 'error'; error: Error }
