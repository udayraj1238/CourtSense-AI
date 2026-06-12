"""
court_lines.py — Detect tennis court corners from a broadcast frame via Hough lines.
"""

from __future__ import annotations

import cv2
import numpy as np

from backend.cv.errors import CalibrationError


def _resize(frame: np.ndarray, max_width: int = 1280) -> tuple[np.ndarray, float]:
    h, w = frame.shape[:2]
    if w <= max_width:
        return frame, 1.0
    scale = max_width / w
    resized = cv2.resize(frame, (max_width, int(h * scale)), interpolation=cv2.INTER_AREA)
    return resized, scale


def _white_line_mask(bgr: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    
    # Adaptive threshold — works on all court types
    adaptive = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, blockSize=51, C=-8
    )
    
    # White/light color mask — supplement for hard courts
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    white = cv2.inRange(hsv, np.array([0, 0, 150]), np.array([180, 60, 255]))
    
    # Also detect yellow lines (some indoor courts)
    yellow = cv2.inRange(hsv, np.array([20, 80, 150]), np.array([35, 200, 255]))
    
    combined = cv2.bitwise_or(adaptive, cv2.bitwise_or(white, yellow))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    return cv2.morphologyEx(combined, cv2.MORPH_CLOSE, kernel, iterations=2)


def _line_angle(x1: float, y1: float, x2: float, y2: float) -> float:
    return float(np.degrees(np.arctan2(y2 - y1, x2 - x1)) % 180)


def _collect_segments(mask: np.ndarray) -> list[tuple[float, float, float, float]]:
    edges = cv2.Canny(mask, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=80,
        minLineLength=mask.shape[1] // 8,
        maxLineGap=20,
    )
    if lines is None:
        return []
    return [tuple(map(float, ln[0])) for ln in lines]


def _cluster_lines(
    segments: list[tuple[float, float, float, float]],
) -> tuple[list, list]:
    horiz: list = []
    vert: list = []
    for x1, y1, x2, y2 in segments:
        ang = _line_angle(x1, y1, x2, y2)
        if ang < 35 or ang > 145:
            horiz.append((x1, y1, x2, y2))
        elif 55 < ang < 125:
            vert.append((x1, y1, x2, y2))
    return horiz, vert


def _line_to_abc(x1: float, y1: float, x2: float, y2: float) -> tuple[float, float, float]:
    a = y1 - y2
    b = x2 - x1
    c = x1 * y2 - x2 * y1
    norm = np.hypot(a, b)
    if norm < 1e-6:
        return 0.0, 0.0, 0.0
    return a / norm, b / norm, c / norm


def _intersect(l1: tuple[float, float, float], l2: tuple[float, float, float]) -> np.ndarray | None:
    a1, b1, c1 = l1
    a2, b2, c2 = l2
    det = a1 * b2 - a2 * b1
    if abs(det) < 1e-6:
        return None
    x = (b1 * c2 - b2 * c1) / det
    y = (c1 * a2 - c2 * a1) / det
    return np.array([x, y], dtype=np.float32)


def _order_corners(pts: np.ndarray) -> np.ndarray:
    """Order 4 points as TL, TR, BR, BL."""
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    rect = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).reshape(-1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def _pick_extreme_lines(
    lines: list[tuple[float, float, float, float]], axis: str
) -> tuple[tuple[float, float, float], tuple[float, float, float]] | None:
    if len(lines) < 2:
        return None
    coeffs = [_line_to_abc(*ln) for ln in lines]
    if axis == "h":
        # top = min y-midpoint, bottom = max y-midpoint
        mids = [((ln[1] + ln[3]) / 2) for ln in lines]
        top_idx = int(np.argmin(mids))
        bot_idx = int(np.argmax(mids))
    else:
        mids = [((ln[0] + ln[2]) / 2) for ln in lines]
        left_idx = int(np.argmin(mids))
        right_idx = int(np.argmax(mids))
        top_idx, bot_idx = left_idx, right_idx
    return coeffs[top_idx], coeffs[bot_idx]


def detect_court_corners(frame: np.ndarray) -> np.ndarray:
    """
    Detect 4 court corners in pixel space (TL, TR, BR, BL).
    Raises CalibrationError if detection fails validation.
    
    TODO: Replace Hough lines with Tennis-Vision's keypoints_model.pth (ResNet-50)
    to detect 14 court landmarks for better accuracy on clay/dark courts.
    """
    if frame is None or frame.size == 0:
        raise CalibrationError("Empty frame provided for calibration.")

    working, scale = _resize(frame)
    mask = _white_line_mask(working)
    segments = _collect_segments(mask)
    horiz, vert = _cluster_lines(segments)

    h_pair = _pick_extreme_lines(horiz, "h")
    v_pair = _pick_extreme_lines(vert, "v")
    if h_pair is None or v_pair is None:
        raise CalibrationError("Could not detect enough court lines for auto-calibration.")

    top, bottom = h_pair
    left, right = v_pair

    corners = []
    for h_line in (top, bottom):
        for v_line in (left, right):
            pt = _intersect(h_line, v_line)
            if pt is None:
                raise CalibrationError("Failed to intersect detected court lines.")
            corners.append(pt)

    ordered = _order_corners(np.array(corners, dtype=np.float32))

    h, w = working.shape[:2]
    margin = 5
    if (
        np.any(ordered[:, 0] < -margin)
        or np.any(ordered[:, 1] < -margin)
        or np.any(ordered[:, 0] > w + margin)
        or np.any(ordered[:, 1] > h + margin)
    ):
        raise CalibrationError("Detected court corners fall outside the frame.")

    area = cv2.contourArea(ordered.astype(np.float32))
    frame_area = h * w
    if area < frame_area * 0.08 or area > frame_area * 0.85:
        raise CalibrationError("Detected court area failed geometric validation.")

    if scale != 1.0:
        ordered /= scale

    return ordered.astype(np.float32)


def extract_preview_frame(video_path: str, out_jpg: str, timestamp_sec: float = 0.5) -> np.ndarray:
    """Grab a BGR frame from video for calibration preview."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise CalibrationError(f"Cannot open video: {video_path}")
    cap.set(cv2.CAP_PROP_POS_MSEC, timestamp_sec * 1000)
    ok, frame = cap.read()
    if not ok or frame is None:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        ok, frame = cap.read()
    cap.release()
    if not ok or frame is None:
        raise CalibrationError("Could not read a frame from the uploaded video.")
    cv2.imwrite(out_jpg, frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return frame
