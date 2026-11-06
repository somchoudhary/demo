# FitVision AI — Phase 1: Realistic 3D Human Avatar Foundation

A small, testable React + TypeScript studio that renders an actual imported human GLB. This phase intentionally contains **only** the avatar foundation: no clothing catalogue, clothing switching, cart, payments, photo upload, face reconstruction, or virtual try-on.

## What existed before

The checkout contained only a one-line `README.md`. There was no React app, 3D viewer, avatar component, dependency manifest, or human model to reuse. Phase 1 therefore adds a minimal Vite/React app around a locally hosted asset instead of rebuilding any existing website.

## Run it

Requires Node.js **22.12+**.

```bash
npm ci
npm run dev
```

Open the printed local URL. The dev server binds to `0.0.0.0` and permits the Arena preview host. The model and fonts are served locally; there is no runtime model CDN.

```bash
npm run typecheck     # TypeScript
npm test              # 26 unit tests
npm run asset:verify  # local GLB integrity / embedded texture checks
npm run build         # production build
npm run test:e2e      # 6 real-browser tests (Chromium supplied through npm)
```

`test:e2e` starts or reuses the dev server on port 5173. Browser screenshots are written to ignored `tests/artifacts/`.

## The human asset

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

- Actual imported skinned human, head to feet
- Relaxed neutral standing pose produced by rotating the asset’s existing arm bones (`src/avatar/neutralPose.ts`); no geometry is synthesized
- Measured bounds centering and automatic full-body camera framing, including resize and narrow viewports
- Three-point studio lighting, local environment softboxes, soft contact shadows
- Author-supplied skin/hair/clothing/eye textures; matte dielectric tuning to avoid a plastic look
- Clean neutral background
- Controls: **Front View**, **Side View**, **Back View**, **Rotate 360°**, **Zoom In**, **Zoom Out**, **Reset View**
- Smooth orbit/pan/zoom with damping; preset transitions clear orbit momentum so reset lands accurately

## Loading and error handling

Model loading is separate from rendering:

- `src/avatar/types.ts` — `AvatarSource`, `AvatarRepository`, diagnostics and viewer-state contracts
- `src/avatar/gltfAvatarRepository.ts` — fetch, byte progress, SHA-256/byte-length integrity, GLB/GLTF parsing, Meshopt decoding, texture/material/anatomy/bounds validation
- `src/avatar/useAvatar.ts` — cancellation, retry and GPU-resource lifetime
- `src/avatar/camera.ts` — pure framing math, unit-tested against projected body corners

The UI reports the actual failure: HTTP status, HTML fallback instead of a model, checksum mismatch, corrupt GLB, decoder/texture errors, incomplete base-human rig, invalid bounds, request timeout, or WebGL context loss. Controls stay disabled until the model has loaded **and rendered frames**. Retry re-fetches and reinitializes the viewer. There is no silent success and no fallback body.

## Personalization boundary (not implemented yet)

A future photo-input, face-reconstruction, body-measurement, or custom-avatar service can implement/produce an `AvatarSource` and pass it to the same repository/viewer boundary. Custom sources keep their authored pose unless they opt into the known MPFB neutral-pose convention, and they are not forced through the base asset’s specific rig checks. Optional integrity metadata can pin custom bytes.

This phase does not pretend the base avatar resembles a user. No fake AI, face recognition, or measurement adjustment is present.

## Verification

See `docs/PHASE1_VERIFICATION.md` for the executed checks and observed results. The normal-load browser test asserts an empty console error/warning list. React StrictMode may intentionally abort a duplicate development model request; that is cancellation, not a rendering failure.
