import cv2
import numpy as np
from typing import List, Dict, Any

from backend.cv.pose_estimator import PoseEstimator
from backend.cv.homography import CourtProjector
from backend.cv.smoothing import PointOneEuroFilter

# Only run YOLO inference on every Nth frame for CPU performance.
# Skipped frames hold the last known detection, which the OneEuro filter smooths.
SKIP_FRAMES = 3

def process_player_tracking(video_path: str, projector: CourtProjector, fps: float = 30.0, progress_callback=None) -> List[Dict[str, Any]]:
    """
    Reads the normalized video, extracts player positions (sampling every SKIP_FRAMES),
    applies OneEuro smoothing, and returns a list of player states per frame.
    """
    estimator = PoseEstimator()
    
    cap = cv2.VideoCapture(video_path)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    
    raw_positions_bottom = []
    raw_positions_top = []
    
    # Track the last known valid positions to handle missing detections
    last_known_bottom = {"x": 0.0, "z": 10.0}  # default starting positions
    last_known_top = {"x": 0.0, "z": -10.0}
    
    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        # Only run expensive YOLO inference on sampled frames
        if frame_idx % SKIP_FRAMES == 0:
            detections = estimator.detect_players(frame, projector)
            
            det_b = detections["player_bottom"]
            if det_b is not None:
                last_known_bottom = {"x": det_b["x"], "z": det_b["z"]}
                
            det_t = detections["player_top"]
            if det_t is not None:
                last_known_top = {"x": det_t["x"], "z": det_t["z"]}
        
        raw_positions_bottom.append(last_known_bottom)
        raw_positions_top.append(last_known_top)
            
        frame_idx += 1
        if progress_callback and frame_idx % 10 == 0:
            progress_callback(frame_idx, total_frames)
            
    cap.release()
    
    # Temporal Smoothing using OneEuroFilter
    # We apply it across the entire sequence
    filter_b = PointOneEuroFilter(t0=0.0, x0=raw_positions_bottom[0]["x"], z0=raw_positions_bottom[0]["z"], min_cutoff=0.5, beta=0.007)
    filter_t = PointOneEuroFilter(t0=0.0, x0=raw_positions_top[0]["x"], z0=raw_positions_top[0]["z"], min_cutoff=0.5, beta=0.007)
    
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
