"""Per-image quality metrics and dataset-level capture advice.

Metrics are computed on a copy normalised to ANALYSIS_PX on the long side, so thresholds don't depend on
camera resolution. These are heuristics: they flag likely problems, they do not measure overlap.
"""

from concurrent.futures import ThreadPoolExecutor
from typing import Literal

import cv2
import numpy as np
from pydantic import BaseModel

from s2w_common.storage import resolve_key

ANALYSIS_PX = 1024
BLUR_MIN = 60.0  # Laplacian variance at 1024px
DARK_MAX = 45.0
BRIGHT_MIN = 215.0
CONTRAST_MIN = 22.0
FEATURES_MIN = 300  # ORB keypoints at 1024px
RESOLUTION_MIN = 640  # long side, original pixels
DUPLICATE_HAMMING = 6  # of 64 dHash bits
GOOD_COUNT, MIN_COUNT = 20, 8

_orb = cv2.ORB_create(nfeatures=2000)  # pyright: ignore[reportAttributeAccessIssue]  (missing from cv2 stubs)


class ImageReport(BaseModel):
    key: str
    readable: bool
    width: int = 0
    height: int = 0
    blur: float = 0
    brightness: float = 0
    contrast: float = 0
    keypoints: int = 0
    dhash: str = ""
    issues: list[str]


class DatasetReport(BaseModel):
    count: int
    usable: int
    duplicateGroups: list[list[str]]
    rating: Literal["good", "fair", "poor"]
    recommendations: list[str]
    notes: list[str]


def dhash(gray: np.ndarray) -> int:
    small = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
    bits = (small[:, 1:] > small[:, :-1]).flatten()
    return int("".join("1" if b else "0" for b in bits), 2)


def analyze_image(key: str) -> ImageReport:
    path = resolve_key(key)
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE) if path.is_file() else None
    if img is None or img.size == 0:
        return ImageReport(key=key, readable=False, issues=["unreadable"])
    h, w = img.shape
    scale = ANALYSIS_PX / max(h, w)
    norm = cv2.resize(
        img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR
    )

    blur = float(cv2.Laplacian(norm, cv2.CV_64F).var())
    brightness, contrast = float(norm.mean()), float(norm.std())
    keypoints = len(_orb.detect(norm, None))

    issues = []
    if blur < BLUR_MIN:
        issues.append("blurry")
    if brightness < DARK_MAX:
        issues.append("too_dark")
    if brightness > BRIGHT_MIN:
        issues.append("overexposed")
    if contrast < CONTRAST_MIN:
        issues.append("low_contrast")
    if keypoints < FEATURES_MIN:
        issues.append("few_features")
    if max(h, w) < RESOLUTION_MIN:
        issues.append("low_resolution")
    return ImageReport(
        key=key,
        readable=True,
        width=w,
        height=h,
        blur=round(blur, 1),
        brightness=round(brightness, 1),
        contrast=round(contrast, 1),
        keypoints=keypoints,
        dhash=f"{dhash(norm):016x}",
        issues=issues,
    )


def duplicate_groups(images: list[ImageReport]) -> list[list[str]]:
    # ponytail: O(n^2) pairwise compare; fine for a few hundred images, use a BK-tree beyond that.
    readable = [i for i in images if i.readable]
    hashes = [int(i.dhash, 16) for i in readable]
    seen: set[int] = set()
    groups = []
    for a in range(len(readable)):
        if a in seen:
            continue
        group = [
            b
            for b in range(a + 1, len(readable))
            if b not in seen and (hashes[a] ^ hashes[b]).bit_count() <= DUPLICATE_HAMMING
        ]
        if group:
            seen.update(group)
            groups.append([readable[a].key] + [readable[b].key for b in group])
    return groups


def summarize(images: list[ImageReport]) -> DatasetReport:
    count = len(images)
    serious = {"unreadable", "blurry", "few_features"}
    usable = sum(1 for i in images if not serious & set(i.issues))
    dups = duplicate_groups(images)
    dup_extra = sum(len(g) - 1 for g in dups)

    def n(issue: str) -> int:
        return sum(issue in i.issues for i in images)

    recs = []
    if usable < GOOD_COUNT:
        recs.append(
            f"Capture at least {GOOD_COUNT} sharp, overlapping photos (you have {usable} usable). "
            "30–80 photos give the most reliable room reconstructions."
        )
    if n("blurry"):
        recs.append(f"{n('blurry')} photo(s) look blurry — hold the camera steady or add light, then retake them.")
    if n("too_dark") or n("overexposed"):
        recs.append("Some photos are too dark or overexposed — use even lighting and avoid shooting into windows.")
    if n("few_features") or n("low_contrast"):
        recs.append(
            "Some photos show few distinct details (blank walls, glass, mirrors). "
            "Include textured objects in frame; reconstruction needs visible detail."
        )
    if dup_extra:
        recs.append(
            f"{dup_extra} photo(s) are near-duplicates — move 20–40 cm between shots instead of repeating views."
        )
    if n("unreadable"):
        recs.append(f"{n('unreadable')} file(s) could not be read and will be ignored.")
    if len({(i.width, i.height) for i in images if i.readable}) > 2:
        recs.append("Photos have mixed resolutions — use the same camera and zoom for the whole capture.")

    effective = usable - dup_extra
    bad_ratio = 1 - usable / count if count else 1
    if effective < MIN_COUNT or bad_ratio > 0.3:
        rating: Literal["good", "fair", "poor"] = "poor"
    elif effective < GOOD_COUNT or bad_ratio > 0.1:
        rating = "fair"
    else:
        rating = "good"
    return DatasetReport(
        count=count,
        usable=usable,
        duplicateGroups=dups,
        rating=rating,
        recommendations=recs,
        notes=[
            "Overlap between photos is not measured here; it is only confirmed when reconstruction "
            "matches features across images. Aim for ~60–80% overlap between neighbouring shots."
        ],
    )


def analyze_dataset(keys: list[str]) -> tuple[list[ImageReport], DatasetReport]:
    for k in keys:
        resolve_key(k)  # validate every key before doing any work
    with ThreadPoolExecutor(max_workers=4) as pool:
        images = list(pool.map(analyze_image, keys))
    return images, summarize(images)
