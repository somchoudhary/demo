import type { FaceMesh, FaceMeshConfig, NormalizedLandmark } from '@mediapipe/face_mesh'

/**
 * Local face-detection engine. MediaPipe FaceMesh runs entirely in this
 * browser from the solution + model assets bundled under /mediapipe — no
 * photo ever leaves the device and no reconstruction service is called.
 *
 * The solution bundle is a classic (non-module) script, so it is loaded at
 * runtime from our own /mediapipe directory and used through window.FaceMesh.
 * Only types are imported from the npm package, keeping the app bundle free
 * of the engine until generation actually runs.
 */

export interface DetectedFace {
  /** 468 (or 478 with iris refinement) normalized landmarks: x right, y down. */
  landmarks: NormalizedLandmark[]
  /** Decoded 3D face mesh: 5 floats per vertex (x, y, z, u, v). */
  vertexBuffer: Float32Array
  /** Triangle indices for the face mesh. */
  indexBuffer: Uint32Array
  /** Source image size the landmarks/UVs are normalized against. */
  imageWidth: number
  imageHeight: number
}

declare global {
  interface Window {
    FaceMesh?: new (config?: FaceMeshConfig) => FaceMesh
  }
}

const SOLUTION_SCRIPT_URL = '/mediapipe/face_mesh.js'
const DETECTION_TIMEOUT_MS = 30_000

let scriptPromise: Promise<void> | null = null
let instance: FaceMesh | null = null
let initPromise: Promise<FaceMesh> | null = null

function loadSolutionScript(): Promise<void> {
  if (window.FaceMesh) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SOLUTION_SCRIPT_URL
    script.async = true
    script.onload = () => {
      if (window.FaceMesh) resolve()
      else {
        scriptPromise = null
        reject(new Error('The local face engine failed to start (the solution script loaded but FaceMesh is missing).'))
      }
    }
    script.onerror = () => {
      scriptPromise = null
      reject(new Error('Could not load the local face-detection engine from /mediapipe/. Make sure the app is served with its bundled engine files.'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

function getFaceMesh(): Promise<FaceMesh> {
  if (instance) return Promise.resolve(instance)
  if (initPromise) return initPromise
  initPromise = (async () => {
    await loadSolutionScript()
    const FaceMeshCtor = window.FaceMesh
    if (!FaceMeshCtor) throw new Error('The local face engine failed to start.')
    const faceMesh = new FaceMeshCtor({
      locateFile: (path: string) => `/mediapipe/${path}`,
    })
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      enableFaceGeometry: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
      selfieMode: false,
    })
    await faceMesh.initialize()
    instance = faceMesh
    return faceMesh
  })()
  // Allow a retry if initialization fails (e.g. assets not served yet).
  initPromise.catch(() => { initPromise = null })
  return initPromise
}

/** Release the engine. Called when the dialog unmounts or on demand. */
export async function closeFaceEngine(): Promise<void> {
  const current = instance
  instance = null
  initPromise = null
  if (current) await current.close()
}

/**
 * Detect the face in a canvas image. Resolves with landmarks + 3D mesh, or
 * throws a user-facing error when no face is found.
 */
export async function detectFace(
  image: HTMLCanvasElement,
  viewLabel: string,
  signal?: AbortSignal,
): Promise<DetectedFace> {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Generation cancelled.', 'AbortError')
  const faceMesh = await getFaceMesh()
  if (signal?.aborted) throw signal.reason ?? new DOMException('Generation cancelled.', 'AbortError')
  return new Promise<DetectedFace>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Face detection timed out for the ${viewLabel} photo. Try a sharper, better-lit image.`))
    }, DETECTION_TIMEOUT_MS)
    const onAbort = () => {
      cleanup()
      reject(signal?.reason ?? new DOMException('Generation cancelled.', 'AbortError'))
    }
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    faceMesh.onResults((results) => {
      cleanup()
      const landmarks = results.multiFaceLandmarks?.[0]
      const geometry = results.multiFaceGeometry?.[0]
      if (!landmarks || !geometry) {
        reject(new Error(
          `No face was detected in the ${viewLabel} photo. Use a clear, well-lit photo with the face ` +
          `filling most of the frame, looking straight at the camera, with hair away from the face.`,
        ))
        return
      }
      const mesh = geometry.getMesh()
      if (!mesh) {
        reject(new Error(`The face engine returned no 3D mesh for the ${viewLabel} photo.`))
        return
      }
      resolve({
        landmarks,
        vertexBuffer: new Float32Array(mesh.getVertexBufferList()),
        indexBuffer: new Uint32Array(mesh.getIndexBufferList()),
        imageWidth: image.width,
        imageHeight: image.height,
      })
    })
    faceMesh.send({ image }).catch((error: unknown) => {
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })
}
