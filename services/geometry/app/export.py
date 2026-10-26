"""Export packages: requested formats per role, each re-read to validate, plus manifest.json and README."""

import hashlib
import json
import time
import zipfile
from typing import Literal

import trimesh
from pydantic import BaseModel, Field

from s2w_common.storage import key_of

from .io import bbox, load_mesh, output

NOTES = [
    "Coordinate system: right-handed, +Y up (glTF convention). Unreal Engine is Z-up; its glTF/Interchange importer "
    "converts axes — verify orientation after import.",
    "Units: 1 unit = 1 metre only when a scale was set for the project; otherwise units are arbitrary "
    "reconstruction units (see coordinateSystem.units).",
    "Unity: OBJ imports natively; GLB needs a glTF importer package (e.g. glTFast). Use collision.* as a MeshCollider.",
    "Collision meshes are simplified for physics and separate from the visual mesh; they are not convex-decomposed.",
    "walkable.* is a candidate floor surface, not a navigation mesh; bake navigation in your engine.",
    "FBX is not generated: no validated FBX exporter is bundled. Convert the GLB in Blender if FBX is required.",
]


class ExportSource(BaseModel):
    key: str
    role: Literal["visual", "collision", "walkable"]


class ExportRequest(BaseModel):
    sources: list[ExportSource] = Field(min_length=1, max_length=3)
    outputPrefix: str
    formats: list[Literal["glb", "obj", "ply"]] = Field(min_length=1)
    metadata: dict = {}


def _sha256(path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def export(req: ExportRequest) -> dict:
    files = []
    for src in req.sources:
        mesh = load_mesh(src.key)
        for fmt in dict.fromkeys(req.formats):
            path = output(req.outputPrefix, f"package/{src.role}.{fmt}")
            mesh.export(path)
            try:
                check = trimesh.load(path, force="mesh", process=False)
                valid = isinstance(check, trimesh.Trimesh) and len(check.faces) == len(mesh.faces)
            except Exception:  # noqa: BLE001 - any read failure means the file is invalid
                valid = False
            files.append(
                {
                    "path": path.name,
                    "role": src.role,
                    "format": fmt,
                    "sizeBytes": path.stat().st_size,
                    "sha256": _sha256(path),
                    "vertices": len(mesh.vertices),
                    "triangles": len(mesh.faces),
                    "bbox": bbox(mesh.vertices),
                    "dimensions": mesh.extents.round(4).tolist(),
                    "validation": "ok" if valid else "failed",
                }
            )
            # OBJ may write a companion material file
            for extra in path.parent.glob(f"{src.role}*.mtl"):
                if all(f["path"] != extra.name for f in files):
                    files.append(
                        {
                            "path": extra.name,
                            "role": src.role,
                            "format": "mtl",
                            "sizeBytes": extra.stat().st_size,
                            "sha256": _sha256(extra),
                            "validation": "ok",
                        }
                    )

    meta = req.metadata
    manifest = {
        "generator": "Scan2World Studio",
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "project": meta.get("projectName"),
        "coordinateSystem": {
            "upAxis": "+Y",
            "handedness": "right",
            "units": meta.get("units", "unitless"),
            "scaleFactor": meta.get("scaleFactor"),
        },
        "files": files,
        "notes": NOTES,
    }
    pkg = output(req.outputPrefix, "package/manifest.json").parent
    (pkg / "manifest.json").write_text(json.dumps(manifest, indent=2))
    (pkg / "README.txt").write_text("Scan2World Studio export\n\n" + "\n".join(f"- {n}" for n in NOTES) + "\n")
    zip_path = output(req.outputPrefix, "package.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(pkg.iterdir()):
            z.write(f, f.name)
    return {
        "outputs": {"package_zip": key_of(zip_path), "manifest_json": key_of(pkg / "manifest.json")},
        "manifest": manifest,
    }
