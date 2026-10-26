# Reconstruction pipeline

## 1. Capture check (vision)
Each photo is analysed on a copy scaled to 1024 px: Laplacian variance (blur), mean brightness, contrast,
ORB keypoints (visible detail), resolution, and a 64-bit difference hash for near-duplicates (≤ 6 bits apart).
The dataset gets `good | fair | poor` plus concrete advice. **Overlap is not measured** here — only COLMAP's
feature matching can confirm it, and the UI says so.

## 2. COLMAP (recon, COLMAP 4.2.1)
All commands are argument lists (no shell), logged to `job.log`, each with a timeout (`STAGE_TIMEOUT_S`, 4 h).

| Stage | Command | Notes |
|---|---|---|
| feature_extraction | `feature_extractor` | `SIMPLE_RADIAL`; one camera when all photos share a resolution; GPU SIFT if available |
| feature_matching | `exhaustive_matcher` or `sequential_matcher` | guided matching |
| sparse_reconstruction | `mapper`, then `model_analyzer` per sub-model | largest model linked as `sparse/best`; < 3 registered images = failure |
| undistortion · dense_stereo · fusion | `image_undistorter`, `patch_match_stereo`, `stereo_fusion` | **only with CUDA** |
| (finalize) | `model_converter` → `sparse.ply`, `cameras.json` | camera centres, up and forward vectors |

Presets (`draft | balanced | high`): SIFT max image 1600/2400/3200 px, 4k/8k/16k features, PatchMatch
1000/1600/2400 px. Progress shown in the UI is parsed from COLMAP output ("Processed file [n/N]",
`num_reg_frames`, "Processing view n / N"); matching has no measurable progress in COLMAP 4, so only stage and
elapsed time are shown.

## 3. Meshing (geometry `/mesh`)
Statistical outlier removal (20 neighbours, 2σ) → filtered cloud saved as the viewable point-cloud asset
(raw COLMAP output kept) → normals oriented toward the cloud centre (captures are taken inside the space) →
screened Poisson (depth 8 sparse / 10 dense) → low-density trimming → crop to the data's bounds → nearest-point
vertex colours → GLB via trimesh, re-read to confirm face count.

## Measured results (this machine, CPU only)
Synthetic 6×3×5 m test room, 36 renders (`tests/fixtures/render-room`): 36/36 photos registered,
~27k sparse points, ~95k-triangle mesh, 80–90 s end to end with draft quality. Ten random-noise images fail at
`sparse_reconstruction` in ~4 s with capture advice.

## Limits
- Without a GPU the mesh comes from sparse points: holes and blobby surfaces (labelled "Low-detail mesh").
- Glass, mirrors, blank walls and moving objects reconstruct poorly.
- Normal orientation assumes inside-out captures; object scans taken from outside would get inverted normals.
- No texture baking: surfaces carry vertex colours.
