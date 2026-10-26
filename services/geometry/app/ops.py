"""Mesh operations shared by processing and game-map preparation. All return new meshes."""

import json

import numpy as np
import open3d as o3d
import trimesh
from trimesh.visual import ColorVisuals

from s2w_common.storage import resolve_key

from .align import align_transform

SAMPLE_POINTS = 60_000


def to_o3d(mesh: trimesh.Trimesh) -> o3d.geometry.TriangleMesh:
    m = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(mesh.vertices), o3d.utility.Vector3iVector(mesh.faces))
    if isinstance(mesh.visual, ColorVisuals) and mesh.visual.kind == "vertex":
        m.vertex_colors = o3d.utility.Vector3dVector(np.asarray(mesh.visual.vertex_colors)[:, :3] / 255.0)
    return m


def from_o3d(m: o3d.geometry.TriangleMesh) -> trimesh.Trimesh:
    out = trimesh.Trimesh(np.asarray(m.vertices), np.asarray(m.triangles), process=False)
    if m.has_vertex_colors():
        rgb = (np.clip(np.asarray(m.vertex_colors), 0, 1) * 255).astype(np.uint8)
        out.visual = ColorVisuals(out, vertex_colors=np.column_stack([rgb, np.full(len(rgb), 255, np.uint8)]))
    return out


def simplify(mesh: trimesh.Trimesh, target: int) -> trimesh.Trimesh:
    if len(mesh.faces) <= target:
        return mesh.copy()
    m = to_o3d(mesh).simplify_quadric_decimation(target_number_of_triangles=int(target))
    m.remove_degenerate_triangles()
    m.remove_unreferenced_vertices()
    return from_o3d(m)


def remove_small_components(mesh: trimesh.Trimesh, min_face_ratio: float) -> tuple[trimesh.Trimesh, int]:
    labels = trimesh.graph.connected_component_labels(mesh.face_adjacency, node_count=len(mesh.faces))
    counts = np.bincount(labels)
    keep = counts >= min_face_ratio * counts.max()
    out = mesh.copy()
    out.update_faces(keep[labels])
    out.remove_unreferenced_vertices()
    return out, int((~keep).sum())


def load_camera_ups(cameras_key: str | None) -> np.ndarray | None:
    if not cameras_key:
        return None
    path = resolve_key(cameras_key)
    if not path.is_file():
        return None
    cams = json.loads(path.read_text()).get("cameras", [])
    return np.array([c["up"] for c in cams], dtype=float) if cams else None


def align_floor(mesh: trimesh.Trimesh, cameras_key: str | None) -> tuple[trimesh.Trimesh, dict]:
    points = mesh.sample(SAMPLE_POINTS, seed=0) if len(mesh.faces) else mesh.vertices
    T, info = align_transform(np.asarray(points), load_camera_ups(cameras_key))
    out = mesh.copy()
    out.apply_transform(T)
    return out, {**info, "transform": np.round(T, 6).tolist()}
