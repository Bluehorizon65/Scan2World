# Export formats

| Format | Contents | Typical use |
|---|---|---|
| GLB | binary glTF 2.0, vertex colours | browsers, Blender, Unreal (Interchange), Unity with glTFast |
| OBJ | positions, faces, vertex colours (extended `v x y z r g b`) | Unity/Blender native import |
| PLY | mesh with vertex colours | scanning / point-cloud tools |
| FBX | **not offered** — no validated exporter is bundled; convert the GLB in Blender | — |

A package (`package.zip`) contains `visual.*`, optionally `collision.*` and `walkable.*`, `manifest.json` and
`README.txt`. Every file is re-read after writing; `validation: ok` means it reloaded with the same face count.

`manifest.json`:
```json
{
  "generator": "Scan2World Studio",
  "createdAt": "…",
  "project": "Test room",
  "coordinateSystem": { "upAxis": "+Y", "handedness": "right", "units": "m", "scaleFactor": 0.5376 },
  "files": [{ "path": "visual.glb", "role": "visual", "format": "glb", "sizeBytes": …, "sha256": "…",
              "vertices": 48493, "triangles": 94455, "bbox": {"min": […], "max": […]}, "dimensions": [6.0, 3.12, 5.08],
              "validation": "ok" }],
  "notes": ["…engine notes…"]
}
```
`units` is `unitless` until a scale is set — then 1 unit is *not* 1 metre.

Engine notes: glTF is +Y up, right-handed; Unreal is +Z up (its importer converts axes — check orientation).
Use `collision.*` as a mesh collider. A browser-viewable GLB of a raw reconstruction is not a game-ready asset:
prepare it (level, scale, collision) first; the export page warns when you export an unprepared mesh.
