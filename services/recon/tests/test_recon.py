import json
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import jobs, pipeline
from app.pipeline import Step, build_steps, parse_progress, parse_registered

H = {"X-Service-Token": "secret"}


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SERVICE_TOKEN", "secret")
    img_dir = tmp_path / "projects/p/uploads"
    img_dir.mkdir(parents=True)
    for i in range(3):
        (img_dir / f"{i}.jpg").write_bytes(b"\xff\xd8\xff")
    return tmp_path


def paths(tmp_path: Path) -> pipeline.Paths:
    return pipeline.Paths.for_prefix("projects/p/jobs/j1")


def flat(steps: list[Step]) -> list[str]:
    return [s.stage for s in steps]


def test_cpu_steps_are_sparse_only_with_gpu_disabled(env):
    steps = build_steps(paths(env), quality="draft", matcher="exhaustive", dense=True, gpu=False, threads=4)
    assert flat(steps) == ["feature_extraction", "feature_matching", "sparse_reconstruction"]
    extract = steps[0].argv
    assert extract[:2] == ["colmap", "feature_extractor"]
    assert all(isinstance(a, str) for s in steps for a in s.argv)
    assert extract[extract.index("--FeatureExtraction.use_gpu") + 1] == "0"
    assert extract[extract.index("--FeatureExtraction.max_image_size") + 1] == "1600"
    assert steps[1].argv[1] == "exhaustive_matcher"


def test_gpu_dense_steps_and_quality_presets(env):
    steps = build_steps(paths(env), quality="high", matcher="sequential", dense=True, gpu=True, threads=8)
    assert flat(steps) == [
        "feature_extraction",
        "feature_matching",
        "sparse_reconstruction",
        "undistortion",
        "dense_stereo",
        "fusion",
    ]
    assert steps[1].argv[1] == "sequential_matcher"
    pm = next(s for s in steps if s.stage == "dense_stereo").argv
    assert pm[pm.index("--PatchMatchStereo.max_image_size") + 1] == "2400"
    assert steps[0].argv[steps[0].argv.index("--FeatureExtraction.use_gpu") + 1] == "1"


def test_gpu_without_dense_request_skips_dense(env):
    steps = build_steps(paths(env), quality="balanced", matcher="exhaustive", dense=False, gpu=True, threads=8)
    assert "dense_stereo" not in flat(steps)


@pytest.mark.parametrize(
    "stage,line,expected",
    [
        ("feature_extraction", "I20261026 Processed file [12/30]", {"current": 12, "total": 30}),
        ("feature_matching", "Matching block [2/4, 1/4]", {"current": 2, "total": 4}),
        ("sparse_reconstruction", "Registering image #7 (num_reg_frames=9)", {"current": 9, "total": 30}),
        ("dense_stereo", "Processing view 5 / 30 for IMG_1.jpg", {"current": 5, "total": 30}),
        ("feature_extraction", "unrelated output", None),
    ],
)
def test_parse_progress(stage, line, expected):
    got = parse_progress(stage, line, total_images=30)
    if expected is None:
        assert got is None
    else:
        assert {"current": got["current"], "total": got["total"]} == expected
        assert got["label"]


def test_parse_registered():
    text = "Cameras: 1\nImages: 30\nRegistered images: 27\nPoints: 4521\n"
    assert parse_registered(text) == (27, 4521)
    assert parse_registered("nothing") == (0, 0)


def run_manager_with(monkeypatch, steps_factory):
    monkeypatch.setattr(jobs, "build_steps", lambda *a, **k: steps_factory())
    monkeypatch.setattr(
        jobs, "finalize", lambda p, total: ({"sparse_ply": "projects/p/jobs/j1/sparse.ply"}, {"registered_images": 3})
    )
    return jobs.JobManager(gpu=False)


def spec(**kw):
    base = {
        "imageKeys": [f"projects/p/uploads/{i}.jpg" for i in range(3)],
        "outputPrefix": "projects/p/jobs/j1",
        "quality": "draft",
        "matcher": "exhaustive",
        "dense": False,
    }
    return jobs.JobSpec(**{**base, **kw})


def wait(mgr, job_id, statuses, timeout=5):
    end = time.time() + timeout
    while time.time() < end:
        st = mgr.get(job_id)
        if st and st.status in statuses:
            return st
        time.sleep(0.05)
    raise AssertionError(f"stuck: {mgr.get(job_id)}")


def test_job_runs_steps_in_order_and_completes(env, monkeypatch):
    mgr = run_manager_with(
        monkeypatch,
        lambda: [
            Step("feature_extraction", ["sh", "-c", "echo 'Processed file [1/3]'"]),
            Step("feature_matching", ["sh", "-c", "echo matching"]),
            # COLMAP's mapper requires its output directory to already exist
            Step("feature_matching", ["test", "-d", str(env / "projects/p/jobs/j1/colmap/sparse")]),
        ],
    )
    mgr.submit("j1", spec())
    st = wait(mgr, "j1", {"completed", "failed"})
    assert st.status == "completed", st.error
    assert st.outputs == {"sparse_ply": "projects/p/jobs/j1/sparse.ply"}
    log = (env / "projects/p/jobs/j1/job.log").read_text()
    assert "Processed file [1/3]" in log and "$ sh -c" in log
    assert json.loads((env / "recon-jobs/j1.json").read_text())["status"] == "completed"
    mgr.shutdown()


def test_failing_step_maps_to_stage_error_with_advice(env, monkeypatch):
    mgr = run_manager_with(
        monkeypatch,
        lambda: [
            Step("feature_extraction", ["sh", "-c", "true"]),
            Step("sparse_reconstruction", ["sh", "-c", "echo boom >&2; exit 3"]),
        ],
    )
    mgr.submit("j1", spec())
    st = wait(mgr, "j1", {"completed", "failed"})
    assert st.status == "failed"
    assert st.error.code == "sparse_reconstruction_failed"
    assert st.error.advice
    assert "boom" not in st.error.message  # raw stderr stays in the log, not the user message
    mgr.shutdown()


def test_cancel_kills_the_process_group(env, monkeypatch):
    mgr = run_manager_with(monkeypatch, lambda: [Step("feature_extraction", ["sh", "-c", "sleep 60 & wait"])])
    mgr.submit("j1", spec())
    wait(mgr, "j1", {"running"})
    time.sleep(0.3)
    pid = mgr._procs["j1"].pid
    mgr.cancel("j1")
    st = wait(mgr, "j1", {"cancelled"})
    assert st.status == "cancelled"
    with pytest.raises(ProcessLookupError):
        os.killpg(pid, 0)
    mgr.shutdown()


def test_submit_is_idempotent_and_restart_marks_running_jobs_failed(env, monkeypatch):
    mgr = run_manager_with(monkeypatch, lambda: [Step("feature_extraction", ["sh", "-c", "sleep 60"])])
    first = mgr.submit("j1", spec())
    again = mgr.submit("j1", spec())
    assert again.created_at == first.created_at
    wait(mgr, "j1", {"running"})
    mgr.shutdown()  # simulates the container dying mid-job

    fresh = jobs.JobManager(gpu=False)
    st = fresh.get("j1")
    assert st.status == "failed"
    assert st.error.code == "service_restarted"
    fresh.shutdown()


def test_api_contract(env, monkeypatch):
    from app import main

    monkeypatch.setattr(main, "manager", run_manager_with(monkeypatch, lambda: [Step("feature_extraction", ["true"])]))
    c = TestClient(main.app)
    body = spec().model_dump()
    assert c.post("/jobs/j1", json=body, headers=H).status_code == 202
    assert c.get("/jobs/j1", headers=H).json()["id"] == "j1"
    assert c.get("/jobs/nope", headers=H).status_code == 404
    bad = {**body, "imageKeys": body["imageKeys"][:2] + ["../../etc/passwd"]}
    assert c.post("/jobs/j2", json=bad, headers=H).status_code == 400
    assert c.post("/jobs/bad id!", json=body, headers=H).status_code in (400, 404, 422)
    missing = {**body, "imageKeys": body["imageKeys"][:2] + ["projects/p/uploads/missing.jpg"]}
    assert c.post("/jobs/j3", json=missing, headers=H).json()["error"]["code"] == "invalid_input"
    info = c.get("/info", headers=H).json()
    assert info["gpu"] is False and "colmap" in info


def test_parse_images_txt_gives_centres_and_up_vectors():
    from app.pipeline import parse_images_txt

    # COLMAP cameras: x right, y down, z forward; pose is world->camera (q, t).
    text = (
        "# Image list with two lines of data per image:\n"
        "#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME\n"
        "1 1 0 0 0 0 0 0 1 a.jpg\n"
        "\n"
        "2 0.7071068 0.7071068 0 0 0 0 5 1 b.jpg\n"
        "100.0 200.0 -1\n"
    )
    cams = parse_images_txt(text)
    assert [c["name"] for c in cams] == ["a.jpg", "b.jpg"]
    assert cams[0]["center"] == pytest.approx([0, 0, 0])
    assert cams[0]["up"] == pytest.approx([0, -1, 0])
    # 90° about X: camera centre C = -R^T t
    assert cams[1]["center"] == pytest.approx([0, -5, 0], abs=1e-5)
    assert cams[1]["up"] == pytest.approx([0, 0, 1], abs=1e-5)
