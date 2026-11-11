# Phase 2 — Photo-based avatar workflow (verification status)

Date: 2026-11-11

## Implemented in this revision

- The personalization dialog accepts PNG, JPEG or WebP front + side-profile photos when no 3D head scan is supplied.
- The browser reconstructs the head locally with the bundled MediaPipe FaceMesh engine (`public/mediapipe/`, Apache-2.0): a real detected 3D face mesh from the front photo, textured with that photo, with profile depth refined from the side view, plus approximated scalp, ears, hair and neck.
- An optional user-supplied static GLB/glTF head scan takes priority over photo-derived geometry.
- Existing body measurement fitting is retained. It adjusts the imported base body only; it is not a medical or tailoring-grade measurement reconstruction.
- The assembled avatar is displayed in the existing in-app viewer, with **Download GLB** and **Measurements JSON** actions for the clothing fit-check flow.
- Photo and model processing remain in the browser; no reconstruction service is called.

## Important accuracy limits

Two photographs cannot capture true 3D depth that was never photographed. The front view gives strong facial likeness (real mesh + photo texture), but the back of the head, ears and hair are approximations. This implementation does not run photogrammetry, neural reconstruction, or identity similarity scoring, so no 80–90% resemblance figure can be proven here — visual inspection of the generated avatar against the input photos is the honest test. A real 3D head scan remains the strongest-likeness input.

The SHA-256 round-trip check verifies only that the selected head mesh's local vertex/index data survives the app's internal GLB assembly/export cycle. It does not verify that the mesh resembles the uploaded person.

## Verification status

- `npm run typecheck` — passes.
- `npm test` — 51/51 unit tests pass, including 12 tests for the head-reconstruction math (mesh decoding, head-frame alignment incl. rotated poses, real-world scaling, profile depth ratio incl. clamping, aspect correction, triangle-winding self-check).
- `npm run build` — production build passes; the FaceMesh solution bundle is loaded at runtime from `/mediapipe` (it is a classic script with no ESM exports, so it is intentionally not bundled).
- `npm run asset:verify` — base-asset integrity check passes.
- `npm run test:e2e` — spec updated for the current UI (9 tests incl. GLB + measurements downloads); requires a real browser with WebGL and was not executed in this environment.
- Face detection + reconstruction run only in the browser; they need real front/side face photos and cannot be verified headlessly here. User testing with real photos is the remaining validation step.
