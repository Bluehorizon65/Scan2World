"""Builds the landing-page sample (apps/web/public/sample) from a real reconstruction job.

Run inside the geometry container (has Open3D/trimesh), pointing at a completed reconstruction job prefix:
  docker compose exec -T geometry python - projects/<pid>/jobs/<jobId> < infrastructure/scripts/make-landing-sample.py
Outputs to /data/landing-sample; copy out with `docker compose cp geometry:/data/landing-sample/. apps/web/public/sample/`.
"""

import json
import sys

import numpy as np
import open3d as o3d
import trimesh

sys.path.insert(0, "/srv/geometry")
from app.ops import align_floor, load_camera_ups, simplify  # noqa: E402
from s2w_common.storage import data_dir, resolve_key  # noqa: E402

prefix = sys.argv[1]
out = data_dir() / "landing-sample"
out.mkdir(exist_ok=True)

mesh = trimesh.load(resolve_key(f"{prefix}/mesh.glb"), force="mesh", process=False)
aligned, info = align_floor(mesh, f"{prefix}/cameras.json")
T = np.array(info["transform"])
s = 6.0 / aligned.extents.max()  # present the sample at a nominal 6 m width for the viewer
S = np.diag([s, s, s, 1.0]) @ T

visual = simplify(mesh, 40_000)
visual.apply_transform(S)
visual.export(out / "mesh.glb")
collision = simplify(mesh, 1_500)
collision.apply_transform(S)
collision.export(out / "collision.glb")

pcd = o3d.io.read_point_cloud(str(resolve_key(f"{prefix}/sparse.ply")))
pts = np.asarray(pcd.points) @ S[:3, :3].T + S[:3, 3]
cols = (np.asarray(pcd.colors) * 255).astype(np.uint8)
(out / "points.json").write_text(json.dumps({"positions": np.round(pts, 3).flatten().tolist(), "colors": cols.flatten().tolist()}))

cams = json.loads(resolve_key(f"{prefix}/cameras.json").read_text())["cameras"]
cam_out = [{"center": (S[:3, :3] @ np.array(c["center"]) + S[:3, 3]).round(3).tolist(),
            "up": (T[:3, :3] @ np.array(c["up"])).round(4).tolist(),
            "forward": (T[:3, :3] @ np.array(c.get("forward", [0, 0, 1]))).round(4).tolist()} for c in cams]
(out / "cameras.json").write_text(json.dumps({"cameras": cam_out}))
print(json.dumps({"triangles": len(visual.faces), "collision": len(collision.faces), "points": len(pts),
                  "cameras": len(cam_out), "align": info["method"], "upSamples": len(load_camera_ups(f"{prefix}/cameras.json"))}))
