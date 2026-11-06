sample-head-scan.glb is a CC0 demo/test head scan extracted from the bundled MPFB reference human (public/models/base-avatar.glb, upstream met4citizen/TalkingHead avatars/mpfb.glb at commit 1563de184c19b310de4b636664d5835e2c74dbba). It is not a user face, not a reconstruction result, and never used as a fallback.

Extraction: actual base-body triangles with y >= 1.49 m, translated so the neck cut is at y=0. No vertex deformation. Regenerate with `npm run asset:prepare` then `npm run sample:prepare`.
