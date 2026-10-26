"""Floor detection and levelling: rotate so the floor normal is +Y, floor at y=0, centred in XZ.

Gravity hint: the mean camera "up" vector when camera poses are available (people hold cameras upright),
otherwise the axis of least spread (rooms are usually wider than they are tall). The hint is then refined
by RANSAC plane fitting; the floor is the lowest large plane roughly perpendicular to the hint.
"""

import numpy as np
import open3d as o3d
import trimesh

from s2w_common.app import ServiceError

MAX_TILT_DEG = 25  # a plane this far from the gravity hint is not considered a floor candidate
MIN_PLANE_RATIO = 0.03


def _planes(points: np.ndarray, max_planes=6) -> list[tuple[np.ndarray, float, int]]:
    pcd = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(points))
    diag = float(np.linalg.norm(points.max(0) - points.min(0)))
    out, n_total = [], len(points)
    o3d.utility.random.seed(0)
    for _ in range(max_planes):
        if len(pcd.points) < 3:
            break
        model, inliers = pcd.segment_plane(distance_threshold=diag * 0.01, ransac_n=3, num_iterations=1000)
        if len(inliers) < MIN_PLANE_RATIO * n_total:
            break
        a, b, c, d = model
        norm = np.linalg.norm([a, b, c])
        out.append((np.array([a, b, c]) / norm, d / norm, len(inliers)))
        pcd = pcd.select_by_index(inliers, invert=True)
    return out


def align_transform(points: np.ndarray, camera_ups: np.ndarray | None) -> tuple[np.ndarray, dict]:
    if camera_ups is not None and len(camera_ups) >= 3:
        hint = camera_ups.mean(0)
        hint /= np.linalg.norm(hint)
        method = "cameras"
    else:
        centered = points - points.mean(0)
        hint = np.linalg.eigh(centered.T @ centered)[1][:, 0]  # axis of least variance
        method = "geometry"

    cos_max = np.cos(np.radians(MAX_TILT_DEG))
    candidates = []
    for n, d, count in _planes(points):
        if abs(n @ hint) < cos_max:
            continue
        if n @ hint < 0:
            n, d = -n, -d
        candidates.append((n, -d, count))  # plane n·x = h, h = height along the hint
    if not candidates:
        raise ServiceError(
            "floor_not_found",
            "No floor-like plane was found. The reconstruction may not contain "
            "enough of the floor; include it in more photos.",
            status=422,
        )

    if method == "geometry":
        # Sign of the least-variance axis is arbitrary: furniture stands on the floor, so more points sit just
        # above the floor than just below the ceiling.
        heights = points @ hint
        lo, hi = heights.min(), heights.max()
        span = hi - lo
        near_low = np.sum((heights > lo + 0.05 * span) & (heights < lo + 0.35 * span))
        near_high = np.sum((heights < hi - 0.05 * span) & (heights > hi - 0.35 * span))
        if near_high > near_low:
            hint = -hint
            candidates = [(-n, -h, c) for n, h, c in candidates]

    largest = max(c for _, _, c in candidates)
    floor_n, floor_h, floor_count = min((c for c in candidates if c[2] >= 0.3 * largest), key=lambda c: c[1])
    R = np.asarray(trimesh.geometry.align_vectors(floor_n, [0, 1, 0]))
    # Yaw: rotate about +Y so the major horizontal axis lies along X (walls become axis-aligned for rooms).
    xz = (points @ R[:3, :3].T)[:, [0, 2]]
    xz = xz - xz.mean(0)
    major = np.linalg.eigh(xz.T @ xz)[1][:, 1]
    yaw = float(np.arctan2(major[1], major[0]))
    yaw = (yaw + np.pi / 2) % np.pi - np.pi / 2  # axis direction is sign-free: keep within ±90°
    R = trimesh.transformations.rotation_matrix(yaw, [0, 1, 0]) @ R
    rotated = points @ R[:3, :3].T
    lo, hi = rotated.min(0), rotated.max(0)
    T = R.copy()
    T[:3, 3] = [-(lo[0] + hi[0]) / 2, -floor_h, -(lo[2] + hi[2]) / 2]

    ratio = floor_count / len(points)
    confidence = "high" if method == "cameras" and ratio > 0.05 else "medium" if ratio > 0.05 else "low"
    return T, {
        "method": method,
        "confidence": confidence,
        "floorInlierRatio": round(ratio, 4),
        "hintCorrectionDeg": round(float(np.degrees(np.arccos(np.clip(abs(floor_n @ hint), -1, 1)))), 2),
        "floorCandidates": len(candidates),
        "yawDeg": round(float(np.degrees(yaw)), 2),
    }
