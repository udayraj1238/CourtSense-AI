import cv2
import numpy as np
from typing import List, Dict, Any, Tuple

from backend.cv.ball_tracker import BallTracker
from backend.cv.homography import CourtProjector
from backend.cv.kalman3d import Kalman3D
from backend.cv.spline import fill_gaps_with_spline

def detect_bounces(positions: List[Dict[str, float]], fps: float = 30.0) -> List[int]:
    """
    Detect bounces by looking at sudden changes in the vertical (Y) velocity,
    or in 2D it's hard, but we can look for sharp changes in trajectory direction.
    Since we don't have true Y yet, we use a simple heuristic on the 2D plane (x, z).
    We look for sudden deceleration followed by acceleration, or sharp turns in Z.
    """
    bounces = []
    # For a real broadcast, bounces usually happen when Z direction flips, 
    # or the ball dramatically slows down (hitting the ground at an angle).
    # Here is a simple heuristic:
    for i in range(2, len(positions) - 2):
        if positions[i]["is_occluded"]: continue
        
        z_prev = positions[i-1]["position"]["z"]
        z_curr = positions[i]["position"]["z"]
        z_next = positions[i+1]["position"]["z"]
        
        vz_before = (z_curr - z_prev) * fps
        vz_after = (z_next - z_curr) * fps
        
        # If the ball is moving fast in one direction and suddenly reverses or slows sharply
        if (vz_before * vz_after < 0) and abs(vz_before) > 5.0:
            bounces.append(i)
            
    return bounces

def estimate_heights(positions: List[Dict[str, Any]], bounces: List[int]) -> None:
    """
    Fits parabolic arcs between bounces to estimate the Y height.
    Modifies the 'positions' list in place.
    """
    # Simple strategy: Ball height starts at ~1.0m (racket hit)
    # drops to 0.08m at bounce, then rises again.
    
    # If no bounces detected, just give it a simple arc for the whole sequence
    if not bounces:
        for i, pos in enumerate(positions):
            # Parabola peaking in the middle
            t = i / len(positions)
            y = 1.0 - 4.0 * 0.92 * ((t - 0.5) ** 2)
            positions[i]["position"]["y"] = max(0.08, y)
        return
        
    # We have bounces.
    last_idx = 0
    for bounce_idx in bounces:
        # Arc from last_idx to bounce_idx
        length = bounce_idx - last_idx
        if length > 0:
            for i in range(last_idx, bounce_idx):
                t = (i - last_idx) / length
                y = 1.0 - (1.0 - 0.08) * (t ** 2) # Half parabola down
                positions[i]["position"]["y"] = max(0.08, y)
        positions[bounce_idx]["position"]["y"] = 0.08
        last_idx = bounce_idx
        
    # Arc from last bounce to end
    length = len(positions) - last_idx - 1
    if length > 0:
        for i in range(last_idx + 1, len(positions)):
            t = (i - last_idx) / length
            y = 0.08 + (1.0 - 0.08) * (t ** 2) # Half parabola up
            positions[i]["position"]["y"] = max(0.08, y)


def process_ball_tracking(video_path: str, projector: CourtProjector, fps: float = 30.0, progress_callback=None) -> List[Dict[str, Any]]:
    tracker = BallTracker()
    kf = Kalman3D(dt=1.0/fps)
    
    cap = cv2.VideoCapture(video_path)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    
    raw_positions = []
    frame_idx = 0
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
            
        det = tracker.detect_ball(frame, projector)
        
        if det is not None:
            # We have a detection
            x, z = det["x"], det["z"]
            y_meas = 0.5 # Temporary Y measurement for Kalman initialization
            
            if not kf.is_initialized:
                kf.init_state(x, y_meas, z)
                pred_x, pred_y, pred_z = x, y_meas, z
            else:
                pred_x, pred_y, pred_z = kf.predict()
                pred_x, pred_y, pred_z = kf.correct(x, pred_y, z) # Trust prediction for Y right now
                
            raw_positions.append({
                "position": {
                    "x": float(pred_x),
                    "y": float(pred_y),
                    "z": float(pred_z)
                },
                "is_occluded": False
            })
        else:
            # Occluded / Missed Detection
            if kf.is_initialized:
                pred_x, pred_y, pred_z = kf.predict()
                raw_positions.append({
                    "position": {
                        "x": float(pred_x),
                        "y": float(pred_y),
                        "z": float(pred_z)
                    },
                    "is_occluded": True
                })
            else:
                # Haven't seen the ball yet
                raw_positions.append({
                    "position": {
                        "x": 0.0,
                        "y": 1.0,
                        "z": 0.0
                    },
                    "is_occluded": True
                })
                
        frame_idx += 1
        if progress_callback and frame_idx % 30 == 0:
            progress_callback(frame_idx, total_frames)
            
    cap.release()
    
    # 1.5 Spline Gap Fill
    fill_gaps_with_spline(raw_positions, max_gap=20)
    
    # 2. Bounce Detection & Height Estimation
    bounces = detect_bounces(raw_positions, fps)
    estimate_heights(raw_positions, bounces)
    
    return raw_positions
