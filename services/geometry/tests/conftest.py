import numpy as np
import open3d as o3d
import pytest
import trimesh

ROOM = (6.0, 3.0, 5.0)  # x, y(up), z


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SERVICE_TOKEN", "secret")
    (tmp_path / "p").mkdir()
    return tmp_path


def room_points(n=60000, noise=0.01, seed=0, with_ceiling=True):
    """Points sampled on the inside surfaces of a 6x3x5 room with its floor at y=0, coloured per surface."""
    rng = np.random.default_rng(seed)
    w, h, d = ROOM
    faces = [  # (axis fixed, value, color)
        (1, 0.0, (0.6, 0.4, 0.2)),  # floor
        (0, -w / 2, (0.2, 0.5, 0.8)),
        (0, w / 2, (0.8, 0.2, 0.2)),
        (2, -d / 2, (0.2, 0.8, 0.3)),
        (2, d / 2, (0.9, 0.9, 0.2)),
    ] + ([(1, h, (0.7, 0.7, 0.7))] if with_ceiling else [])
    pts, cols = [], []
    per = n // len(faces)
    for axis, value, color in faces:
        p = np.column_stack([rng.uniform(-w / 2, w / 2, per), rng.uniform(0, h, per), rng.uniform(-d / 2, d / 2, per)])
        p[:, axis] = value
        pts.append(p + rng.normal(0, noise, p.shape))
        cols.append(np.tile(color, (per, 1)))
    return np.vstack(pts), np.vstack(cols)


def write_cloud(env, name, points, colors=None):
    pcd = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(points))
    if colors is not None:
        pcd.colors = o3d.utility.Vector3dVector(colors)
    o3d.io.write_point_cloud(str(env / "p" / name), pcd)
    return f"p/{name}"


def write_mesh(env, name, mesh: trimesh.Trimesh):
    mesh.export(env / "p" / name)
    return f"p/{name}"


def room_mesh(tilt_deg=0.0, offset=(0, 0, 0), seed=0) -> trimesh.Trimesh:
    """Open-top-free closed room shell (inward faces irrelevant for tests) plus a table, optionally tilted."""
    w, h, d = ROOM
    shell = trimesh.creation.box((w, h, d))
    shell.apply_translation((0, h / 2, 0))
    table = trimesh.creation.box((1.6, 0.75, 0.9))
    table.apply_translation((0.3, 0.375, -0.4))
    mesh = trimesh.util.concatenate([shell.subdivide().subdivide().subdivide(), table])
    rng = np.random.default_rng(seed)
    mesh.vertices += rng.normal(0, 0.003, mesh.vertices.shape)
    if tilt_deg:
        mesh.apply_transform(trimesh.transformations.rotation_matrix(np.radians(tilt_deg), (1, 0, 0.3)))
    mesh.apply_translation(offset)
    return mesh
