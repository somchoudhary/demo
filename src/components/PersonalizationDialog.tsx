import { useEffect, useRef, useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import { ArrowUpRight, Check, Download, FileText, FileUp, ImagePlus, LoaderCircle, LockKeyhole, ScanFace, ShieldCheck, TriangleAlert, X } from 'lucide-react'
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
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [measurements, setMeasurements] = useState<BodyMeasurements>(DEFAULT_MEASUREMENTS)
  const [alignment, setAlignment] = useState<ScanAlignment>(DEFAULT_ALIGNMENT)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<GenerationProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GeneratedAvatar | null>(null)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl) }, [photoUrl])
  useEffect(() => () => { controller.current?.abort() }, [])

  const choosePhoto = (file: File | null) => {
    setPhoto(file)
    setPhotoUrl((previous) => {
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
    if (!scanFile) {
      setError('Upload a 3D head scan first. A photo alone cannot guarantee exact face geometry.')
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
      const avatar = await generatePersonalAvatar({
        scanFile,
        referencePhoto: photo,
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
    choosePhoto(null)
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
      <p className="eyebrow">LOCAL · EXACT-FACE WORKFLOW</p>
      <h2 id="personalization-title">Create your own avatar</h2>
      <p className="dialog-intro">
        Your face comes from a supplied 3D head scan. The body is fitted to your measurements. Everything runs in this browser; no file is uploaded to a reconstruction service.
      </p>

      {result ? (
        <div className="generation-success" role="status">
          <div className="success-badge"><LockKeyhole size={18} /> Face lock verified</div>
          <p>
            The exported GLB was re-imported and every scan vertex hash matched. Local face vertex delta: <strong>0 m</strong>.
          </p>
          <dl className="asset-facts">
            <div><dt>Scan</dt><dd>{result.report.scanFileName}</dd></div>
            <div><dt>Face meshes</dt><dd>{result.report.faceLock.meshCount} · {result.report.faceLock.vertexCount.toLocaleString()} vertices</dd></div>
            <div><dt>Export</dt><dd>{(result.report.exportBytes / 1024 / 1024).toFixed(2)} MB GLB</dd></div>
            <div><dt>Reference photo</dt><dd>{result.report.referencePhoto ? 'Stored as reference only; not used for geometry' : 'Not supplied'}</dd></div>
          </dl>
          <div className="checksum-block"><span>FACE POSITION SHA-256</span><code>{result.report.faceLock.positionSha256}</code></div>
          <div className="dialog-actions">
            <button className="button button-primary" onClick={close}><Check size={15} /> View in studio</button>
            <a className="button button-secondary" href={result.blobUrl} download={result.fileName}><Download size={15} /> Download GLB</a>
            <a className="button button-secondary" href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(result.report, null, 2))}`} download="face-lock-report.json"><FileText size={15} /> Report</a>
            <button className="text-link" onClick={reset}>Create another</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="personalization-form">
          <div className="upload-grid">
            <label className={`upload-card ${scanFile ? 'has-file' : ''}`}>
              <input type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" disabled={busy} onChange={(event) => setScanFile(event.target.files?.[0] ?? null)} />
              <FileUp size={20} />
              <strong>3D head scan <span className="required">required</span></strong>
              <span>{scanFile ? scanFile.name : 'Self-contained GLB/glTF · Y-up · meters · trimmed at neck'}</span>
            </label>
            <label className={`upload-card ${photo ? 'has-file' : ''}`}>
              <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => choosePhoto(event.target.files?.[0] ?? null)} />
              {photoUrl ? <img className="photo-preview" src={photoUrl} alt="Reference photo preview" /> : <ImagePlus size={20} />}
              <strong>Reference photo <span className="optional">optional</span></strong>
              <span>{photo ? photo.name : 'Visual reference only. It is not used to deform or reconstruct the face.'}</span>
            </label>
          </div>
          <p className="sample-link">No scan handy? <a href="/samples/sample-head-scan.glb" download>Download the CC0 demo scan</a> to test the pipeline. It is not a user likeness.</p>

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
            <p>These controls move/orient the whole scan. They never edit individual face vertices.</p>
          </details>

          <div className="privacy-note"><ShieldCheck size={16} /><span>Local processing. The scan and photo stay in this tab. The generated GLB is created on your device.</span></div>

          {error && <div className="form-error" role="alert"><TriangleAlert size={16} /><span>{error}</span></div>}
          {progress && <div className="generation-progress" role="status"><LoaderCircle size={16} className="spin" /><span>{progress.message}</span></div>}

          <div className="dialog-actions">
            <button className="button button-primary" type="submit" disabled={busy || !scanFile}>
              {busy ? <LoaderCircle size={15} className="spin" /> : <LockKeyhole size={15} />}
              {busy ? 'Generating locally…' : 'Generate exact-face avatar'}
            </button>
            <a className="text-link" href="/samples/README.txt" target="_blank" rel="noreferrer">Sample provenance <ArrowUpRight size={13} /></a>
          </div>
        </form>
      )}
    </dialog>
  )
}
