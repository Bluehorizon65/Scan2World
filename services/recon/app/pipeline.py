"""COLMAP command construction, output parsing and result selection. No subprocess execution here."""

import json
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from s2w_common.storage import key_of, resolve_key

Quality = Literal["draft", "balanced", "high"]
Matcher = Literal["exhaustive", "sequential"]

# max_image_size (px, long side) for SIFT / PatchMatch, and SIFT feature budget.
PRESETS: dict[str, dict[str, int]] = {
    "draft": {"sift_px": 1600, "features": 4096, "pm_px": 1000, "fusion_min_px": 3},
    "balanced": {"sift_px": 2400, "features": 8192, "pm_px": 1600, "fusion_min_px": 4},
    "high": {"sift_px": 3200, "features": 16384, "pm_px": 2400, "fusion_min_px": 5},
}

ADVICE: dict[str, tuple[str, list[str]]] = {
    "feature_extraction": (
        "Could not detect usable features in the photos.",
        ["Make sure photos are sharp and well lit.", "Include textured surfaces; blank walls give no features."],
    ),
    "feature_matching": (
        "Feature matching between photos failed.",
        ["Take photos with 60–80% overlap between neighbours.", "Use the same camera and zoom throughout."],
    ),
    "sparse_reconstruction": (
        "Camera poses could not be recovered — the photos did not connect into one model.",
        [
            "Capture in one continuous loop, moving 20–40 cm between shots.",
            "Add intermediate viewpoints where the scene changes a lot.",
            "Avoid photographing mostly mirrors, glass or plain walls.",
        ],
    ),
    "undistortion": ("Preparing images for dense reconstruction failed.", ["Retry; if it repeats, use draft quality."]),
    "dense_stereo": (
        "Dense depth estimation failed.",
        ["Try draft quality (smaller images use less GPU memory).", "Reduce the number of photos."],
    ),
    "fusion": ("Fusing depth maps into a point cloud failed.", ["Try draft quality or add more overlapping photos."]),
}


@dataclass(frozen=True)
class Step:
    stage: str
    argv: list[str]


@dataclass(frozen=True)
class Paths:
    prefix: str
    root: Path

    @classmethod
    def for_prefix(cls, prefix: str) -> "Paths":
        return cls(prefix, resolve_key(prefix))

    @property
    def work(self) -> Path:
        return self.root / "colmap"

    @property
    def images(self) -> Path:
        return self.work / "images"

    @property
    def database(self) -> Path:
        return self.work / "database.db"

    @property
    def sparse(self) -> Path:
        return self.work / "sparse"

    @property
    def dense(self) -> Path:
        return self.work / "dense"

    @property
    def log(self) -> Path:
        return self.root / "job.log"

    @property
    def sparse_ply(self) -> Path:
        return self.root / "sparse.ply"

    @property
    def dense_ply(self) -> Path:
        return self.root / "fused.ply"


def link_images(p: Paths, image_keys: list[str]) -> None:
    """COLMAP wants one directory of images; symlink the immutable uploads instead of copying."""
    p.images.mkdir(parents=True, exist_ok=True)
    for key in image_keys:
        src = resolve_key(key)
        dst = p.images / src.name
        if not dst.exists():
            dst.symlink_to(src)


def build_steps(
    p: Paths, *, quality: Quality, matcher: Matcher, dense: bool, gpu: bool, threads: int, single_camera: bool = True
) -> list[Step]:
    q = PRESETS[quality]
    use_gpu, t = ("1" if gpu else "0"), str(threads)
    db, imgs = str(p.database), str(p.images)
    steps = [
        Step(
            "feature_extraction",
            [
                "colmap",
                "feature_extractor",
                "--database_path",
                db,
                "--image_path",
                imgs,
                "--ImageReader.camera_model",
                "SIMPLE_RADIAL",
                "--ImageReader.single_camera",
                "1" if single_camera else "0",
                "--FeatureExtraction.max_image_size",
                str(q["sift_px"]),
                "--FeatureExtraction.use_gpu",
                use_gpu,
                "--FeatureExtraction.num_threads",
                t,
                "--SiftExtraction.max_num_features",
                str(q["features"]),
            ],
        ),
        Step(
            "feature_matching",
            [
                "colmap",
                f"{matcher}_matcher",
                "--database_path",
                db,
                "--FeatureMatching.use_gpu",
                use_gpu,
                "--FeatureMatching.num_threads",
                t,
                "--FeatureMatching.guided_matching",
                "1",
            ],
        ),
        Step(
            "sparse_reconstruction",
            [
                "colmap",
                "mapper",
                "--database_path",
                db,
                "--image_path",
                imgs,
                "--output_path",
                str(p.sparse),
                "--Mapper.num_threads",
                t,
            ],
        ),
    ]
    if dense and gpu:  # COLMAP PatchMatch stereo requires CUDA
        best = str(p.sparse / "best")
        steps += [
            Step(
                "undistortion",
                [
                    "colmap",
                    "image_undistorter",
                    "--image_path",
                    imgs,
                    "--input_path",
                    best,
                    "--output_path",
                    str(p.dense),
                    "--output_type",
                    "COLMAP",
                    "--max_image_size",
                    str(q["pm_px"]),
                ],
            ),
            Step(
                "dense_stereo",
                [
                    "colmap",
                    "patch_match_stereo",
                    "--workspace_path",
                    str(p.dense),
                    "--workspace_format",
                    "COLMAP",
                    "--PatchMatchStereo.max_image_size",
                    str(q["pm_px"]),
                    "--PatchMatchStereo.geom_consistency",
                    "1",
                ],
            ),
            Step(
                "fusion",
                [
                    "colmap",
                    "stereo_fusion",
                    "--workspace_path",
                    str(p.dense),
                    "--workspace_format",
                    "COLMAP",
                    "--input_type",
                    "geometric",
                    "--output_path",
                    str(p.dense_ply),
                    "--StereoFusion.min_num_pixels",
                    str(q["fusion_min_px"]),
                    "--StereoFusion.num_threads",
                    t,
                ],
            ),
        ]
    return steps


_PROGRESS = {
    "feature_extraction": (re.compile(r"Processed file \[(\d+)/(\d+)\]"), "Photos processed"),
    "feature_matching": (re.compile(r"Matching block \[(\d+)/(\d+)"), "Matching blocks"),
    "dense_stereo": (re.compile(r"Processing view (\d+) / (\d+)"), "Depth maps computed"),
}
_REGISTERED = re.compile(r"num_reg_frames=(\d+)|Registering image #\d+ \((\d+)\)")


def parse_progress(stage: str, line: str, total_images: int) -> dict | None:
    """Measured progress from a COLMAP log line, or None when the line carries none."""
    if stage == "sparse_reconstruction":
        m = _REGISTERED.search(line)
        if m:
            return {"label": "Images registered", "current": int(m.group(1) or m.group(2)), "total": total_images}
        return None
    rule = _PROGRESS.get(stage)
    if rule and (m := rule[0].search(line)):
        return {"label": rule[1], "current": int(m.group(1)), "total": int(m.group(2))}
    return None


def parse_registered(model_analyzer_output: str) -> tuple[int, int]:
    reg = re.search(r"Registered images:\s*(\d+)", model_analyzer_output)
    pts = re.search(r"Points:\s*(\d+)", model_analyzer_output)
    return (int(reg.group(1)) if reg else 0, int(pts.group(1)) if pts else 0)


def _quat_to_rot(qw: float, qx: float, qy: float, qz: float) -> list[list[float]]:
    return [
        [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
        [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
        [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
    ]


def parse_images_txt(text: str) -> list[dict]:
    """Camera centres and world-space up vectors from COLMAP images.txt (pose = world->camera, y axis down)."""
    lines = [ln for ln in text.splitlines() if not ln.startswith("#")]
    cams = []
    for line in lines[::2]:  # each image is followed by its 2D-points line (possibly empty)
        parts = line.split()
        if len(parts) < 10:
            continue
        qw, qx, qy, qz, tx, ty, tz = map(float, parts[1:8])
        r = _quat_to_rot(qw, qx, qy, qz)
        rt = [[r[j][i] for j in range(3)] for i in range(3)]  # R^T
        center = [-sum(rt[i][k] * t for k, t in enumerate((tx, ty, tz))) for i in range(3)]
        up = [-rt[i][1] for i in range(3)]
        forward = [rt[i][2] for i in range(3)]
        cams.append({"name": parts[9], "center": center, "up": up, "forward": forward})
    return cams


def export_cameras(model: Path, dest: Path) -> int:
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            ["colmap", "model_converter", "--input_path", str(model), "--output_path", tmp, "--output_type", "TXT"],
            check=True,
            capture_output=True,
            timeout=600,
        )
        cams = parse_images_txt((Path(tmp) / "images.txt").read_text())
    dest.write_text(json.dumps({"convention": "world frame of the reconstruction; up = camera -Y", "cameras": cams}))
    return len(cams)


def analyze_model(model: Path) -> tuple[int, int]:
    out = subprocess.run(
        ["colmap", "model_analyzer", "--path", str(model)], capture_output=True, text=True, timeout=300
    )
    return parse_registered(out.stdout + out.stderr)


def select_best_model(p: Paths) -> Path:
    """The mapper may produce several disconnected models (sparse/0, sparse/1, ...); link the largest as sparse/best."""
    models = sorted(d for d in p.sparse.iterdir() if d.is_dir() and d.name.isdigit()) if p.sparse.exists() else []
    scored = [(analyze_model(m)[0], m) for m in models]
    if not scored or max(scored)[0] < 3:
        raise RuntimeError("no usable sparse model")
    best = max(scored)[1]
    link = p.sparse / "best"
    if link.is_symlink() or link.exists():
        link.unlink()
    link.symlink_to(best.name)
    return best


def finalize(p: Paths, total_images: int) -> tuple[dict[str, str], dict]:
    """Convert results to PLY and summarise. Called after all steps have succeeded."""
    model = (p.sparse / "best").resolve()
    registered, points = analyze_model(model)
    subprocess.run(
        [
            "colmap",
            "model_converter",
            "--input_path",
            str(model),
            "--output_path",
            str(p.sparse_ply),
            "--output_type",
            "PLY",
        ],
        check=True,
        capture_output=True,
        timeout=600,
    )
    outputs = {"sparse_ply": key_of(p.sparse_ply)}
    if export_cameras(model, p.root / "cameras.json"):
        outputs["cameras_json"] = key_of(p.root / "cameras.json")
    if p.dense_ply.exists() and p.dense_ply.stat().st_size > 1024:
        outputs["dense_ply"] = key_of(p.dense_ply)
    stats = {
        "registered_images": registered,
        "total_images": total_images,
        "points3d": points,
        "models": sum(1 for d in p.sparse.iterdir() if d.name.isdigit()),
    }
    return outputs, stats
