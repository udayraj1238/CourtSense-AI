import cv2
import numpy as np

from backend.cv.court_lines import detect_court_corners


def test_detects_corners_of_synthetic_court():
    frame = np.full((360, 640, 3), (60, 140, 60), np.uint8)
    corners = np.array([[170, 80], [470, 80], [600, 340], [40, 340]], np.int32)
    cv2.polylines(frame, [corners], True, (255, 255, 255), 3)
    cv2.line(frame, (320, 80), (320, 340), (255, 255, 255), 2)
    cv2.line(frame, (105, 210), (535, 210), (255, 255, 255), 3)

    found = detect_court_corners(frame)

    assert found.shape == (4, 2)
    assert np.abs(found - corners).max() < 10
