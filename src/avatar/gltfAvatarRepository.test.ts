import { describe, expect, it } from 'vitest'
import { BoxGeometry, DataTexture, Group, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three'
import { GltfAvatarRepository, inspectAvatar } from './gltfAvatarRepository'
import { applyMpfbNeutralPose } from './neutralPose'
import type { AvatarSource } from './types'

const source: AvatarSource = { id: 'test', label: 'Test', kind: 'custom', url: '/models/test.glb' }
const repositoryWith = (fetcher: typeof fetch, timeoutMs = 1000) => new GltfAvatarRepository({ baseUrl: 'https://studio.example/', fetcher, timeoutMs })

describe('asset loading failures', () => {
  it('reports the actual HTTP status and resolved URL', async () => {
    const repository = repositoryWith(async () => new Response('missing', { status: 404, statusText: 'Not Found' }))
    await expect(repository.load(source)).rejects.toMatchObject({
      name: 'AvatarLoadError',
      stage: 'request',
      url: 'https://studio.example/models/test.glb',
      message: expect.stringContaining('HTTP 404'),
    })
  })

  it('detects an HTML SPA fallback instead of silently treating it as a model', async () => {
    const repository = repositoryWith(async () => new Response('<!doctype html><html></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }))
    await expect(repository.load(source)).rejects.toThrow(/returned HTML/)
  })

  it('checks byte length before parsing', async () => {
    const repository = repositoryWith(async () => new Response(new Uint8Array([1, 2, 3])))
    await expect(repository.load({ ...source, integrity: { bytes: 99, sha256: '0'.repeat(64) } })).rejects.toMatchObject({ stage: 'integrity', message: expect.stringContaining('byte length mismatch') })
  })

  it('checks SHA-256 before parsing', async () => {
    const repository = repositoryWith(async () => new Response(new Uint8Array([1, 2, 3, 4])))
    await expect(repository.load({ ...source, integrity: { bytes: 4, sha256: '0'.repeat(64) } })).rejects.toMatchObject({ stage: 'integrity', message: expect.stringContaining('SHA-256 mismatch') })
  })

  it('rejects a corrupt GLB container with a decoding error', async () => {
    const repository = repositoryWith(async () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'model/gltf-binary' } }))
    await expect(repository.load(source)).rejects.toMatchObject({ stage: 'decode', message: expect.stringContaining('Invalid GLB') })
  })

  it('surfaces a request timeout', async () => {
    const repository = repositoryWith((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }), 10)
    await expect(repository.load(source)).rejects.toThrow(/timed out after 10 ms/)
  })

  it('preserves cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const repository = repositoryWith(async (_url, init) => {
      init?.signal?.throwIfAborted()
      return new Response()
    })
    await expect(repository.load(source, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('scene validation', () => {
  it('rejects an empty scene', () => {
    expect(() => inspectAvatar(new Group(), 0, false)).toThrow(/no renderable mesh/)
  })

  it('rejects declared textures whose images never decoded', () => {
    const material = new MeshStandardMaterial()
    material.map = new DataTexture()
    const group = new Group().add(new Mesh(new BoxGeometry(1, 1, 1), material))
    expect(() => inspectAvatar(group, 100, false)).toThrow(/Texture images are unavailable/)
  })

  it('accepts a decoded texture and reports real geometry counts', () => {
    const material = new MeshStandardMaterial()
    material.map = new DataTexture(new Uint8Array([220, 180, 150, 255]), 1, 1)
    const group = new Group().add(new Mesh(new BoxGeometry(1, 2, 1), material))
    const { diagnostics } = inspectAvatar(group, 123, false)
    expect(diagnostics.triangleCount).toBe(12)
    expect(diagnostics.textureCount).toBe(1)
    expect(diagnostics.loadedTextureCount).toBe(1)
    expect(diagnostics.dimensionsMeters.height).toBeCloseTo(2)
  })
})

describe('authored-rig neutral pose', () => {
  it('relaxes an upper arm by rotating bones, without replacing geometry', () => {
    const root = new Object3D()
    const arm = new Object3D(); arm.name = 'LeftArm'; arm.position.set(0, 1.4, 0)
    const fore = new Object3D(); fore.name = 'LeftForeArm'; fore.position.set(0.4, -0.3, 0)
    const hand = new Object3D(); hand.name = 'LeftHand'; hand.position.set(0.3, -0.2, 0.2)
    arm.add(fore); fore.add(hand); root.add(arm)
    applyMpfbNeutralPose(root)
    const upper = fore.getWorldPosition(new Vector3()).sub(arm.getWorldPosition(new Vector3())).normalize()
    expect(upper.y).toBeLessThan(-0.95)
    expect(Math.abs(upper.x)).toBeLessThan(0.25)
  })
})
