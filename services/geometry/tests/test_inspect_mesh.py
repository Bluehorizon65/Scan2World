import numpy as np
import trimesh
from conftest import ROOM, room_points, write_cloud, write_mesh
from fastapi.testclient import TestClient

from app.main import app

H = {"X-Service-Token": "secret"}
client = TestClient(app)


def post(path, body):
    return client.post(path, json=body, headers=H)


def test_inspect_mesh_reports_counts_and_dimensions(env):
    key = write_mesh(env, "box.glb", trimesh.creation.box((2, 3, 4)))
    r = post("/inspect", {"key": key}).json()
    assert r["kind"] == "mesh"
    assert r["triangles"] == 12
    assert np.allclose(r["dimensions"], [2, 3, 4])
    assert r["components"] == 1
    assert r["watertight"] is True


def test_inspect_point_cloud(env):
    pts, cols = room_points(6000)
    r = post("/inspect", {"key": write_cloud(env, "c.ply", pts, cols)}).json()
    assert r["kind"] == "point_cloud"
    assert r["points"] == len(pts)
    assert r["hasColors"] is True
    assert np.allclose(r["dimensions"], ROOM, atol=0.1)


def test_inspect_errors(env):
    assert post("/inspect", {"key": "../x.glb"}).status_code == 400
    assert post("/inspect", {"key": "p/missing.glb"}).json()["error"]["code"] == "not_found"
    (env / "p" / "bad.glb").write_bytes(b"glTF garbage")
    bad = post("/inspect", {"key": "p/bad.glb"})
    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "unreadable_geometry"


def test_mesh_from_room_cloud_produces_valid_colored_glb(env):
    pts, cols = room_points(60000)
    src = write_cloud(env, "sparse.ply", pts, cols)
    r = post("/mesh", {"sourceKey": src, "outputPrefix": "p/job", "dense": False})
    assert r.status_code == 200, r.text
    out = r.json()
    glb = env / out["outputs"]["mesh_glb"]
    mesh = trimesh.load(glb, force="mesh")
    assert len(mesh.faces) > 2000
    assert mesh.visual.kind == "vertex"
    assert np.allclose(mesh.extents, ROOM, rtol=0.12)
    assert out["stats"]["inputPoints"] == len(pts)
    assert out["stats"]["triangles"] == len(mesh.faces)


def test_mesh_rejects_too_few_points(env):
    pts, _ = room_points(60)
    r = post("/mesh", {"sourceKey": write_cloud(env, "tiny.ply", pts), "outputPrefix": "p/job", "dense": False})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "insufficient_points"
