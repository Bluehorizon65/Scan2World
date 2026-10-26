import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app

H = {"X-Service-Token": "secret"}


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SERVICE_TOKEN", "secret")
    (tmp_path / "p").mkdir()
    return tmp_path


def textured(seed: int, size=(768, 1024)) -> np.ndarray:
    rng = np.random.default_rng(seed)
    small = rng.integers(0, 255, (size[0] // 16, size[1] // 16, 3), dtype=np.uint8)
    img = cv2.resize(small, (size[1], size[0]), interpolation=cv2.INTER_NEAREST)
    for _ in range(40):
        c = tuple(int(x) for x in rng.integers(0, 255, 3))
        cv2.circle(img, (int(rng.integers(0, size[1])), int(rng.integers(0, size[0]))), int(rng.integers(5, 60)), c, -1)
    return img


def write(env, name, img):
    cv2.imwrite(str(env / "p" / name), img)
    return f"p/{name}"


def analyze(keys):
    return TestClient(app).post("/analyze", json={"keys": keys}, headers=H)


def test_blurred_image_scores_lower_and_is_flagged(env):
    sharp = write(env, "sharp.jpg", textured(1))
    blurry = write(env, "blurry.jpg", cv2.GaussianBlur(textured(1), (0, 0), 8))
    res = analyze([sharp, blurry]).json()
    a, b = res["images"]
    assert a["blur"] > 5 * b["blur"]
    assert "blurry" in b["issues"] and "blurry" not in a["issues"]


def test_near_identical_images_share_a_duplicate_group(env):
    img = textured(2)
    k1 = write(env, "a.jpg", img)
    k2 = write(env, "b.jpg", cv2.convertScaleAbs(img, alpha=1.0, beta=6))
    k3 = write(env, "c.jpg", textured(3))
    groups = analyze([k1, k2, k3]).json()["dataset"]["duplicateGroups"]
    assert groups == [[k1, k2]]


def test_unreadable_file_is_reported_not_raised(env):
    (env / "p" / "bad.jpg").write_bytes(b"\xff\xd8\xff garbage")
    res = analyze(["p/bad.jpg"])
    assert res.status_code == 200
    img = res.json()["images"][0]
    assert img["readable"] is False
    assert img["issues"] == ["unreadable"]


def test_dark_and_featureless_images_are_flagged(env):
    dark = write(env, "dark.png", (textured(4) * 0.08).astype(np.uint8))
    flat = write(env, "flat.png", np.full((768, 1024, 3), 128, np.uint8))
    a, b = analyze([dark, flat]).json()["images"]
    assert "too_dark" in a["issues"]
    assert "few_features" in b["issues"] and "low_contrast" in b["issues"]


def test_small_dataset_gets_poor_rating_and_count_advice(env):
    keys = [write(env, f"{i}.jpg", textured(10 + i)) for i in range(5)]
    ds = analyze(keys).json()["dataset"]
    assert ds["count"] == 5
    assert ds["rating"] == "poor"
    assert any("at least 20" in r for r in ds["recommendations"])
    assert any("overlap" in n.lower() for n in ds["notes"])


def test_good_dataset_rating(env):
    keys = [write(env, f"{i}.jpg", textured(100 + i)) for i in range(24)]
    ds = analyze(keys).json()["dataset"]
    assert ds["rating"] == "good"
    assert ds["usable"] == 24


def test_rejects_bad_keys_and_missing_files(env):
    assert analyze(["../etc/passwd"]).status_code == 400
    res = analyze(["p/missing.jpg"]).json()["images"][0]
    assert res["readable"] is False
