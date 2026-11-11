import { useEffect, useRef, useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import { ArrowUpRight, Check, FileUp, ImagePlus, LoaderCircle, LockKeyhole, ScanFace, ShieldCheck, TriangleAlert, X } from 'lucide-react'
import { generatePersonalAvatar } from '../personalization/generateAvatar'
import { MEASUREMENT_FIELDS, validateMeasurements } from '../personalization/measurements'
import { DEFAULT_ALIGNMENT, DEFAULT_MEASUREMENTS } from '../personalization/types'
import type { BodyMeasurements, GeneratedAvatar, GenerationProgress, ScanAlignment } from '../personalization/types'

interface Props {
  dialogRef: RefObject<HTMLDialogElement | null>
  onClose: () => void
  onGenerated: (avatar: GeneratedAvatar) => void
}

const ALIGNMENT_FIELDS: { key: keyof ScanAlignment; label: string; step: number; unit: string }[] = [
  { key: 'offsetXCm', label: 'Side offset', step: 0.5, unit: 'cm' },
  { key: 'offsetYCm', label: 'Height offset', step: 0.5, unit: 'cm' },
  { key: 'offsetZCm', label: 'Forward offset', step: 0.5, unit: 'cm' },
  { key: 'yawDeg', label: 'Yaw', step: 1, unit: '°' },
  { key: 'pitchDeg', label: 'Pitch', step: 1, unit: '°' },
  { key: 'rollDeg', label: 'Roll', step: 1, unit: '°' },
]

export function PersonalizationDialog({ dialogRef, onClose, onGenerated }: Props) {
  const [scanFile, setScanFile] = useState<File | null>(null)
  const [frontPhoto, setFrontPhoto] = useState<File | null>(null)
  const [sidePhoto, setSidePhoto] = useState<File | null>(null)
  const [frontPhotoUrl, setFrontPhotoUrl] = useState<string | null>(null)
  const [sidePhotoUrl, setSidePhotoUrl] = useState<string | null>(null)
  const [measurements, setMeasurements] = useState<BodyMeasurements>(DEFAULT_MEASUREMENTS)
  const [alignment, setAlignment] = useState<ScanAlignment>(DEFAULT_ALIGNMENT)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<GenerationProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GeneratedAvatar | null>(null)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => {
    if (frontPhotoUrl) URL.revokeObjectURL(frontPhotoUrl)
    if (sidePhotoUrl) URL.revokeObjectURL(sidePhotoUrl)
  }, [frontPhotoUrl, sidePhotoUrl])
  useEffect(() => () => { controller.current?.abort() }, [])

  const choosePhoto = (view: 'front' | 'side', file: File | null) => {
    const setFile = view === 'front' ? setFrontPhoto : setSidePhoto
    const setUrl = view === 'front' ? setFrontPhotoUrl : setSidePhotoUrl
    setFile(file)
    setUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return file ? URL.createObjectURL(file) : null
    })
  }

  const close = () => {
    if (busy) return
    onClose()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!scanFile && (!frontPhoto || !sidePhoto)) {
      setError('Upload both a front-facing photo and a side-profile photo. A true two-view reconstruction model must be installed before photo-only generation can run; this build will not fake a fitted face with a photo-textured sphere.')
      return
    }
    const measurementErrors = validateMeasurements(measurements)
    if (measurementErrors.length) {
      setError(measurementErrors.join(' '))
      return
    }
    setBusy(true)
    setResult(null)
    setProgress({ stage: 'reading-inputs', message: 'Starting local generation…' })
    controller.current = new AbortController()
    try {
      if (!scanFile) {
        throw new Error('Both photos were received, but the local 3D face-reconstruction engine is not bundled in this project yet. I have intentionally disabled the old pasted-photo head so it cannot be mistaken for a realistic reconstruction. Import a fitted head scan for now, or add a licensed local reconstruction engine to enable photo-only generation.')
      }
      const avatar = await generatePersonalAvatar({
        scanFile,
        referencePhoto: frontPhoto,
        measurements,
        alignment,
        signal: controller.current.signal,
        onProgress: setProgress,
      })
      setResult(avatar)
      onGenerated(avatar)
    } catch (cause) {
      if ((cause as Error)?.name !== 'AbortError') setError(cause instanceof Error ? cause.message : 'Generation failed.')
    } finally {
      setBusy(false)
      setProgress(null)
      controller.current = null
    }
  }

  const reset = () => {
    setResult(null)
    setError(null)
    setScanFile(null)
    choosePhoto('front', null)
    choosePhoto('side', null)
    setMeasurements(DEFAULT_MEASUREMENTS)
    setAlignment(DEFAULT_ALIGNMENT)
  }

  return (
    <dialog
      ref={dialogRef}
      className="asset-dialog personalization-dialog"
      aria-labelledby="personalization-title"
      onCancel={(event) => { if (busy) event.preventDefault() }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close()
      }}
    >
      <div className="dialog-heading">
        <div className="dialog-icon"><ScanFace size={22} /></div>
        <button className="icon-button" aria-label="Close personalization" disabled={busy} onClick={close}><X size={20} /></button>
      </div>
      <p className="eyebrow">LOCAL · PHOTO-BASED AVATAR</p>
      <h2 id="personalization-title">Create your own avatar</h2>
      <p className="dialog-intro">
        Upload front and side photos for the intended two-view face reconstruction workflow, or import an existing 3D head scan. Body proportions are adjusted using your measurements. Processing stays in this browser.
      </p>

      {result ? (
        <div className="generation-success" role="status">
          <div className="success-badge"><LockKeyhole size={18} /> Head geometry preserved</div>
          <p>
            Your 3D model has been generated and is ready to view in the studio. The generated head mesh was preserved during assembly. The imported scan supplies the head geometry; uploaded photos are references only.
          </p>
          <dl className="asset-facts">
            <div><dt>Head source</dt><dd>{result.report.scanFileName}</dd></div>
            <div><dt>Head meshes</dt><dd>{result.report.faceLock.meshCount} · {result.report.faceLock.vertexCount.toLocaleString()} vertices</dd></div>
            <div><dt>Photo input</dt><dd>{result.report.referencePhoto ? 'Front view stored as reference' : 'Not supplied'}</dd></div>
          </dl>
          <div className="checksum-block"><span>HEAD MESH POSITION SHA-256</span><code>{result.report.faceLock.positionSha256}</code></div>
          <div className="dialog-actions">
            <button className="button button-primary" onClick={close}><Check size={15} /> View in studio</button>
            <button className="text-link" onClick={reset}>Create another</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="personalization-form">
          <div className="upload-grid">
            <label className={`upload-card ${scanFile ? 'has-file' : ''}`}>
              <input type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" disabled={busy} onChange={(event) => setScanFile(event.target.files?.[0] ?? null)} />
              <FileUp size={20} />
              <strong>3D head scan <span className="optional">optional</span></strong>
              <span>{scanFile ? scanFile.name : 'Optional: self-contained GLB/glTF · Y-up · meters'}</span>
            </label>
            <label className={`upload-card ${frontPhoto ? 'has-file' : ''}`}>
              <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => choosePhoto('front', event.target.files?.[0] ?? null)} />
              {frontPhotoUrl ? <img className="photo-preview" src={frontPhotoUrl} alt="Front-view face photo preview" /> : <ImagePlus size={20} />}
              <strong>Front photo <span className="required">required</span></strong>
              <span>{frontPhoto ? frontPhoto.name : 'Face straight toward camera; neutral expression; minimum 320 × 320 px'}</span>
            </label>
            <label className={`upload-card ${sidePhoto ? 'has-file' : ''}`}>
              <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => choosePhoto('side', event.target.files?.[0] ?? null)} />
              {sidePhotoUrl ? <img className="photo-preview" src={sidePhotoUrl} alt="Side-profile face photo preview" /> : <ImagePlus size={20} />}
              <strong>Side profile <span className="required">required</span></strong>
              <span>{sidePhoto ? sidePhoto.name : 'True 90° profile; show forehead, nose, lips and chin'}</span>
            </label>
          </div>
          <p className="sample-link">Use two separate, sharp images of the same person: one straight-on and one exact side profile. Keep hair away from the face, use even lighting, and avoid filters. Photo-only reconstruction remains disabled until a compatible, properly licensed local model is installed; the old sphere-based photo trick has been removed from the generation path.</p>

          <fieldset disabled={busy}>
            <legend>Body measurements <span>centimeters</span></legend>
            <div className="measurement-grid">
              {MEASUREMENT_FIELDS.map((field) => (
                <label key={field.key}>
                  <span>{field.label}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={field.min}
                    max={field.max}
                    step={0.5}
                    value={measurements[field.key]}
                    onChange={(event) => setMeasurements((previous) => ({ ...previous, [field.key]: Number(event.target.value) }))}
                    aria-label={`${field.label} in centimeters`}
                  />
                  <small>{field.help}</small>
                </label>
              ))}
            </div>
          </fieldset>

          <details className="alignment-details">
            <summary>Scan placement <span>rigid alignment only · scale locked at 100%</span></summary>
            <div className="measurement-grid">
              {ALIGNMENT_FIELDS.map((field) => (
                <label key={field.key}>
                  <span>{field.label} ({field.unit})</span>
                  <input
                    type="number"
                    step={field.step}
                    disabled={busy}
                    value={alignment[field.key]}
                    onChange={(event) => setAlignment((previous) => ({ ...previous, [field.key]: Number(event.target.value) }))}
                    aria-label={`${field.label} in ${field.unit}`}
                  />
                </label>
              ))}
            </div>
            <p>These controls move/orient the generated or imported head as a whole. They do not reconstruct missing facial depth.</p>
          </details>

          <div className="privacy-note"><ShieldCheck size={16} /><span>Local-only workflow. Both photos remain in this browser. A genuine two-view reconstruction engine is not bundled yet, so photo-only generation is deliberately blocked rather than producing a misleading pasted-on head.</span></div>

          {error && <div className="form-error" role="alert"><TriangleAlert size={16} /><span>{error}</span></div>}
          {progress && <div className="generation-progress" role="status"><LoaderCircle size={16} className="spin" /><span>{progress.message}</span></div>}

          <div className="dialog-actions">
            <button className="button button-primary" type="submit" disabled={busy || (!scanFile && (!frontPhoto || !sidePhoto))}>
              {busy ? <LoaderCircle size={15} className="spin" /> : <LockKeyhole size={15} />}
              {busy ? 'Generating locally…' : scanFile ? 'Generate 3D avatar' : 'Photo engine not installed'}
            </button>
            <a className="text-link" href="/samples/README.txt" target="_blank" rel="noreferrer">Sample provenance <ArrowUpRight size={13} /></a>
          </div>
        </form>
      )}
    </dialog>
  )
}
