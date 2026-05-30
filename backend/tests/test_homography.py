"""Tests for CourtProjector homography math."""

import numpy as np
import pytest

from backend.cv.homography import CourtProjector


def test_known_corners_roundtrip():
    """Synthetic trapezoid → court meters → consistent projection."""
    src = np.array(
        [
            [100, 80],
            [540, 90],
            [520, 380],
            [120, 370],
        ],
        dtype=np.float32,
    )
    projector = CourtProjector.from_corners(src)

    x, z = projector.pixel_to_court(320, 200)
    assert -CourtProjector.HW <= x <= CourtProjector.HW
    assert -CourtProjector.HL <= z <= CourtProjector.HL

    # Court corners should map near reference destinations
    for i, (u, v) in enumerate(src):
        cx, cz = projector.pixel_to_court(float(u), float(v))
        expected = CourtProjector.COURT_DST[i]
        assert abs(cx - expected[0]) < 0.5
        assert abs(cz - expected[1]) < 0.5


def test_json_roundtrip():
    src = np.array([[0, 0], [640, 0], [640, 360], [0, 360]], dtype=np.float32)
    p1 = CourtProjector.from_corners(src)
    p2 = CourtProjector.from_json(p1.to_json())
    assert np.allclose(p1.H, p2.H)
