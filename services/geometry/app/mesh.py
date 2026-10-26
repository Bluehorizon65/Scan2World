"""Point cloud -> coloured triangle mesh (Open3D screened Poisson), exported as GLB."""

import numpy as np
import open3d as o3d
import trimesh
from scipy.spatial import KDTree
from trimesh.visual import ColorVisuals

from s2w_common.app import ServiceError

from .io import load_cloud, save_mesh

MIN_POINTS = 500
MAX_POINTS = 1_500_000  # downsample beyond this to bound memory/time


def mesh_from_cloud(source_key: str, prefix: str, dense: bool) -> dict:
    pcd = load_cloud(source_key)
    n_in = len(pcd.points)
    if n_in < MIN_POINTS:
        raise ServiceError(
            "insufficient_points",
            f"Only {n_in} points were reconstructed; at least {MIN_POINTS} are "
            "needed to build a surface. Add more overlapping photos.",
            status=422,
        )

    pcd, _ = pcd.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)
    if len(pcd.points) > MAX_POINTS:
        pts = np.asarray(pcd.points)
        voxel = float(np.linalg.norm(pts.max(0) - pts.min(0))) / 1500
        pcd = pcd.voxel_down_sample(voxel)

    pts = np.asarray(pcd.points)
    if not pcd.has_normals() or not np.any(np.asarray(pcd.normals)):
        pcd.estimate_normals(o3d.geometry.KDTreeSearchParamKNN(30))
    # Captures are taken from inside the space, so surfaces face the interior: orient normals toward the centre.
    pcd.orient_normals_towards_camera_location(pts.mean(axis=0))

    depth = 10 if dense else 8
    mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(pcd, depth=depth, scale=1.05)
    densities = np.asarray(densities)
    mesh.remove_vertices_by_mask(densities < np.quantile(densities, 0.02 if dense else 0.08))
    # Poisson extrapolates beyond the data; keep only the region the points support.
    aabb = pcd.get_axis_aligned_bounding_box()
    mesh = mesh.crop(aabb.scale(1.02, aabb.get_center()))  # pyright: ignore[reportCallIssue, reportArgumentType]
    mesh.remove_degenerate_triangles()
    mesh.remove_unreferenced_vertices()

    verts, faces = np.asarray(mesh.vertices), np.asarray(mesh.triangles)
    if len(faces) == 0:
        raise ServiceError("meshing_failed", "No surface could be built from the reconstructed points.", status=422)
    out = trimesh.Trimesh(verts, faces, process=False)
    if pcd.has_colors():
        _, idx = KDTree(pts).query(verts, k=1, workers=-1)
        colors = (np.asarray(pcd.colors)[idx] * 255).astype(np.uint8)
        out.visual = ColorVisuals(out, vertex_colors=np.column_stack([colors, np.full(len(colors), 255, np.uint8)]))

    key = save_mesh(out, prefix, "mesh.glb")
    return {
        "outputs": {"mesh_glb": key},
        "stats": {
            "method": "poisson",
            "depth": depth,
            "inputPoints": n_in,
            "pointsUsed": len(pts),
            "vertices": len(verts),
            "triangles": len(faces),
        },
    }
