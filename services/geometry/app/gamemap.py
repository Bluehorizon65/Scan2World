"""Game-oriented derivatives of a mesh: visual mesh, simplified collision mesh, candidate walkable surface.

Walkability is a heuristic (upward-facing triangles near floor level) and is reported with a confidence;
it is not a navigation mesh.
"""

import json

import numpy as np
import trimesh
from pydantic import BaseModel, Field

from .io import load_mesh, output, save_mesh
from .ops import align_floor, remove_small_components, simplify

NAV_NOTE = (
    "Navigation mesh generation is not implemented. Use walkable.glb (or the visual mesh) as input to your "
    "engine's navmesh baker, e.g. Unity NavMesh or Unreal Recast."
)


class GamemapRequest(BaseModel):
    sourceKey: str
    outputPrefix: str
    collisionTargetTriangles: int = Field(default=5000, ge=100, le=500_000)
    maxSlopeDeg: float = Field(default=35, ge=1, le=60)
    align: bool = False  # false: the source is already floor-aligned (Y-up, floor at y=0)
    camerasKey: str | None = None
    scaled: bool = False


def walkable_surface(mesh: trimesh.Trimesh, max_slope_deg: float) -> tuple[trimesh.Trimesh | None, float]:
    up_facing = mesh.face_normals @ [0, 1, 0] >= np.cos(np.radians(max_slope_deg))
    if not up_facing.any():
        return None, 0.0
    heights = mesh.triangles_center[:, 1]
    floor_y = float(np.percentile(heights[up_facing], 5))
    tolerance = 0.05 * float(mesh.extents[1])
    mask = up_facing & (np.abs(heights - floor_y) <= tolerance)
    walk = mesh.copy()
    walk.update_faces(mask)
    walk.remove_unreferenced_vertices()
    if len(walk.faces) == 0:
        return None, floor_y
    walk, _ = remove_small_components(walk, 0.01)
    return walk, floor_y


def gamemap(req: GamemapRequest) -> dict:
    mesh = load_mesh(req.sourceKey)
    warnings, align_info = [], None
    if req.align:
        mesh, align_info = align_floor(mesh, req.camerasKey)
        if align_info["confidence"] == "low":
            warnings.append("Floor alignment has low confidence; check orientation in the viewer.")
    if not req.scaled:
        warnings.append("Scale is not set: dimensions are in reconstruction units, not metres.")

    collision, removed = remove_small_components(simplify(mesh, req.collisionTargetTriangles), 0.01)
    collision_valid = bool(
        len(collision.faces) > 0
        and collision.area > 0
        and np.isfinite(collision.vertices).all()
        and np.allclose(collision.extents, mesh.extents, rtol=0.05)
    )
    if not collision_valid:
        warnings.append("The simplified collision mesh deviates from the visual bounds; raise the triangle budget.")

    walk, floor_y = walkable_surface(mesh, req.maxSlopeDeg)
    footprint = float(mesh.extents[0] * mesh.extents[2]) or 1.0
    area = float(walk.area) if walk is not None else 0.0
    coverage = area / footprint
    aligned_ok = align_info is None or align_info["confidence"] != "low"
    confidence = "high" if coverage > 0.4 and aligned_ok else "medium" if coverage > 0.2 else "low"
    if walk is None:
        warnings.append("No walkable floor surface was found.")
    elif confidence == "low":
        warnings.append("Walkable area covers little of the footprint; the floor may be poorly reconstructed.")

    outputs = {
        "visual_glb": save_mesh(mesh, req.outputPrefix, "visual.glb"),
        "collision_glb": save_mesh(collision, req.outputPrefix, "collision.glb"),
    }
    if walk is not None:
        outputs["walkable_glb"] = save_mesh(walk, req.outputPrefix, "walkable.glb")
    report = {
        "alignment": align_info,
        "visual": {"triangles": len(mesh.faces), "dimensions": mesh.extents.round(4).tolist()},
        "collision": {
            "triangles": len(collision.faces),
            "valid": collision_valid,
            "removedComponents": removed,
            "targetTriangles": req.collisionTargetTriangles,
        },
        "walkable": {
            "areaUnits2": round(area, 4),
            "footprintUnits2": round(footprint, 4),
            "coverage": round(coverage, 4),
            "floorHeight": round(floor_y, 4),
            "maxSlopeDeg": req.maxSlopeDeg,
            "confidence": confidence,
            "triangles": len(walk.faces) if walk is not None else 0,
        },
        "navigation": {"status": "not_generated", "note": NAV_NOTE},
        "warnings": warnings,
    }
    report_path = output(req.outputPrefix, "gamemap_report.json")
    report_path.write_text(json.dumps(report, indent=2))
    outputs["report_json"] = f"{req.outputPrefix}/gamemap_report.json"
    return {"outputs": outputs, "report": report}
