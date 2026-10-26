# Game-map pipeline

All steps write new assets; the source is never modified. Parameters and per-step results are stored in the
asset's `metadata.ops` / job `resultManifest`.

## Processing (`POST /assets/:id/process`)
| Op | What it does |
|---|---|
| `remove_small_components {minFaceRatio=0.01}` | drops connected parts smaller than the ratio × largest part |
| `align_floor` | levels the floor to y=0 with +Y up, walls aligned to X/Z, centred in XZ |
| `scale {factor}` | uniform scale; the UI derives the factor from one known real dimension |
| `simplify {targetTriangles}` | Open3D quadric decimation (keeps vertex colours) |

**Floor alignment.** Gravity hint = mean camera "up" from COLMAP (people hold cameras upright); without cameras,
the axis of least spread, with its sign chosen so that more geometry sits just above the floor than just
below the ceiling. RANSAC finds up to 6 planes; floor = lowest large plane within 25° of the hint. Then yaw
is aligned with the principal horizontal axis. Reported: method, confidence, floor inlier ratio, correction
angles. On the test room: proportions 1.98 : 1 : 1.68 vs truth 2 : 1 : 1.67; scaled result 6.00 × 3.12 × 5.08 m.

## Game-map assets (`POST /assets/:id/gamemap`)
- **Visual mesh**: the (aligned) source.
- **Collision mesh**: quadric-simplified to the triangle budget, small parts removed, validated as
  non-degenerate with bounds within 5% of the visual mesh. Not convex-decomposed.
- **Candidate walkable surface**: triangles facing up within `maxSlopeDeg` and within 5% of the vertical
  extent of floor level; islands < 1% removed. Confidence from coverage of the footprint (and alignment
  confidence): high > 40%, medium > 20%, else low.
- **Report** (`gamemap_report.json`): all of the above plus warnings (e.g. unscaled units).

## Not implemented
- **Navigation meshes** are not generated (`navigation.status = not_generated`). Use `walkable.glb` or the
  visual mesh with Unity NavMesh / Unreal Recast.
- Multi-level spaces: only the lowest floor is detected.
