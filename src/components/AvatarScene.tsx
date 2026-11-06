import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ComponentRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { MathUtils, PerspectiveCamera, Vector3 } from 'three'
import { frameBounds, VIEW_DIRECTIONS, zoomPercent } from '../avatar/camera'
import type { CameraFraming, CameraView, ViewerCommand } from '../avatar/camera'
import type { LoadedAvatar } from '../avatar/types'

type OrbitControlsHandle = ComponentRef<typeof OrbitControls>

interface AvatarSceneProps {
  avatar: LoadedAvatar
  command: ViewerCommand
  rotating: boolean
  onInteraction: () => void
  onZoomChange: (percent: number) => void
  onRenderReady: () => void
  onError: (error: Error) => void
}

function CameraRig({ bounds, command, rotating, onInteraction, onZoomChange }: {
  bounds: LoadedAvatar['bounds']
  command: ViewerCommand
  rotating: boolean
  onInteraction: () => void
  onZoomChange: (percent: number) => void
}) {
  const controls = useRef<OrbitControlsHandle>(null)
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const invalidate = useThree((state) => state.invalidate)
  const framing = useRef<CameraFraming | null>(null)
  const motion = useRef<{ position: Vector3; target: Vector3 } | null>(null)
  const initialized = useRef(false)
  const [limits, setLimits] = useState({ min: 0.1, max: 20 })
  const fov = camera instanceof PerspectiveCamera ? camera.fov : 35

  const reportZoom = useCallback(() => {
    const current = controls.current
    if (!current || !framing.current) return
    onZoomChange(zoomPercent(framing.current.fitDistance, camera.position.distanceTo(current.target)))
  }, [camera, onZoomChange])

  useLayoutEffect(() => {
    const current = controls.current
    if (!current || size.width <= 0 || size.height <= 0) return
    const direction = initialized.current ? camera.position.clone().sub(current.target).normalize() : VIEW_DIRECTIONS.front
    const next = frameBounds(bounds, size.width / size.height, fov, direction)
    framing.current = next
    setLimits({ min: next.minDistance, max: next.maxDistance })
    current.minDistance = next.minDistance
    current.maxDistance = next.maxDistance
    if (camera instanceof PerspectiveCamera) {
      camera.near = next.near
      camera.far = next.far
      camera.updateProjectionMatrix()
    }
    if (!initialized.current) {
      camera.position.copy(next.position)
      current.target.copy(next.target)
      camera.lookAt(next.target)
      current.update()
      initialized.current = true
    } else {
      motion.current = { position: next.position, target: next.target }
    }
    reportZoom()
    invalidate()
  }, [bounds, size.width, size.height, fov, camera, invalidate, reportZoom])

  useEffect(() => {
    const current = controls.current
    const fit = framing.current
    if (!current || !fit || command.id === 0) return
    // Clear any orbit/pan momentum so a preset or reset lands on its exact target.
    const damping = current.enableDamping
    current.enableDamping = false
    current.update()
    current.enableDamping = damping
    if (command.type === 'zoomIn' || command.type === 'zoomOut') {
      const offset = camera.position.clone().sub(current.target)
      const distance = MathUtils.clamp(offset.length() * (command.type === 'zoomIn' ? 0.8 : 1.25), fit.minDistance, fit.maxDistance)
      motion.current = { position: current.target.clone().add(offset.normalize().multiplyScalar(distance)), target: current.target.clone() }
    } else {
      const view = command.type === 'reset' ? 'front' : command.type
      const next = frameBounds(bounds, size.width / size.height, fov, VIEW_DIRECTIONS[view])
      framing.current = next
      motion.current = { position: next.position, target: next.target }
    }
    invalidate()
    // Commands are discrete events; resizing is handled independently above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command.id])

  useFrame((_, delta) => {
    const current = controls.current
    if (!current) return
    if (motion.current) {
      const alpha = 1 - Math.exp(-Math.min(delta, 0.1) * 9)
      camera.position.lerp(motion.current.position, alpha)
      current.target.lerp(motion.current.target, alpha)
      if (camera.position.distanceTo(motion.current.position) < 0.001 && current.target.distanceTo(motion.current.target) < 0.001) {
        camera.position.copy(motion.current.position)
        current.target.copy(motion.current.target)
        motion.current = null
      }
      current.update()
      invalidate()
    }
    if (rotating) invalidate()
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.65}
      zoomSpeed={0.8}
      panSpeed={0.65}
      screenSpacePanning
      minDistance={limits.min}
      maxDistance={limits.max}
      minPolarAngle={0.08}
      maxPolarAngle={Math.PI * 0.55}
      autoRotate={rotating}
      autoRotateSpeed={4}
      onStart={() => {
        motion.current = null
        onInteraction()
      }}
      onChange={reportZoom}
    />
  )
}

function GraphicsEvents({ onError }: { onError: (error: Error) => void }) {
  const gl = useThree((state) => state.gl)
  useEffect(() => {
    const canvas = gl.domElement
    const lost = (event: Event) => {
      event.preventDefault()
      onError(new Error('The WebGL graphics context was lost. Retry to reinitialize the 3D viewer.'))
    }
    canvas.addEventListener('webglcontextlost', lost)
    return () => canvas.removeEventListener('webglcontextlost', lost)
  }, [gl, onError])
  return null
}

function RenderedAvatar({ avatar, onRenderReady, onError }: Pick<AvatarSceneProps, 'avatar' | 'onRenderReady' | 'onError'>) {
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)
  const frames = useRef(0)
  const reported = useRef(false)

  useEffect(() => {
    let active = true
    // Some software/mobile GPUs lack parallel shader compilation; compile synchronously there.
    const compilation = gl.extensions.has('KHR_parallel_shader_compile')
      ? gl.compileAsync(avatar.scene, camera, scene)
      : Promise.resolve(gl.compile(avatar.scene, camera, scene))
    compilation.then(() => {
      if (active) invalidate()
    }).catch((error: unknown) => {
      if (active) onError(error instanceof Error ? error : new Error(String(error)))
    })
    return () => { active = false }
  }, [avatar, gl, camera, scene, invalidate, onError])

  useFrame(() => {
    // Readiness follows actual rendered frames, not merely a successful fetch or React render.
    frames.current += 1
    if (frames.current >= 3 && !reported.current) {
      reported.current = true
      onRenderReady()
    } else if (!reported.current) {
      invalidate()
    }
  })
  return <primitive object={avatar.scene} />
}

export function AvatarScene({ avatar, command, rotating, onInteraction, onZoomChange, onRenderReady, onError }: AvatarSceneProps) {
  const { centeredBounds, offset, height } = useMemo(() => {
    const center = avatar.bounds.getCenter(new Vector3())
    const translation = new Vector3(-center.x, -avatar.bounds.min.y, -center.z)
    return {
      centeredBounds: avatar.bounds.clone().translate(translation),
      offset: translation,
      height: avatar.bounds.max.y - avatar.bounds.min.y,
    }
  }, [avatar])

  return (
    <>
      <GraphicsEvents onError={onError} />
      <color attach="background" args={['#edeFEB']} />
      <hemisphereLight args={['#ffffff', '#c4c9bf', 0.65]} />
      <directionalLight
        position={[-3, 5, 4]}
        intensity={2.1}
        color="#fff8ef"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-2}
        shadow-camera-right={2}
        shadow-camera-top={3}
        shadow-camera-bottom={-1}
        shadow-camera-near={0.1}
        shadow-camera-far={14}
        shadow-bias={-0.0002}
        shadow-normalBias={0.025}
      />
      <directionalLight position={[4, 2, 3]} intensity={0.75} color="#f1f5ff" />
      <directionalLight position={[1, 4, -4]} intensity={1.35} color="#ffffff" />
      <Environment resolution={128} frames={1} environmentIntensity={0.45}>
        <Lightformer form="rect" intensity={2} position={[-3, 3, 3]} target={[0, 1, 0]} scale={[4, 5, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[4, 2, 1]} target={[0, 1, 0]} scale={[3, 4, 1]} />
        <Lightformer form="rect" intensity={1.5} position={[0, 5, -2]} target={[0, 1, 0]} scale={[5, 3, 1]} />
      </Environment>
      <group position={offset}>
        <RenderedAvatar avatar={avatar} onRenderReady={onRenderReady} onError={onError} />
      </group>
      <ContactShadows position={[0, 0.002, 0]} opacity={0.32} scale={height * 2.4} blur={2.8} far={height * 0.9} resolution={512} frames={1} color="#596151" />
      <CameraRig bounds={centeredBounds} command={command} rotating={rotating} onInteraction={onInteraction} onZoomChange={onZoomChange} />
    </>
  )
}

export type { CameraView }
