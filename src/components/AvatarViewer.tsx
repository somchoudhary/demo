import { Component, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { ACESFilmicToneMapping } from 'three'
import { Box, LoaderCircle, Minus, MousePointer2, Pause, Play, Plus, RefreshCw, RotateCcw, TriangleAlert } from 'lucide-react'
import { BASE_AVATAR } from '../avatar/baseAvatar'
import { avatarRepository } from '../avatar/gltfAvatarRepository'
import { AvatarLoadError } from '../avatar/errors'
import { useAvatar } from '../avatar/useAvatar'
import type { AvatarRepository, AvatarSource, AvatarViewerState } from '../avatar/types'
import type { CameraView, PresetView, ViewerCommand } from '../avatar/camera'
import { AvatarScene } from './AvatarScene'

export interface AvatarViewerProps {
  /** Defaults to the bundled base human. Supply a custom source through the same loading boundary. */
  source?: AvatarSource
  repository?: AvatarRepository
  onStateChange?: (state: AvatarViewerState) => void
  className?: string
}

class GraphicsErrorBoundary extends Component<{ children: ReactNode; onError: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { this.props.onError(error) }
  render() { return this.state.failed ? null : this.props.children }
}

const STAGE_LABELS = {
  request: 'Connecting to the model',
  download: 'Loading the human model',
  integrity: 'Verifying asset integrity',
  decode: 'Decoding geometry & textures',
  validation: 'Preparing the studio',
} as const

const PRESETS: { id: PresetView; label: string }[] = [
  { id: 'front', label: 'Front View' },
  { id: 'side', label: 'Side View' },
  { id: 'back', label: 'Back View' },
]

/** Reusable, asset-driven 3D human viewer. It never generates a substitute body. */
export function AvatarViewer({ source = BASE_AVATAR, repository = avatarRepository, onStateChange, className = '' }: AvatarViewerProps) {
  const { resource, retry } = useAvatar(source, repository)
  const [renderReady, setRenderReady] = useState(false)
  const [graphicsError, setGraphicsError] = useState<Error | null>(null)
  const [epoch, setEpoch] = useState(0)
  const [view, setView] = useState<CameraView>('front')
  const [rotating, setRotating] = useState(false)
  const [zoom, setZoom] = useState(100)
  const [command, setCommand] = useState<ViewerCommand>({ id: 0, type: 'reset' })

  const error = graphicsError ?? (resource.status === 'error' ? resource.error : null)
  const ready = resource.status === 'ready' && renderReady && !error
  const diagnostics = resource.status === 'ready' ? resource.avatar.diagnostics : undefined

  useEffect(() => {
    if (error) onStateChange?.({ status: 'error', error })
    else if (ready && diagnostics) onStateChange?.({ status: 'ready', diagnostics })
    else if (resource.status === 'loading') onStateChange?.({ status: 'loading', progress: resource.progress })
    else onStateChange?.({ status: 'loading', progress: { stage: 'validation', loadedBytes: diagnostics?.bytes ?? 0 } })
  }, [error, ready, diagnostics, resource, onStateChange])

  const handleRenderReady = useCallback(() => setRenderReady(true), [])
  const handleGraphicsError = useCallback((next: Error) => setGraphicsError(next), [])
  const handleInteraction = useCallback(() => { setRotating(false); setView('free') }, [])
  const issue = useCallback((type: ViewerCommand['type']) => {
    setRotating(false)
    setCommand((previous) => ({ id: previous.id + 1, type }))
  }, [])
  const selectView = (next: PresetView) => { setView(next); issue(next) }
  const reset = () => { setView('front'); setZoom(100); issue('reset') }
  const retryAll = () => {
    setGraphicsError(null)
    setRenderReady(false)
    setView('front')
    setRotating(false)
    setZoom(100)
    setCommand({ id: 0, type: 'reset' })
    setEpoch((value) => value + 1)
    retry()
  }

  const progress = resource.status === 'loading' ? resource.progress : undefined
  const percent = progress?.totalBytes ? Math.min(100, Math.round((progress.loadedBytes / progress.totalBytes) * 100)) : undefined
  const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

  return (
    <section
      className={`avatar-viewer ${className}`}
      aria-label="Avatar viewer"
      data-status={error ? 'error' : ready ? 'ready' : 'loading'}
      data-source-kind={source.kind}
      data-view={view}
      data-rotating={rotating}
      data-zoom={zoom}
      data-textures={diagnostics ? `${diagnostics.loadedTextureCount}/${diagnostics.textureCount}` : undefined}
      data-joints={diagnostics?.jointCount}
      data-triangles={diagnostics?.triangleCount}
    >
      <div className="viewport" role="region" aria-label="Interactive 3D human model. Use the view, rotation and zoom controls below.">
        <GraphicsErrorBoundary key={epoch} onError={handleGraphicsError}>
          <Canvas
            shadows="soft"
            dpr={[1, 1.75]}
            frameloop="demand"
            camera={{ fov: 35, position: [0, 1, 4], near: 0.01, far: 100 }}
            gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
            onCreated={({ gl }) => {
              gl.toneMapping = ACESFilmicToneMapping
              gl.toneMappingExposure = 1.05
            }}
            fallback={<div className="graphics-fallback" role="alert"><TriangleAlert size={28} /><strong>WebGL 2 is unavailable</strong><span>Enable hardware acceleration or open this page in a current browser. No substitute avatar is displayed.</span></div>}
          >
            {resource.status === 'ready' && (
              <AvatarScene
                key={`${source.id}-${epoch}`}
                avatar={resource.avatar}
                command={command}
                rotating={rotating}
                onInteraction={handleInteraction}
                onZoomChange={setZoom}
                onRenderReady={handleRenderReady}
                onError={handleGraphicsError}
              />
            )}
          </Canvas>
        </GraphicsErrorBoundary>

        <div className="viewport-topline" aria-hidden="true">
          <span className="studio-tag"><Box size={13} strokeWidth={1.7} /> STUDIO 01</span>
          <span className={`render-tag ${ready ? 'is-live' : ''}`}><i />{ready ? 'Real-time 3D' : error ? 'Viewer unavailable' : 'Preparing avatar'}</span>
        </div>

        {!error && !ready && (
          <div className="loading-overlay" role="status" aria-live="polite">
            <div className="loading-orbit"><LoaderCircle size={28} className="spin" /></div>
            <strong>{progress ? STAGE_LABELS[progress.stage] : 'Preparing the studio'}</strong>
            <span>{progress?.totalBytes ? `${mb(progress.loadedBytes)} / ${mb(progress.totalBytes)} MB` : 'Loading the actual human asset…'}</span>
            <div className={`loading-track ${percent === undefined ? 'indeterminate' : ''}`}><i style={{ width: percent === undefined ? undefined : `${percent}%` }} /></div>
            {percent !== undefined && <small>{percent}%</small>}
          </div>
        )}

        {error && (
          <div className="error-overlay" role="alert">
            <div className="error-icon"><TriangleAlert size={25} /></div>
            <h2>The avatar couldn’t be loaded</h2>
            <p>{error.message}</p>
            {error instanceof AvatarLoadError && <code className="error-url">{error.url}</code>}
            <button className="button button-primary" onClick={retryAll}><RefreshCw size={15} /> Retry loading</button>
            <small>No placeholder or substitute model is shown.</small>
          </div>
        )}

        {ready && (
          <div className="viewport-hints" aria-hidden="true">
            <span><MousePointer2 size={13} /> Drag to rotate <b>·</b> Scroll to zoom</span>
            <span className="viewport-scale">Y-up <b>·</b> meters</span>
          </div>
        )}
      </div>

      <div className="viewer-toolbar" aria-label="Camera controls">
        <div className="view-presets" role="group" aria-label="Preset views">
          {PRESETS.map((preset) => (
            <button key={preset.id} className={view === preset.id ? 'active' : ''} disabled={!ready} aria-pressed={view === preset.id} onClick={() => selectView(preset.id)}>{preset.label}</button>
          ))}
        </div>
        <span className="toolbar-divider" />
        <button className={`tool-button rotate-button ${rotating ? 'active' : ''}`} disabled={!ready} aria-pressed={rotating} onClick={() => { setRotating((value) => !value); if (!rotating) setView('free') }} title="Continuously orbit the avatar through 360 degrees">
          {rotating ? <Pause size={16} /> : <Play size={16} />} <span>{rotating ? 'Stop rotation' : 'Rotate 360°'}</span>
        </button>
        <div className="toolbar-spacer" />
        <div className="zoom-controls" role="group" aria-label="Zoom controls">
          <button className="icon-button" disabled={!ready} aria-label="Zoom Out" title="Zoom Out" onClick={() => issue('zoomOut')}><Minus size={17} /></button>
          <span className="zoom-value" aria-label={`Zoom ${zoom} percent`}>{zoom}%</span>
          <button className="icon-button" disabled={!ready} aria-label="Zoom In" title="Zoom In" onClick={() => issue('zoomIn')}><Plus size={17} /></button>
        </div>
        <span className="toolbar-divider" />
        <button className="tool-button reset-button" disabled={!ready} onClick={reset} title="Reset View"><RotateCcw size={16} /><span>Reset View</span></button>
      </div>
    </section>
  )
}
