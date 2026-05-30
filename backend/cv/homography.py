"""
homography.py — Map pixel coordinates to court meters (x, z).
"""

from __future__ import annotations

import json

import cv2
import numpy as np

from backend.cv.errors import CalibrationError
from backend.cv.court_lines import detect_court_corners


class CourtProjector:
    HW: float = 4.115
    HL: float = 11.885

    # Destination court corners in meters (x, z): TL, TR, BR, BL
    COURT_DST = np.array(
        [
            [-HW, -HL],
            [HW, -HL],
            [HW, HL],
            [-HW, HL],
        ],
        dtype=np.float32,
    )

    def __init__(self, homography: np.ndarray):
        if homography.shape != (3, 3):
            raise ValueError("Homography must be 3x3")
        self.H = homography.astype(np.float64)

    @classmethod
    def from_corners(cls, src_corners: np.ndarray) -> "CourtProjector":
        """Build projector from 4 image corners (TL, TR, BR, BL)."""
        src = np.asarray(src_corners, dtype=np.float32).reshape(4, 2)
        H, status = cv2.findHomography(src, cls.COURT_DST, cv2.RANSAC, 5.0)
        if H is None or status is None:
            raise CalibrationError("Homography computation failed for the given corners.")
        if int(status.sum()) < 4:
            raise CalibrationError("Homography RANSAC rejected corner correspondences.")
        return cls(H)

    @classmethod
    def from_frame(cls, frame: np.ndarray) -> "CourtProjector":
        corners = detect_court_corners(frame)
        return cls.from_corners(corners)

    def pixel_to_court(self, u: float, v: float) -> tuple[float, float]:
        """Returns (x, z) in meters on the ground plane."""
        pt = np.array([[[float(u), float(v)]]], dtype=np.float32)
        xz = cv2.perspectiveTransform(pt, self.H.astype(np.float32))[0, 0]
        return float(xz[0]), float(xz[1])

    def pixel_to_3d(self, u: float, v: float, y: float = 0.0) -> tuple[float, float, float]:
        x, z = self.pixel_to_court(u, v)
        return x, y, z

    def clamp_to_court(self, x: float, z: float) -> tuple[float, float]:
        return (
            max(-self.HW, min(self.HW, x)),
            max(-self.HL, min(self.HL, z)),
        )

    def reprojection_error_px(self, src_corners: np.ndarray) -> float:
        src = np.asarray(src_corners, dtype=np.float32).reshape(4, 1, 2)
        projected = cv2.perspectiveTransform(src, self.H.astype(np.float32)).reshape(4, 2)
        err = np.linalg.norm(projected - self.COURT_DST, axis=1)
        return float(err.mean())

    def to_json(self) -> str:
        return json.dumps(self.H.tolist())

    @classmethod
    def from_json(cls, data: str) -> "CourtProjector":
        return cls(np.array(json.loads(data), dtype=np.float64))
