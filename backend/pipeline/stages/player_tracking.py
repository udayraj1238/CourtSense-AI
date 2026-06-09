import cv2
import numpy as np
from typing import List, Dict, Any

from backend.cv.pose_estimator import PoseEstimator
from backend.cv.homography import CourtProjector
from backend.cv.smoothing import PointOneEuroFilter
from backend.config import get_settings

# Only run YOLO inference on every Nth frame for CPU performance.
# Skipped frames are linearly interpolated (not repeated).
SKIP_FRAMES = 2


def _lerp(a: Dict[str, float], b: Dict[str, float], t: float) -> Dict[str, float]:
    """Linear interpolation between two {x, z} dicts."""
    return {
        "x": a["x"] + (b["x"] - a["x"]) * t,
        "z": a["z"] + (b["z"] - a["z"]) * t,
    }


def process_player_tracking(video_path: str, projector: CourtProjector, fps: float = 30.0, progress_callback=None) -> List[Dict[str, Any]]:
    """
    Reads the normalized video, extracts player positions (sampling every SKIP_FRAMES),
    linearly interpolates skipped frames, applies OneEuro smoothing, and returns
    a list of player states per frame.
    """
    settings = get_settings()
    estimator = PoseEstimator(str(settings.pose_model_path))
    
    cap = cv2.VideoCapture(video_path)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    
    # Collect keyframe detections (only on sampled frames)
    keyframe_indices: List[int] = []
    keyframe_detections_bottom: List[Dict[str, float]] = []
    keyframe_detections_top: List[Dict[str, float]] = []
    
    # Track the last known valid positions to handle missing detections
    last_known_bottom = {"x": 0.0, "z": 10.0}
    last_known_top = {"x": 0.0, "z": -10.0}
    
    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        if frame_idx % SKIP_FRAMES == 0:
            detections = estimator.detect_players(frame, projector)
            
            det_b = detections["player_bottom"]
            if det_b is not None:
                last_known_bottom = {"x": det_b["x"], "z": det_b["z"]}
                
            det_t = detections["player_top"]
            if det_t is not None:
                last_known_top = {"x": det_t["x"], "z": det_t["z"]}
            
            keyframe_indices.append(frame_idx)
            keyframe_detections_bottom.append({"x": last_known_bottom["x"], "z": last_known_bottom["z"]})
            keyframe_detections_top.append({"x": last_known_top["x"], "z": last_known_top["z"]})
            
        frame_idx += 1
        if progress_callback and frame_idx % 10 == 0:
            progress_callback(frame_idx, total_frames)
            
    cap.release()
    
    # Interpolate all frames from keyframes
    raw_positions_bottom: List[Dict[str, float]] = []
    raw_positions_top: List[Dict[str, float]] = []
    
    for i in range(frame_idx):
        # Find the surrounding keyframes
        if i <= keyframe_indices[0]:
            raw_positions_bottom.append(keyframe_detections_bottom[0])
            raw_positions_top.append(keyframe_detections_top[0])
        elif i >= keyframe_indices[-1]:
            raw_positions_bottom.append(keyframe_detections_bottom[-1])
            raw_positions_top.append(keyframe_detections_top[-1])
        else:
            # Find the two keyframes that bracket this frame
            for k in range(len(keyframe_indices) - 1):
                if keyframe_indices[k] <= i < keyframe_indices[k + 1]:
                    t = (i - keyframe_indices[k]) / (keyframe_indices[k + 1] - keyframe_indices[k])
                    raw_positions_bottom.append(_lerp(keyframe_detections_bottom[k], keyframe_detections_bottom[k + 1], t))
                    raw_positions_top.append(_lerp(keyframe_detections_top[k], keyframe_detections_top[k + 1], t))
                    break
    
    # Temporal Smoothing using OneEuroFilter
    # Increased responsiveness: min_cutoff=1.5 (allows faster movement), beta=0.05 (adapts to speed)
    filter_b = PointOneEuroFilter(t0=0.0, x0=raw_positions_bottom[0]["x"], z0=raw_positions_bottom[0]["z"], min_cutoff=1.5, beta=0.05)
    filter_t = PointOneEuroFilter(t0=0.0, x0=raw_positions_top[0]["x"], z0=raw_positions_top[0]["z"], min_cutoff=1.5, beta=0.05)
    
    final_states = []
    for i in range(frame_idx):
        t = i / fps
        
        # Smooth bottom player
        raw_b = raw_positions_bottom[i]
        smooth_b_x, smooth_b_z = filter_b(t, raw_b["x"], raw_b["z"])
        
        # Smooth top player
        raw_t = raw_positions_top[i]
        smooth_t_x, smooth_t_z = filter_t(t, raw_t["x"], raw_t["z"])
        
        frame_players = [
            {
                "id": "player_bottom",
                "position": {"x": float(smooth_b_x), "y": 0.0, "z": float(smooth_b_z)}
            },
            {
                "id": "player_top",
                "position": {"x": float(smooth_t_x), "y": 0.0, "z": float(smooth_t_z)}
            }
        ]
        final_states.append(frame_players)
        
    return final_states
