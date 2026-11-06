import { useRef, useState } from 'react'
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
  Move3d,
  ScanFace,
  ShieldCheck,
  X,
} from 'lucide-react'
import { AvatarViewer } from './components/AvatarViewer'
import { ASSET_PROVENANCE, BASE_AVATAR } from './avatar/baseAvatar'
import type { AvatarDiagnostics, AvatarViewerState } from './avatar/types'

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
      <p className="dialog-intro">This studio renders a complete MPFB human character—not a body assembled from geometric primitives.</p>
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

function ModelSidebar({ state, onOpenAsset }: { state: AvatarViewerState; onOpenAsset: () => void }) {
  const diagnostics = state.status === 'ready' ? state.diagnostics : undefined
  const ready = state.status === 'ready'
  const statusLabel = ready ? 'Verified' : state.status === 'error' ? 'Unavailable' : 'Loading'
  const anatomyComplete = diagnostics ? Object.values(diagnostics.anatomy).every(Boolean) : false
  return (
    <aside className="sidebar" aria-label="Avatar information">
      <section className="panel model-panel">
        <div className="panel-eyebrow"><span>ACTIVE AVATAR</span><span className={`status-pill ${state.status}`}><i />{statusLabel}</span></div>
        <div className="avatar-identity">
          <div className="avatar-symbol"><ScanFace size={27} strokeWidth={1.45} /></div>
          <div><h2>Base avatar 01</h2><p>MPFB · Human reference</p></div>
        </div>
        <div className="identity-tags"><span><Box size={12} /> Real human mesh</span><span><Move3d size={12} /> Rigged</span></div>
        <div className="panel-rule" />
        <dl className="model-specs">
          <div><dt>Format</dt><dd>GLB <span className="muted">/ glTF 2.0</span></dd></div>
          <div><dt>Geometry</dt><dd>{diagnostics ? `${diagnostics.triangleCount.toLocaleString()} triangles` : 'Reading asset…'}</dd></div>
          <div><dt>Skeleton</dt><dd>{diagnostics ? `${diagnostics.jointCount} joints` : '—'}</dd></div>
          <div><dt>Textures</dt><dd>{diagnostics ? `${diagnostics.loadedTextureCount} / ${diagnostics.textureCount} loaded` : '—'}</dd></div>
          <div><dt>Materials</dt><dd>Author-textured PBR</dd></div>
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
                <div className="diagnostic-line"><CircleCheck size={14} /><span>{anatomyComplete ? 'Head, neck, torso, arms, hands, fingers, legs & feet verified in rig' : 'Anatomy checks incomplete'}</span></div>
                <p>Structural checks plus a rendered-frame check. See the phase verification report for visual inspection.</p>
              </>
            ) : <p>{state.status === 'error' ? state.error.message : 'Diagnostics appear after the actual model and textures have loaded and rendered.'}</p>}
          </div>
        </details>
        <button className="asset-link" onClick={onOpenAsset}><ShieldCheck size={16} /><span>Asset & licensing</span><ArrowUpRight size={15} /></button>
      </section>

      <section className="panel foundation-panel">
        <div className="foundation-icon"><Layers3 size={20} strokeWidth={1.6} /></div>
        <h2>A foundation, not a likeness.</h2>
        <p>This is the selected base human. Photo input, face reconstruction and body measurements are not connected in this phase.</p>
        <div className="foundation-footer"><span className="tiny-dot" /> Ready for a custom avatar source</div>
      </section>
    </aside>
  )
}

export function App() {
  const [viewerState, setViewerState] = useState<AvatarViewerState>({ status: 'loading', progress: { stage: 'request', loadedBytes: 0 } })
  const dialog = useRef<HTMLDialogElement>(null)
  const openAsset = () => dialog.current?.showModal()
  const closeAsset = () => dialog.current?.close()
  const diagnostics = viewerState.status === 'ready' ? viewerState.diagnostics : undefined

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="FitVision AI home">
          <span className="brand-mark"><Box size={22} strokeWidth={1.65} /></span>
          <span className="brand-word">FitVision<span className="brand-ai">AI</span></span>
        </a>
        <div className="header-context"><span className="header-divider" /><span>Avatar workspace</span></div>
        <div className="header-actions">
          <span className="phase-chip"><span /> PHASE 01</span>
          <button className="button button-secondary header-asset-button" onClick={openAsset}><FileText size={15} /> Asset & license</button>
        </div>
      </header>

      <main className="workspace">
        <div className="page-heading">
          <div>
            <div className="breadcrumb">Workspace <span>/</span> Avatar studio</div>
            <h1>Avatar studio<span className="heading-dot">.</span></h1>
            <p>One real human model. Every angle, in your control.</p>
          </div>
          <div className="heading-note"><span className="note-icon"><ScanFace size={18} /></span><div><strong>Human foundation</strong><span>Real geometry. Ready to explore.</span></div></div>
        </div>

        <div className="studio-layout">
          <AvatarViewer onStateChange={setViewerState} />
          <ModelSidebar state={viewerState} onOpenAsset={openAsset} />
        </div>

        <section className="trust-strip" aria-label="Foundation guarantees">
          <div><span className="trust-icon"><Check size={16} /></span><div><strong>Real human geometry</strong><span>Imported anatomy, never primitive shapes</span></div></div>
          <div><span className="trust-icon"><ShieldCheck size={17} /></span><div><strong>Openly licensed</strong><span>CC0 asset with verified provenance</span></div></div>
          <div><span className="trust-icon"><HardDrive size={17} /></span><div><strong>Locally hosted</strong><span>No third-party model CDN at runtime</span></div></div>
        </section>
      </main>

      <footer className="site-footer"><span>FitVision AI <b>·</b> Avatar foundation</span><span>Phase 01 <b>—</b> Built to be explored</span></footer>
      <AssetDialog dialogRef={dialog} onClose={closeAsset} diagnostics={diagnostics} />
    </div>
  )
}
