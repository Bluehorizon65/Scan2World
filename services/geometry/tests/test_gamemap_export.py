import json
import zipfile

import numpy as np
import trimesh
from conftest import ROOM, room_mesh, write_mesh
from fastapi.testclient import TestClient

from app.main import app

H = {"X-Service-Token": "secret"}
client = TestClient(app)


def post(path, body, status=200):
    r = client.post(path, json=body, headers=H)
    assert r.status_code == status, r.text
    return r.json()


def test_gamemap_produces_separate_visual_collision_and_walkable(env):
    src = write_mesh(env, "aligned.glb", room_mesh())
    out = post(
        "/gamemap",
        {"sourceKey": src, "outputPrefix": "p/gm", "collisionTargetTriangles": 800, "maxSlopeDeg": 30, "align": False},
    )
    o = out["outputs"]
    assert set(o) == {"visual_glb", "collision_glb", "walkable_glb", "report_json"}
    assert len({o["visual_glb"], o["collision_glb"], o["walkable_glb"]}) == 3
    visual = trimesh.load(env / o["visual_glb"], force="mesh")
    collision = trimesh.load(env / o["collision_glb"], force="mesh")
    walk = trimesh.load(env / o["walkable_glb"], force="mesh")
    assert len(collision.faces) <= 800 < len(visual.faces)
    assert np.allclose(collision.extents, visual.extents, rtol=0.05)
    floor_area = ROOM[0] * ROOM[2]
    assert abs(walk.area - floor_area) / floor_area < 0.1  # table top (0.75 m up) is not floor-level
    assert walk.vertices[:, 1].max() < 0.2
    report = json.loads((env / o["report_json"]).read_text())
    assert report["walkable"]["areaUnits2"] > 0 and report["walkable"]["confidence"] in ("low", "medium", "high")
    assert report["navigation"]["status"] == "not_generated"
    assert report["collision"]["valid"] is True


def test_gamemap_with_align_levels_first(env):
    src = write_mesh(env, "tilted.glb", room_mesh(tilt_deg=25, offset=(1, 2, 3)))
    out = post(
        "/gamemap",
        {"sourceKey": src, "outputPrefix": "p/gm2", "collisionTargetTriangles": 800, "maxSlopeDeg": 30, "align": True},
    )
    walk = trimesh.load(env / out["outputs"]["walkable_glb"], force="mesh")
    assert abs(walk.area - ROOM[0] * ROOM[2]) / (ROOM[0] * ROOM[2]) < 0.1


def test_gamemap_on_geometry_without_floor_reports_low_confidence(env):
    sphere = trimesh.creation.icosphere(4)
    src = write_mesh(env, "sphere.glb", sphere)
    out = post(
        "/gamemap",
        {"sourceKey": src, "outputPrefix": "p/gm3", "collisionTargetTriangles": 200, "maxSlopeDeg": 30, "align": False},
    )
    report = json.loads((env / out["outputs"]["report_json"]).read_text())
    assert report["walkable"]["confidence"] == "low"
    assert report["warnings"]


def test_export_package_formats_manifest_and_validation(env):
    visual = write_mesh(env, "v.glb", room_mesh())
    coll = write_mesh(env, "c.glb", trimesh.creation.box((6, 3, 5)))
    out = post(
        "/export",
        {
            "sources": [{"key": visual, "role": "visual"}, {"key": coll, "role": "collision"}],
            "outputPrefix": "p/exp",
            "formats": ["glb", "obj", "ply"],
            "metadata": {"projectName": "Living room", "units": "m", "scaleFactor": 1.0, "upAxis": "+Y"},
        },
    )
    manifest = out["manifest"]
    files = {f["path"]: f for f in manifest["files"]}
    assert {"visual.glb", "visual.obj", "visual.ply", "collision.glb", "collision.obj", "collision.ply"} <= set(files)
    assert all(f["validation"] == "ok" for f in manifest["files"])
    assert files["visual.glb"]["triangles"] == len(trimesh.load(env / visual, force="mesh").faces)
    assert manifest["coordinateSystem"]["upAxis"] == "+Y"
    assert "FBX" in " ".join(manifest["notes"])
    with zipfile.ZipFile(env / out["outputs"]["package_zip"]) as z:
        names = set(z.namelist())
        assert {"manifest.json", "README.txt", "visual.glb", "visual.obj", "collision.obj"} <= names
        assert json.loads(z.read("manifest.json"))["files"]
        obj = trimesh.load(file_obj=trimesh.util.wrap_as_stream(z.read("visual.obj")), file_type="obj", force="mesh")
        assert len(obj.faces) == files["visual.obj"]["triangles"]


def test_export_rejects_unsupported_format(env):
    visual = write_mesh(env, "v.glb", room_mesh())
    r = client.post(
        "/export",
        json={
            "sources": [{"key": visual, "role": "visual"}],
            "outputPrefix": "p/e",
            "formats": ["fbx"],
            "metadata": {},
        },
        headers=H,
    )
    assert r.status_code == 422
