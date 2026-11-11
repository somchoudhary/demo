# Phase 2 — Photo-based avatar workflow (verification status)

Date: 2026-11-07

## Implemented in this revision

- The personalization dialog accepts a PNG, JPEG or WebP face photo when no 3D head scan is supplied.
- The browser creates a local 2.5D head proxy: generic ellipsoid geometry with a centered square crop of the uploaded photo projected onto the front surface.
- An optional user-supplied static GLB/glTF head scan takes priority over photo-derived geometry.
- Existing body measurement fitting is retained. It adjusts the imported base body only; it is not a medical or tailoring-grade measurement reconstruction.
- The assembled avatar is displayed in the existing in-app viewer. There is no generated-model download/export control.
- Photo and model processing remain in the browser; no reconstruction service is called.

## Important accuracy limits

A single photograph does not contain the hidden profile, true facial depth, rear head geometry, or reliable metric scale. This implementation does not run face detection, landmark fitting, photogrammetry, neural reconstruction, or identity similarity scoring. The photo-only head is therefore a visual 2.5D approximation, not an accurate personal 3D face. A real 3D head scan or multi-view reconstruction pipeline is required for accurate geometry.

The SHA-256 round-trip check verifies only that the selected head mesh's local vertex/index data survives the app's internal GLB assembly/export cycle. It does not verify that the mesh resembles the uploaded person.

## Verification status

The original Phase 2 scan-only implementation had a previous verification report. That report does not cover the photo-based code added in this revision. A fresh `npm run typecheck`, `npm test`, `npm run build`, and browser run could not be completed in the current environment because npm package installation could not reach the registry (DNS `EAI_AGAIN`). Treat this revision as source-edited but not build-verified.
