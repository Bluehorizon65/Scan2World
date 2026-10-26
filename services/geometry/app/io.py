"""Loading/saving geometry by storage key, with user-safe errors."""

from pathlib import Path

import numpy as np
import open3d as o3d
import trimesh

from s2w_common.app import ServiceError
from s2w_common.storage import key_of, resolve_key


def existing(key: str) -> Path:
    path = resolve_key(key)
    if not path.is_file():
        raise ServiceError("not_found", f"File not found: {key}", status=404)
    return path


def is_point_cloud(path: Path) -> bool:
    """PLY files without faces are point clouds; GLB/OBJ are always meshes here."""
    if path.suffix.lower() != ".ply":
        return False
    with path.open("rb") as f:
        header = f.read(4096).split(b"end_header")[0]
    return b"element face" not in header or b"element face 0" in header


def load_mesh(key: str) -> trimesh.Trimesh:
    path = existing(key)
    try:
        mesh = trimesh.load(path, force="mesh", process=False)
    except Exception as e:  # trimesh raises many types for bad files
        raise ServiceError("unreadable_geometry", "The mesh file could not be read", status=422) from e
    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) == 0:
        raise ServiceError("unreadable_geometry", "The file contains no triangles", status=422)
    return mesh


def load_cloud(key: str) -> o3d.geometry.PointCloud:
    path = existing(key)
    pcd = o3d.io.read_point_cloud(str(path))  # pyright: ignore[reportArgumentType]
    if len(pcd.points) == 0:
        raise ServiceError("unreadable_geometry", "The point cloud is empty or unreadable", status=422)
    return pcd


def output(prefix: str, name: str) -> Path:
    path = resolve_key(f"{prefix}/{name}")
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def save_mesh(mesh: trimesh.Trimesh, prefix: str, name: str) -> str:
    """Write a mesh and prove it reloads with the same face count before reporting it."""
    path = output(prefix, name)
    mesh.export(path)
    check = trimesh.load(path, force="mesh", process=False)
    if not isinstance(check, trimesh.Trimesh) or len(check.faces) != len(mesh.faces):
        raise ServiceError("export_validation_failed", f"{name} did not reload correctly", status=500)
    return key_of(path)


def bbox(points: np.ndarray) -> dict:
    lo, hi = points.min(axis=0), points.max(axis=0)
    return {"min": lo.round(4).tolist(), "max": hi.round(4).tolist()}
