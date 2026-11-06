import {
  Box3,
  LoadingManager,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SkinnedMesh,
  Texture,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { asAvatarLoadError, AvatarLoadError, errorMessage } from './errors'
import { disposeAvatarScene } from './dispose'
import { applyMpfbNeutralPose } from './neutralPose'
import type {
  AvatarDiagnostics,
  AvatarLoadOptions,
  AvatarLoadProgress,
  AvatarLoadStage,
  AvatarRepository,
  AvatarSource,
  HumanAnatomyChecks,
  LoadedAvatar,
} from './types'

interface RepositoryOptions {
  baseUrl?: string
  fetcher?: typeof fetch
  timeoutMs?: number
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}

async function readBody(response: Response, signal: AbortSignal, onProgress: (progress: AvatarLoadProgress) => void): Promise<ArrayBuffer> {
  const header = response.headers.get('content-length')
  const totalBytes = header && Number.isFinite(Number(header)) && Number(header) > 0 ? Number(header) : undefined
  if (!response.body) {
    const buffer = await response.arrayBuffer()
    onProgress({ stage: 'download', loadedBytes: buffer.byteLength, totalBytes })
    return buffer
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loadedBytes = 0
  try {
    while (true) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loadedBytes += value.byteLength
      onProgress({ stage: 'download', loadedBytes, totalBytes })
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(loadedBytes)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result.buffer
}

async function verifyIntegrity(buffer: ArrayBuffer, source: AvatarSource, url: string): Promise<void> {
  if (!source.integrity) return
  if (buffer.byteLength !== source.integrity.bytes) {
    throw new AvatarLoadError('integrity', url, `Asset byte length mismatch: expected ${source.integrity.bytes}, received ${buffer.byteLength}.`)
  }
  if (!globalThis.crypto?.subtle) {
    throw new AvatarLoadError('integrity', url, 'SHA-256 verification requires a secure context (HTTPS or localhost).')
  }
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  if (hash !== source.integrity.sha256) {
    throw new AvatarLoadError('integrity', url, `Asset SHA-256 mismatch: expected ${source.integrity.sha256}, received ${hash}.`)
  }
}

function checkAnatomy(names: Set<string>): HumanAnatomyChecks {
  const has = (pattern: RegExp) => [...names].some((name) => pattern.test(name))
  const fingers = ['Left', 'Right'].every((side) =>
    ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].every((finger) => has(new RegExp(`${side}Hand${finger}1$`, 'i'))),
  )
  return {
    head: has(/Head$/i),
    neck: has(/Neck/i),
    torso: has(/(Spine|Hips|Pelvis)/i),
    arms: has(/Left(UpperArm|Arm)$/i) && has(/Right(UpperArm|Arm)$/i),
    hands: has(/LeftHand$/i) && has(/RightHand$/i),
    fingers,
    legs: has(/Left(UpLeg|UpperLeg|Thigh)$/i) && has(/Right(UpLeg|UpperLeg|Thigh)$/i),
    feet: has(/LeftFoot$/i) && has(/RightFoot$/i),
  }
}

function finishMaterials(root: Object3D): void {
  const visited = new Set<MeshStandardMaterial>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.castShadow = true
    object.receiveShadow = true
    // Posed skin bounds can differ from the bind pose; do not let stale bounds hide limbs.
    if (object instanceof SkinnedMesh) object.frustumCulled = false
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial) || visited.has(material)) continue
      visited.add(material)
      const name = material.name.toLowerCase()
      // Preserve the asset's color, normal and alpha maps. Tune only dielectric response.
      material.metalness = 0
      if (/body|skin/.test(name)) {
        material.roughness = Math.max(material.roughness, 0.74)
        material.envMapIntensity = 0.4
      } else if (/ponytail|hair|eyebrow|eyelash/.test(name)) {
        material.roughness = Math.max(material.roughness, 0.86)
        material.envMapIntensity = 0.28
      } else if (/high-poly|eye/.test(name)) {
        material.roughness = Math.min(material.roughness, 0.38)
        material.envMapIntensity = 0.65
      } else {
        material.roughness = Math.max(material.roughness, 0.78)
        material.envMapIntensity = 0.35
      }
      material.needsUpdate = true
    }
  })
}

export function inspectAvatar(root: Object3D, bytes: number, requireHumanAnatomy: boolean): { bounds: Box3; diagnostics: AvatarDiagnostics } {
  root.updateMatrixWorld(true)
  const meshes: Mesh[] = []
  const materials = new Set<MeshStandardMaterial>()
  const textures = new Map<Texture, string>()
  const bones = new Set<string>()
  let skinnedMeshCount = 0
  let jointCount = 0
  let morphTargetCount = 0
  root.traverse((object) => {
    if (object instanceof SkinnedMesh) {
      skinnedMeshCount += 1
      object.skeleton.update()
      object.skeleton.bones.forEach((bone) => bones.add(bone.name))
      jointCount = Math.max(jointCount, object.skeleton.bones.length)
      object.computeBoundingBox()
      object.computeBoundingSphere()
    }
    if (!(object instanceof Mesh)) return
    meshes.push(object)
    morphTargetCount += Object.keys(object.morphTargetDictionary ?? {}).length
    const list = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of list) {
      if (material instanceof MeshStandardMaterial) materials.add(material)
      for (const [slot, value] of Object.entries(material)) {
        if (value instanceof Texture) textures.set(value, value.name || `${material.name || object.name}.${slot}`)
      }
    }
  })
  if (!meshes.length) throw new Error('The file contains no renderable mesh geometry.')
  const unavailable: string[] = []
  for (const [texture, name] of textures) {
    const image = texture.image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; data?: unknown } | undefined
    const width = image?.width || image?.naturalWidth || 0
    const height = image?.height || image?.naturalHeight || 0
    const emptyData = image && 'data' in image && (image.data == null || (ArrayBuffer.isView(image.data) && image.data.byteLength === 0))
    if (!(width > 0 && height > 0) || emptyData) unavailable.push(name)
  }
  if (unavailable.length) throw new Error(`Texture images are unavailable or empty: ${unavailable.join(', ')}.`)
  const anatomy = checkAnatomy(bones)
  if (requireHumanAnatomy) {
    const missing = Object.entries(anatomy).filter(([, present]) => !present).map(([part]) => part)
    if (missing.length) throw new Error(`The base human rig is incomplete; could not verify: ${missing.join(', ')}.`)
  }
  const bounds = new Box3().setFromObject(root, true)
  if (bounds.isEmpty()) throw new Error('The loaded model has empty geometry bounds.')
  const size = bounds.getSize(new Vector3())
  if (![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error(`Invalid model dimensions in meters: ${size.toArray().join(', ')}.`)
  }
  const vertexCount = meshes.reduce((sum, mesh) => sum + (mesh.geometry.getAttribute('position')?.count ?? 0), 0)
  const triangleCount = meshes.reduce((sum, mesh) => sum + Math.floor((mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position')?.count ?? 0) / 3), 0)
  return {
    bounds,
    diagnostics: {
      bytes,
      meshCount: meshes.length,
      skinnedMeshCount,
      vertexCount,
      triangleCount,
      jointCount,
      materialCount: materials.size,
      textureCount: textures.size,
      loadedTextureCount: textures.size - unavailable.length,
      morphTargetCount,
      textureNames: [...textures.values()],
      dimensionsMeters: { width: size.x, height: size.y, depth: size.z },
      anatomy,
    },
  }
}

/**
 * Renderer-independent glTF loading adapter. The bundled asset uses Meshopt +
 * WebP, both decoded locally. Custom sources may use embedded or relative textures.
 * Unsupported compression extensions surface the loader's actual error; there is
 * deliberately no procedural fallback.
 */
export class GltfAvatarRepository implements AvatarRepository {
  private readonly baseUrl: string
  private readonly fetcher: typeof fetch
  private readonly timeoutMs: number

  constructor(options: RepositoryOptions = {}) {
    this.baseUrl = options.baseUrl ?? (typeof document !== 'undefined' ? document.baseURI : 'http://localhost/')
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
    this.timeoutMs = options.timeoutMs ?? 45_000
  }

  async load(source: AvatarSource, options: AvatarLoadOptions = {}): Promise<LoadedAvatar> {
    const controller = new AbortController()
    const abortExternal = () => controller.abort(options.signal?.reason)
    if (options.signal?.aborted) abortExternal()
    else options.signal?.addEventListener('abort', abortExternal, { once: true })
    const timeout = setTimeout(() => controller.abort(new DOMException(`Model request timed out after ${this.timeoutMs} ms.`, 'TimeoutError')), this.timeoutMs)
    let url = source.url
    let stage: AvatarLoadStage = 'request'
    let scene: LoadedAvatar['scene'] | undefined
    const failedResources: string[] = []
    const progress = options.onProgress ?? (() => {})
    try {
      const resolved = new URL(source.url, this.baseUrl)
      url = resolved.href
      progress({ stage: 'request', loadedBytes: 0 })
      const response = await this.fetcher(url, { signal: controller.signal, credentials: 'same-origin' })
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText || 'Request failed'}.`)
      const contentType = response.headers.get('content-type') ?? ''
      if (/text\/html/i.test(contentType)) throw new Error(`Expected a glTF model but the server returned HTML (${contentType}). Check the asset path and server fallback.`)
      stage = 'download'
      const buffer = await readBody(response, controller.signal, progress)
      throwIfAborted(controller.signal)
      stage = 'integrity'
      progress({ stage, loadedBytes: buffer.byteLength, totalBytes: buffer.byteLength })
      await verifyIntegrity(buffer, source, url)
      throwIfAborted(controller.signal)
      stage = 'decode'
      progress({ stage, loadedBytes: buffer.byteLength, totalBytes: buffer.byteLength })
      const format = source.format ?? (resolved.pathname.toLowerCase().endsWith('.gltf') ? 'gltf' : 'glb')
      if (format === 'glb') {
        const view = new DataView(buffer)
        if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) {
          throw new Error('Invalid GLB: expected a glTF 2.0 binary container with a matching declared byte length.')
        }
      }
      const manager = new LoadingManager()
      manager.onError = (resource) => failedResources.push(resource)
      const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder)
      const resourcePath = resolved.protocol === 'blob:' ? '' : new URL('.', resolved).href
      const gltf = await loader.parseAsync(format === 'gltf' ? new TextDecoder().decode(buffer) : buffer, resourcePath)
      scene = gltf.scene
      throwIfAborted(controller.signal)
      stage = 'validation'
      progress({ stage, loadedBytes: buffer.byteLength, totalBytes: buffer.byteLength })
      if (source.pose === 'neutral-standing') applyMpfbNeutralPose(scene)
      finishMaterials(scene)
      const { bounds, diagnostics } = inspectAvatar(scene, buffer.byteLength, source.kind === 'base')
      const loadedScene = scene
      let disposed = false
      return {
        source,
        scene: loadedScene,
        bounds,
        diagnostics,
        dispose: () => {
          if (disposed) return
          disposed = true
          disposeAvatarScene(loadedScene)
        },
      }
    } catch (error) {
      if (scene) disposeAvatarScene(scene)
      if (options.signal?.aborted) throw options.signal.reason ?? error
      throw asAvatarLoadError(error, stage, url, failedResources)
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abortExternal)
    }
  }
}

export const avatarRepository: AvatarRepository = new GltfAvatarRepository()

export function describeAvatarError(error: Error): string {
  return error instanceof AvatarLoadError ? error.message : errorMessage(error)
}
