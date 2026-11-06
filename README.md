# FitVision AI — Phase 2: Local Exact-Face Avatar Studio

A small, testable React + TypeScript studio built on the Phase 1 realistic human-avatar foundation. Phase 2 adds the user-selected personalization workflow: **upload a 3D head scan + body measurements, generate a personal GLB locally, preview it in the same viewer, and download it**.

An optional reference photo can be attached, but it is **not** used to reconstruct or deform the face. Exact face preservation requires supplied 3D scan geometry; a single ordinary photo is not treated as an exact-face input.

## Run it

Requires Node.js **22.12+**.

```bash
npm ci
npm run dev
```

Open the printed local URL. The dev server binds to `0.0.0.0` and permits the Arena preview host. The model, sample scan and fonts are served locally; there is no runtime model CDN or reconstruction provider.

```bash
npm run typecheck     # TypeScript
npm test              # 39 unit tests
npm run asset:verify  # local base GLB integrity / embedded texture checks
npm run build         # production build
npm run test:e2e      # 8 real-browser tests (Chromium supplied through npm)
```

`test:e2e` starts or reuses the dev server on port 5173. Browser screenshots and the sample generated GLB are written to ignored `tests/artifacts/`.

## Phase 2 personalization

UI entry points: **Create avatar** in the header, or **Create your avatar** in the sidebar.

Inputs:

- **Required:** self-contained `.glb` / `.gltf` head/neck scan, Y-up, meters, static mesh, trimmed near the neck
- **Required:** height, chest, waist, hips, inseam and shoulder width in centimeters
- **Optional:** PNG/JPEG/WebP reference photo, stored only as a local reference and report entry
- **Optional:** rigid scan placement offsets/rotation; scale is locked at 100%

Local pipeline (`src/personalization/`):

1. Read files in the browser; no upload to a reconstruction service.
2. Load the licensed local base human through the existing avatar repository.
3. Validate the scan and reject external resource URLs, skinned/morphing scans, invalid bounds and non-glTF files.
4. Bake the imported body/clothing into static geometry, clip the base head/neck region, and fit only the body to the measurements.
5. Attach the supplied scan with rigid placement only. Individual face vertices are never edited.
6. Export a GLB locally with `GLTFExporter`.
7. Re-import the exported GLB and hash every scan mesh’s local positions and indices.
8. Return the personalized avatar only if the face-lock proof passes; otherwise show the actual error.

The generated model is previewed through the existing `AvatarViewer` as a custom `AvatarSource` blob URL with integrity metadata. The UI offers **Download GLB** and a JSON face-lock report.

### Face-lock proof

`src/personalization/faceLock.ts` fingerprints canonical local scan geometry before export and after GLB round trip. The proof records:

- scan mesh count, vertex count and triangle count
- combined position/index SHA-256 hashes
- `maxLocalVertexDeltaMeters: 0` only when the round-trip hashes match

This guarantees the supplied scan’s local face geometry was not changed by assembly/export. It does not claim photo-based likeness, and it does not make the body fit tailoring-grade.

### Demo scan

`public/samples/sample-head-scan.glb` is a real CC0 test scan extracted from the bundled MPFB base human. It is **not** a user likeness and is never used as a fallback.

- Size: `3,972,684` bytes
- SHA-256: `4262a9ffec97a1df3ad6c64657985ccd9127fd740e44ac3deb678fd85c130ab5`
- Extraction: actual base-body triangles with `y >= 1.49 m`, translated so the neck cut is at `y = 0`; no vertex deformation
- Regenerate:

```bash
npm run asset:prepare
npm run sample:prepare
```

## Phase 1 foundation retained

The viewer uses a complete, rigged **MPFB / MakeHuman** reference human, not spheres/capsules/mannequins/procedural anatomy.

- Upstream: `met4citizen/TalkingHead`, pinned commit `1563de184c19b310de4b636664d5835e2c74dbba`, path `avatars/mpfb.glb`
- Source SHA-256: `63c645a2a863b9972e9a9c2ed576a1de4c390b8475508e1473e69c87a3ee299c`
- License: the upstream author explicitly licenses **this particular `mpfb.glb` example** under **CC0 1.0**. Other TalkingHead example avatars have different licenses and are not used.
- Local asset: `public/models/base-avatar.glb`
- Local SHA-256: `5d89fbb4be9ed6dedcd66d799ae7e3ee7d7f78f0476c3c4eb1a7786c5154edff`
- Local size: `4,549,152` bytes (4.34 MiB)
- Geometry: 83,686 triangles, 8 meshes, 67 joints, 155 morph targets
- Textures: 7 embedded maps, decoded and verified at runtime
- Preparation: WebP texture encoding (max 2048×2048) + Meshopt compression; **no mesh simplification**
- Manifest: `public/models/base-avatar.manifest.json` and generated `src/avatar/asset-manifest.json`
- Asset license text: `public/models/CC0-LICENSE.txt`
- Font licenses: `public/licenses/FONT-LICENSES.txt`

The asset is already included. To regenerate it from the pinned source:

```bash
npm run asset:prepare
npm run asset:verify
```

The preparation script downloads through the GitHub blob API, verifies the source checksum and upstream CC0 attribution, then writes the optimized GLB and manifests. It uses `node --use-system-ca` for environments with a system trust store. If the public GitHub API is rate-limited, wait and retry; do **not** substitute a procedural placeholder.

## Viewer

`src/components/AvatarViewer.tsx` is the reusable component.

- Actual imported human geometry, head to feet
- Base avatar: relaxed neutral standing pose produced by rotating the asset’s existing arm bones; no geometry is synthesized
- Custom personalized avatar: authored/static assembled pose, loaded through the same repository/viewer boundary
- Measured bounds centering and automatic full-body camera framing, including resize and narrow viewports
- Three-point studio lighting, local environment softboxes, soft contact shadows
- Author-supplied skin/clothing/scan textures; matte dielectric tuning to avoid a plastic look
- Controls: **Front View**, **Side View**, **Back View**, **Rotate 360°**, **Zoom In**, **Zoom Out**, **Reset View**
- Smooth orbit/pan/zoom with damping; preset transitions clear orbit momentum so reset lands accurately

## Loading and error handling

Model loading is separate from rendering:

- `src/avatar/types.ts` — `AvatarSource`, `AvatarRepository`, diagnostics and viewer-state contracts
- `src/avatar/gltfAvatarRepository.ts` — fetch, byte progress, SHA-256/byte-length integrity, GLB/GLTF parsing, Meshopt decoding, texture/material/anatomy/bounds validation
- `src/avatar/useAvatar.ts` — cancellation, retry and GPU-resource lifetime
- `src/avatar/camera.ts` — pure framing math, unit-tested against projected body corners

The UI reports the actual failure: HTTP status, HTML fallback instead of a model, checksum mismatch, corrupt GLB, decoder/texture errors, incomplete base-human rig, invalid bounds, request timeout, or WebGL context loss. Controls stay disabled until the model has loaded **and rendered frames**. Retry re-fetches and reinitializes the viewer. There is no silent success and no fallback body.

## Verification

See:

- `docs/PHASE1_VERIFICATION.md`
- `docs/PHASE2_VERIFICATION.md`

The normal-load and personalization browser tests assert empty console error lists. React StrictMode may intentionally abort a duplicate development model request; that is cancellation, not a rendering failure.

## Honest limitations

- Exact face preservation applies to the supplied 3D scan geometry, not to a single photo.
- Body fitting is measurement-guided deformation of the imported base body, not medical/tailoring-grade reconstruction.
- The generated GLB is a static assembled avatar, not a newly rigged animation character.
- No clothing catalogue, clothing switching, cart, payments or virtual try-on is implemented yet.
