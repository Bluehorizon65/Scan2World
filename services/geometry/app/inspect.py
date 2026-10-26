import numpy as np
import trimesh

from .io import bbox, existing, is_point_cloud, load_cloud, load_mesh


def component_count(mesh: trimesh.Trimesh) -> int:
    labels = trimesh.graph.connected_component_labels(mesh.face_adjacency, node_count=len(mesh.faces))
    return int(labels.max()) + 1 if len(labels) else 0


def inspect(key: str) -> dict:
    path = existing(key)
    if is_point_cloud(path):
        pcd = load_cloud(key)
        pts = np.asarray(pcd.points)
        return {
            "kind": "point_cloud",
            "points": len(pts),
            "bbox": bbox(pts),
            "dimensions": (pts.max(0) - pts.min(0)).round(4).tolist(),
            "hasColors": pcd.has_colors(),
            "hasNormals": pcd.has_normals(),
        }
    mesh = load_mesh(key)
    return {
        "kind": "mesh",
        "vertices": len(mesh.vertices),
        "triangles": len(mesh.faces),
        "bbox": bbox(mesh.vertices),
        "dimensions": mesh.extents.round(4).tolist(),
        "components": component_count(mesh),
        "watertight": bool(mesh.is_watertight),
        "area": round(float(mesh.area), 4),
        "hasColors": mesh.visual.kind == "vertex",
        "hasUVs": mesh.visual.kind == "texture",
    }
