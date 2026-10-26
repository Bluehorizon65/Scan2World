import json

import numpy as np
import trimesh
from conftest import ROOM, room_mesh, tilt_matrix, write_mesh
from fastapi.testclient import TestClient

from app.align import align_transform
from app.main import app

H = {"X-Service-Token": "secret"}
client = TestClient(app)


def post(path, body):
    r = client.post(path, json=body, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def floor_normal_error_deg(mesh: trimesh.Trimesh) -> float:
    """Angle between +Y and the area-weighted normal of the lowest, upward-facing faces."""
    low = mesh.triangles_center[:, 1] < mesh.bounds[0][1] + 0.05
    n = (mesh.face_normals[low] * mesh.area_faces[low, None]).sum(0)
    n /= np.linalg.norm(n)
    return float(np.degrees(np.arccos(np.clip(n @ [0, 1, 0], -1, 1))))


def test_align_floor_levels_a_tilted_offset_room_without_cameras(env):
    src = write_mesh(env, "tilted.glb", room_mesh(tilt_deg=20, offset=(3, -7, 2)))
    out = post("/process", {"sourceKey": src, "outputPrefix": "p/proc", "ops": [{"op": "align_floor"}]})
    mesh = trimesh.load(env / out["outputs"]["mesh_glb"], force="mesh")
    assert floor_normal_error_deg(mesh) < 2
    assert abs(mesh.bounds[0][1]) < 0.03  # floor at y=0
    assert np.allclose((mesh.bounds[0] + mesh.bounds[1])[[0, 2]] / 2, 0, atol=0.05)  # centred in XZ
    assert np.allclose(mesh.extents, (6, 3, 5), rtol=0.03)  # yaw-aligned: longest wall along X
    assert abs(out["report"]["steps"][0]["yawDeg"]) <= 90
    step = out["report"]["steps"][0]
    assert step["op"] == "align_floor" and step["method"] == "geometry" and step["confidence"] in ("medium", "high")


def test_align_uses_camera_up_vectors_when_given(env):
    tilt = tilt_matrix(35)
    src = write_mesh(env, "t.glb", room_mesh(tilt_deg=35))
    up = tilt[:3, :3] @ [0, 1, 0]
    cams = {
        "cameras": [
            {"center": (tilt[:3, :3] @ [x, 1.5, z]).tolist(), "up": up.tolist()} for x, z in [(1, 1), (-1, 1), (0, -1)]
        ]
    }
    (env / "p" / "cameras.json").write_text(json.dumps(cams))
    out = post(
        "/process",
        {"sourceKey": src, "outputPrefix": "p/proc2", "ops": [{"op": "align_floor"}], "camerasKey": "p/cameras.json"},
    )
    mesh = trimesh.load(env / out["outputs"]["mesh_glb"], force="mesh")
    assert floor_normal_error_deg(mesh) < 2
    assert out["report"]["steps"][0]["method"] == "cameras"
    assert out["report"]["steps"][0]["confidence"] == "high"


def test_align_reports_failure_when_no_floor_plane_exists(env):
    src = write_mesh(env, "sphere.glb", trimesh.creation.icosphere(4))
    r = client.post(
        "/process", json={"sourceKey": src, "outputPrefix": "p/x", "ops": [{"op": "align_floor"}]}, headers=H
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "floor_not_found"


def test_scale_simplify_and_component_cleanup_are_recorded_and_source_untouched(env):
    room = room_mesh()
    debris = trimesh.creation.icosphere(0, radius=0.05)  # 20 faces: < 1% of the room
    debris.apply_translation((10, 10, 10))
    src_mesh = trimesh.util.concatenate([room, debris])
    src = write_mesh(env, "src.glb", src_mesh)
    before = (env / src).read_bytes()
    ops = [
        {"op": "remove_small_components", "minFaceRatio": 0.01},
        {"op": "scale", "factor": 2.0},
        {"op": "simplify", "targetTriangles": 500},
    ]
    out = post("/process", {"sourceKey": src, "outputPrefix": "p/proc3", "ops": ops})
    mesh = trimesh.load(env / out["outputs"]["mesh_glb"], force="mesh")
    assert len(mesh.faces) <= 500
    assert np.allclose(sorted(mesh.extents), sorted(np.array(ROOM) * 2), rtol=0.05)  # debris gone, scaled x2
    steps = out["report"]["steps"]
    assert [s["op"] for s in steps] == ["remove_small_components", "scale", "simplify"]
    assert steps[0]["removedComponents"] == 1
    assert steps[2]["trianglesBefore"] > steps[2]["trianglesAfter"]
    assert (env / src).read_bytes() == before  # original is immutable


def test_unknown_op_is_rejected(env):
    src = write_mesh(env, "s.glb", room_mesh())
    r = client.post("/process", json={"sourceKey": src, "outputPrefix": "p/y", "ops": [{"op": "explode"}]}, headers=H)
    assert r.status_code == 422


def test_align_transform_is_a_proper_rigid_motion(env):
    pts = room_mesh(tilt_deg=15).sample(20000, seed=1)
    T, info = align_transform(pts, None)
    R = T[:3, :3]
    assert np.allclose(R @ R.T, np.eye(3), atol=1e-6)
    assert np.isclose(np.linalg.det(R), 1.0)
