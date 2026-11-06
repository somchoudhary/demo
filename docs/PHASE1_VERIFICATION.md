# Phase 1 verification — realistic 3D human avatar foundation

Date: 2026-11-06 (UTC)

## Environment

- Node.js 22.22.3, npm 10.9.8
- Vite 8.3.6, React 19.3.1, Three.js 0.180.0, React Three Fiber 9.8.2, Drei 10.7.9
- Real browser: headless Chromium 153 from `@sparticuz/chromium`, SwiftShader WebGL, driven by Playwright 1.65
- Desktop viewport 1440×1000; mobile viewport 390×844
- App inspected while running, not only in source

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
- Unit tests: **26 passed** (camera framing/projection, loading errors, integrity, cancellation, texture validation, rig relaxation)
- Asset verification: **PASS** — GLB v2 chunks, byte length, SHA-256, 7 embedded textures, rig and Meshopt metadata
- Production build: passed
- Browser tests: **6 passed**

## Required checklist

1. **Model loads successfully.** The viewer reaches `data-status="ready"` only after fetch, integrity verification, glTF parsing, texture decode, structural validation and three rendered frames.
2. **Full body visible.** Front/side/back and mobile screenshots show head through feet. Pure camera tests project all eight measured body corners inside the normalized viewport for 4 aspect ratios × 3 preset directions.
3. **Complete anatomy.** Runtime rig checks verify head, neck, torso, arms, hands, fingers, legs and feet. Visual inspection confirms a modeled face, neck, torso, arms, hands/fingers, legs and bare feet. The asset is an imported skinned human, not primitive geometry.
4. **Textures load.** Runtime diagnostics report **7/7** decoded embedded texture images. The local GLB verifier checks each embedded WebP payload. No missing texture request occurs in the normal-load test.
5. **Front / side / back work.** Browser tests click each preset and compare real canvas pixels; front↔side and side↔back differences exceed the test threshold.
6. **Rotation, zoom and reset work.** Auto-rotation changes rendered pixels and toggles state; pointer drag enters free orbit; zoom changes both the percentage and rendered pixels; reset returns to front/100% and matches the initial canvas capture within <1% pixel difference.
7. **No major console errors.** The normal-load test collects console errors/warnings and page errors and asserts the list is empty. Failure-path tests intentionally show visible UI errors for 404, HTML fallback and corrupt bytes, then verify retry/recovery where applicable.

## Asset identity

- Source: `met4citizen/TalkingHead@1563de184c19b310de4b636664d5835e2c74dbba`, `avatars/mpfb.glb`
- Source SHA-256: `63c645a2a863b9972e9a9c2ed576a1de4c390b8475508e1473e69c87a3ee299c`
- License: CC0 1.0 for this specific MPFB example, verified from the pinned upstream README attribution
- Local GLB: `public/models/base-avatar.glb`, 4,549,152 bytes
- Local SHA-256: `5d89fbb4be9ed6dedcd66d799ae7e3ee7d7f78f0476c3c4eb1a7786c5154edff`
- Geometry retained: 83,686 triangles, 8 meshes, 67 joints, 155 morph targets; no mesh simplification

## Visual evidence

Generated during the browser run (ignored by Git, available in the workspace):

- `tests/artifacts/final-desktop.png`
- `tests/artifacts/front.png`, `side.png`, `back.png`, `reset.png`
- `tests/artifacts/mobile.png`
- `tests/artifacts/error-404.png`
- `tests/artifacts/asset-dialog.png`

## Scope confirmation

Implemented: realistic imported human asset, reusable AvatarViewer, studio lighting/shadows, framing, loading/error handling, camera controls, personalization-ready loading boundary, tests and provenance.

Not implemented: clothing catalogue, clothing switching, shopping cart, payments, photo-based reconstruction, fake AI generation, or try-on.
