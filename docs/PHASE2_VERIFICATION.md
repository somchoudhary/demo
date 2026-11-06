# Phase 2 verification — local exact-face avatar from scan + measurements

Date: 2026-11-06 (UTC)

## Scope

Implemented the user-selected workflow: **3D face/head scan + body measurements**, processed **locally in this project**. An optional reference photo can be attached, but it is explicitly not used to reconstruct or deform the face. A single photo is not accepted as an exact-face input.

## Environment

- Node.js 22.22.3, npm 10.9.8
- Vite 8.3.6, React 19.3.1, Three.js 0.180.0, React Three Fiber 9.8.2, Drei 10.7.9
- Real browser: headless Chromium 153 from `@sparticuz/chromium`, SwiftShader WebGL, Playwright 1.65
- Desktop viewport 1440×1000; mobile viewport 390×844
- App inspected while running, including the generated personalized avatar, not only source code

## Executed commands

```bash
npm run typecheck
npm test
npm run asset:verify
npm run build
npm run test:e2e
```

Results:

- TypeScript: passed
- Unit tests: **39 passed**
  - Phase 1 camera/loading tests: 26
  - Face-lock hashing/round-trip proof: 4
  - Measurement/alignment validation: 4
  - Body-fit mapping/cross-section: 3
  - Neck clipping: 2
- Asset verification: **PASS** — base GLB integrity, chunks, textures, rig, Meshopt metadata
- Production build: passed
- Browser tests: **8 passed**
  - Phase 1 viewer/error/mobile/license tests: 6
  - Local scan + measurements generation, face-lock proof, custom preview, GLB download, return to base: 1
  - Non-glTF scan rejection without fabricating a face: 1

## Exact-face guarantee exercised

The browser test uploads `public/samples/sample-head-scan.glb`, attaches a reference photo, enters height/chest measurements, and generates locally. The pipeline:

1. Reads the scan and optional photo in the browser; no reconstruction upload occurs.
2. Loads the licensed local base human.
3. Validates the scan as static, self-contained mesh geometry.
4. Fits only the imported body/clothing geometry to the measurements.
5. Attaches the scan with rigid placement only; scale is locked at 100%.
6. Exports a GLB locally.
7. Re-imports the exported GLB and compares SHA-256 fingerprints of every scan mesh’s local positions and indices.
8. Refuses to return a personalized avatar unless the face-lock proof passes.

Observed sample run:

- Scan mesh: `FaceScan_0`, 4,502 vertices, 8,570 triangles
- Local face vertex delta reported: **0 m**
- Generated GLB: 16,271,140 bytes, 25,694 triangles, 4/4 textures loaded
- Example generated GLB SHA-256: `d238255a4dedc005fe3a4085b4377e024f2ac3ea9dabe9793b4659021e161905`
- Reference photo report: stored as reference only; `usedForGeometry: false`
- Normal generation/preview test console error list: empty

## Visual evidence

Generated during the browser run (ignored by Git, available in the workspace):

- `tests/artifacts/personalization-success.png`
- `tests/artifacts/personalized-desktop.png`
- `tests/artifacts/personalized-front.png`
- `tests/artifacts/personalized.glb`
- Phase 1 artifacts remain: `final-desktop.png`, `front.png`, `side.png`, `back.png`, `reset.png`, `mobile.png`, `error-404.png`, `asset-dialog.png`

The personalized front/desktop captures were visually inspected. The generated avatar shows the supplied sample head attached to the measurement-fitted imported body, with clothing/feet intact and no floating/duplicated body parts.

## Honest limitations

- Exact face preservation applies to the supplied 3D scan geometry. The app does not infer exact face geometry from a photo.
- Body fitting is a measurement-guided deformation of the imported base body, not a medical/tailoring-grade body reconstruction.
- The generated GLB is a static assembled avatar, not a newly rigged animation character.
- The demo scan is CC0 sample geometry extracted from the base human; it is not a user likeness and is never substituted for a failed upload.
