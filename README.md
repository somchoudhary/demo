# FitVision AI — Phase 2: Local Photo-Based Avatar Studio

A React + TypeScript studio built on the Phase 1 human-avatar foundation. The personalization flow accepts front + side face photos or an optional 3D head scan, plus body measurements. The assembled model is generated locally, displayed inside the studio, and downloadable as GLB with a measurements JSON companion for the clothing fit-check flow.

**Photo-only mode reconstructs the head locally from two views:** the front photo produces a real detected 3D face mesh with the photo as its texture, and the side profile refines depth. The back of the head, ears and hair remain approximations — no method can recover true 3D depth that was never photographed. For the strongest likeness and real head shape, supply a proper 3D head scan.

## Run it

Requires Node.js **22.12+**.

```bash
npm ci
npm run dev
```

Open the printed local URL. The dev server binds to `0.0.0.0` and permits the Arena preview host. The model, sample scan and fonts are served locally; there is no runtime model CDN or reconstruction provider.

```bash
npm run typecheck     # TypeScript
npm test              # 51 unit tests
npm run asset:verify  # local base GLB integrity / embedded texture checks
npm run build         # production build
npm run test:e2e      # 9 real-browser tests (Chromium supplied through npm)
```

`test:e2e` starts or reuses the dev server on port 5173. Browser screenshots and the sample generated GLB are written to ignored `tests/artifacts/`.

## Phase 2 personalization

UI entry points: **Create avatar** in the header, or **Create your avatar** in the sidebar.

Inputs:

- **Required:** PNG/JPEG/WebP front + side-profile face photos when no scan is supplied (minimum 320 × 320 px each)
- **Optional:** self-contained `.glb` / `.gltf` head/neck scan, Y-up, meters, static mesh, trimmed near the neck; this takes priority over photo-based head generation
- **Required:** height, chest, waist, hips, inseam and shoulder width in centimeters
- **Optional:** front photo alongside a scan; stored locally as a reference
- **Optional:** rigid head placement offsets/rotation; scale is locked at 100%

Local pipeline (`src/personalization/`):

1. Read the photos/scan in the browser; no upload to a reconstruction service.
2. If no scan is supplied, detect the face in both photos with the bundled MediaPipe FaceMesh engine (`public/mediapipe/`, Apache-2.0), align/scale the real 3D face mesh, refine profile depth from the side view, texture it with the front photo, and complete the head with scalp, ears, hair and neck.
3. Load the licensed local base human and validate the reconstructed or imported head mesh.
4. Bake the imported body/clothing into static geometry, clip the base head/neck region, and fit only the body to the measurements.
5. Attach the generated or imported head with rigid placement only. Head vertices are not changed during assembly.
6. Export the assembled GLB for the in-app viewer, with **Download GLB** and **Measurements JSON** actions for the clothing fit-check flow.
7. Re-import the exported GLB and hash the head mesh positions and indices.
8. Return the personalized avatar only if the geometry round-trip check passes; otherwise show the actual error.

The generated model is previewed through the existing `AvatarViewer` as a custom `AvatarSource` blob URL with integrity metadata. The sidebar offers the GLB download plus a measurements JSON companion (target/achieved measurements, head provenance, export checksum) so the demo body can be used with garments from other platforms.

### Head-mesh integrity check

`src/personalization/faceLock.ts` fingerprints canonical local head geometry before export and after the internal GLB round trip. The proof records:

- scan mesh count, vertex count and triangle count
- combined position/index SHA-256 hashes
- `maxLocalVertexDeltaMeters: 0` only when the round-trip hashes match

This only verifies that the selected head mesh was not changed during assembly/export. It does not measure identity similarity or prove that a photo-derived head resembles the person accurately. For photo-only mode, the face mesh and texture come from the front photo with side-refined depth, but the back of the head, ears and hair are approximations.

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

- Two photos cannot capture true 3D depth that was never photographed; photo-only mode gives strong front likeness, but the back of the head, ears and hair are approximations.
- Face detection needs a clear, well-lit face filling most of the frame; it fails gracefully with guidance when no face is found.
- Body fitting is measurement-guided deformation of the imported base body, not medical/tailoring-grade reconstruction.
- The generated GLB is a static assembled avatar, not a newly rigged animation character.
- No clothing catalogue, clothing switching, cart or payments is implemented yet; garments from other platforms are tried on by pairing the downloaded GLB + measurements JSON with external tools.
