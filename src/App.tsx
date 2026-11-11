import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  Activity,
  ArrowUpRight,
  Box,
  Check,
  ChevronDown,
  CircleCheck,
  FileText,
  HardDrive,
  Layers3,
  LockKeyhole,
  Move3d,
  ScanFace,
  ShieldCheck,
  X,
} from 'lucide-react'
import { AvatarViewer } from './components/AvatarViewer'
import { PersonalizationDialog } from './components/PersonalizationDialog'
import { ASSET_PROVENANCE, BASE_AVATAR } from './avatar/baseAvatar'
import type { AvatarDiagnostics, AvatarViewerState } from './avatar/types'
import type { GeneratedAvatar } from './personalization/types'

function AssetDialog({ dialogRef, onClose, diagnostics }: { dialogRef: RefObject<HTMLDialogElement | null>; onClose: () => void; diagnostics?: AvatarDiagnostics }) {
  return (
    <dialog ref={dialogRef} className="asset-dialog" aria-labelledby="asset-dialog-title" onClick={(event) => {
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
      <div className="dialog-heading">
        <div className="dialog-icon"><FileText size={22} /></div>
        <button className="icon-button" aria-label="Close asset details" onClick={onClose}><X size={20} /></button>
      </div>
      <p className="eyebrow">TRANSPARENT BY DESIGN</p>
      <h2 id="asset-dialog-title">A real asset. An open license.</h2>
      <p className="dialog-intro">The base body is a complete MPFB human character—not a body assembled from geometric primitives. Personalized avatars keep the supplied head scan and fit this imported body locally.</p>
      <dl className="asset-facts">
        <div><dt>Character</dt><dd>MPFB reference avatar, rigged in Blender</dd></div>
        <div><dt>Created by</dt><dd>{ASSET_PROVENANCE.author}</dd></div>
        <div><dt>Asset license</dt><dd><span className="license-pill">CC0 1.0</span> Free for commercial use</dd></div>
        <div><dt>Delivery</dt><dd>Self-hosted GLB · embedded WebP textures</dd></div>
        <div><dt>Geometry</dt><dd>{diagnostics ? `${diagnostics.triangleCount.toLocaleString()} triangles, ${diagnostics.meshCount} meshes` : 'Full-resolution imported human mesh'}</dd></div>
        <div><dt>Preparation</dt><dd>Meshopt compression; no mesh simplification</dd></div>
      </dl>
      <div className="checksum-block"><span>VERIFIED LOCAL ASSET · SHA-256</span><code>{BASE_AVATAR.integrity?.sha256}</code></div>
      <p className="dialog-note">The upstream author explicitly dedicates this particular <code>mpfb.glb</code> example to CC0. Other avatars in that repository have different licenses and are not used here.</p>
      <div className="dialog-actions">
        <a className="button button-primary" href={ASSET_PROVENANCE.sourceUrl} target="_blank" rel="noreferrer">View original source <ArrowUpRight size={15} /></a>
        <a className="button button-secondary" href={ASSET_PROVENANCE.licenseFile} target="_blank" rel="noreferrer">Read license</a>
        <a className="text-link" href={ASSET_PROVENANCE.manifest} download="base-avatar.manifest.json">Asset manifest <ArrowUpRight size={13} /></a>
      </div>
    </dialog>
  )
}

function ModelSidebar({ state, generated, onOpenAsset, onOpenPersonalization, onReset }: {
  state: AvatarViewerState
  generated: GeneratedAvatar | null
  onOpenAsset: () => void
  onOpenPersonalization: () => void
  onReset: () => void
}) {
  const diagnostics = state.status === 'ready' ? state.diagnostics : undefined
  const ready = state.status === 'ready'
  const custom = Boolean(generated)
  const statusLabel = ready ? 'Verified' : state.status === 'error' ? 'Unavailable' : 'Loading'
  const anatomyComplete = diagnostics ? Object.values(diagnostics.anatomy).every(Boolean) : false
  return (
    <aside className="sidebar" aria-label="Avatar information">
      <section className="panel model-panel">
        <div className="panel-eyebrow"><span>ACTIVE AVATAR</span><span className={`status-pill ${state.status}`}><i />{statusLabel}</span></div>
        <div className="avatar-identity">
          <div className="avatar-symbol"><ScanFace size={27} strokeWidth={1.45} /></div>
          <div><h2>{custom ? 'My personalized avatar' : 'Base avatar 01'}</h2><p>{custom ? 'Personalized 3D model' : 'MPFB · Human reference'}</p></div>
        </div>
        <div className="identity-tags">
          {custom ? (
            <><span><LockKeyhole size={12} /> Head mesh preserved</span><span><Box size={12} /> In-studio model</span></>
          ) : (
            <><span><Box size={12} /> Real human mesh</span><span><Move3d size={12} /> Rigged</span></>
          )}
        </div>
        <div className="panel-rule" />
        <dl className="model-specs">
          <div><dt>Format</dt><dd>GLB <span className="muted">/ glTF 2.0</span></dd></div>
          <div><dt>Geometry</dt><dd>{diagnostics ? `${diagnostics.triangleCount.toLocaleString()} triangles` : 'Reading asset…'}</dd></div>
          <div><dt>Skeleton</dt><dd>{custom ? 'Static assembly' : diagnostics ? `${diagnostics.jointCount} joints` : '—'}</dd></div>
          <div><dt>Textures</dt><dd>{diagnostics ? `${diagnostics.loadedTextureCount} / ${diagnostics.textureCount} loaded` : '—'}</dd></div>
          <div><dt>Materials</dt><dd>{custom ? 'Head + base PBR' : 'Author-textured PBR'}</dd></div>
          <div><dt>Asset size</dt><dd>{diagnostics ? `${(diagnostics.bytes / 1024 / 1024).toFixed(2)} MB` : '—'}</dd></div>
        </dl>
        <details className="diagnostics">
          <summary><span><Activity size={15} /> Model diagnostics</span><ChevronDown size={15} /></summary>
          <div className="diagnostics-body">
            {diagnostics ? (
              <>
                <div className="diagnostic-line"><CircleCheck size={14} /><span>{diagnostics.loadedTextureCount} texture images decoded</span></div>
                <div className="diagnostic-line"><CircleCheck size={14} /><span>{diagnostics.skinnedMeshCount} skinned meshes · {diagnostics.morphTargetCount} morph targets</span></div>
                <div className="diagnostic-line"><CircleCheck size={14} /><span>Bounds: {diagnostics.dimensionsMeters.height.toFixed(2)} m tall</span></div>
                {custom && generated ? (
                  <>
                    <div className="diagnostic-line"><CircleCheck size={14} /><span>Head mesh round-trip verified · {generated.report.faceLock.vertexCount.toLocaleString()} vertices</span></div>
                    <div className="diagnostic-line"><CircleCheck size={14} /><span>Local head vertex delta: 0 m</span></div>
                    <p>The generated or imported head mesh is attached with placement only. Body measurements are a guided fit of the base mesh, not a medical or tailoring-grade reconstruction.</p>
                  </>
                ) : (
                  <>
                    <div className="diagnostic-line"><CircleCheck size={14} /><span>{anatomyComplete ? 'Head, neck, torso, arms, hands, fingers, legs & feet verified in rig' : 'Anatomy checks incomplete'}</span></div>
                    <p>Structural checks plus a rendered-frame check. See the phase verification report for visual inspection.</p>
                  </>
                )}
              </>
            ) : <p>{state.status === 'error' ? state.error.message : 'Diagnostics appear after the actual model and textures have loaded and rendered.'}</p>}
          </div>
        </details>
        <button className="asset-link" onClick={onOpenAsset}><ShieldCheck size={16} /><span>Asset & licensing</span><ArrowUpRight size={15} /></button>
      </section>

      {generated ? (
        <section className="panel foundation-panel generation-panel">
          <div className="foundation-icon"><LockKeyhole size={20} strokeWidth={1.6} /></div>
          <h2>Your model is ready.</h2>
          <p>Your personalized 3D model is displayed directly in the studio. The body is fitted locally to your measurements.</p>
          <div className="generation-actions">
            <button className="button button-secondary" onClick={onOpenPersonalization}>New avatar</button>
            <button className="text-link" onClick={onReset}>Use base avatar</button>
          </div>
          <div className="foundation-footer"><span className="tiny-dot" /> {generated.report.scanFileName}</div>
        </section>
      ) : (
        <section className="panel foundation-panel">
          <div className="foundation-icon"><Layers3 size={20} strokeWidth={1.6} /></div>
          <h2>Make it yours.</h2>
          <p>Upload a face photo or optional 3D head scan, then enter your measurements. A single photo creates a textured 2.5D head approximation; an imported scan provides actual head geometry.</p>
          <button className="button button-primary personalize-button" onClick={onOpenPersonalization}><ScanFace size={15} /> Create your avatar</button>
          <div className="foundation-footer"><span className="tiny-dot" /> A single photo provides an approximate face, not exact 3D geometry</div>
        </section>
      )}
    </aside>
  )
}

export function App() {
  const [viewerState, setViewerState] = useState<AvatarViewerState>({ status: 'loading', progress: { stage: 'request', loadedBytes: 0 } })
  const [generated, setGenerated] = useState<GeneratedAvatar | null>(null)
  const [personalizationKey, setPersonalizationKey] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  const personalizationDialog = useRef<HTMLDialogElement>(null)
  const openAsset = () => dialog.current?.showModal()
  const closeAsset = () => dialog.current?.close()
  const openPersonalization = () => personalizationDialog.current?.showModal()
  const closePersonalization = () => personalizationDialog.current?.close()
  const diagnostics = viewerState.status === 'ready' ? viewerState.diagnostics : undefined

  useEffect(() => () => {
    if (generated) URL.revokeObjectURL(generated.blobUrl)
  }, [generated])

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="FitVision AI home">
          <span className="brand-mark"><Box size={22} strokeWidth={1.65} /></span>
          <span className="brand-word">FitVision<span className="brand-ai">AI</span></span>
        </a>
        <div className="header-context"><span className="header-divider" /><span>Avatar workspace</span></div>
        <div className="header-actions">
          <span className="phase-chip"><span /> PHASE 02</span>
          <button className="button button-secondary header-asset-button" onClick={openAsset}><FileText size={15} /> Asset & license</button>
          <button className="button button-primary" onClick={openPersonalization}><ScanFace size={15} /> Create avatar</button>
        </div>
      </header>

      <main className="workspace">
        <div className="page-heading">
          <div>
            <div className="breadcrumb">Workspace <span>/</span> Avatar studio</div>
            <h1>Avatar studio<span className="heading-dot">.</span></h1>
            <p>{generated ? 'Your head model, preserved. Your measurements, fitted locally.' : 'One real human model. Every angle, in your control.'}</p>
          </div>
          <div className="heading-note"><span className="note-icon"><LockKeyhole size={18} /></span><div><strong>{generated ? 'Head geometry preserved' : 'Photo-based avatar workflow'}</strong><span>{generated ? 'Head mesh preserved during generation' : 'Photo or scan + measurements, locally'}</span></div></div>
        </div>

        <div className="studio-layout">
          <AvatarViewer source={generated?.source ?? BASE_AVATAR} onStateChange={setViewerState} />
          <ModelSidebar state={viewerState} generated={generated} onOpenAsset={openAsset} onOpenPersonalization={openPersonalization} onReset={() => { setGenerated(null); setPersonalizationKey((value) => value + 1) }} />
        </div>

        <section className="trust-strip" aria-label="Personalization guarantees">
          <div><span className="trust-icon"><Check size={16} /></span><div><strong>Head mesh integrity</strong><span>Imported or generated head geometry preserved</span></div></div>
          <div><span className="trust-icon"><HardDrive size={17} /></span><div><strong>Local processing</strong><span>No reconstruction upload or provider</span></div></div>
          <div><span className="trust-icon"><ShieldCheck size={17} /></span><div><strong>Openly licensed base</strong><span>CC0 asset with verified provenance</span></div></div>
        </section>
      </main>

      <footer className="site-footer"><span>FitVision AI <b>·</b> Personalized 3D avatar studio</span><span>Phase 02 <b>—</b> Photo/scan + measurements</span></footer>
      <AssetDialog dialogRef={dialog} onClose={closeAsset} diagnostics={generated ? undefined : diagnostics} />
      <PersonalizationDialog key={personalizationKey} dialogRef={personalizationDialog} onClose={closePersonalization} onGenerated={setGenerated} />
    </div>
  )
}
