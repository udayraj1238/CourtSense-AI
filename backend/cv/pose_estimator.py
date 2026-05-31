import os
import numpy as np
from typing import List, Tuple, Dict, Any, Optional
from ultralytics import YOLO
from backend.cv.homography import CourtProjector

class PoseEstimator:
    def __init__(self, model_path: str = "yolov8m-pose.pt"):
        # Ultralytics will auto-download the model if it's a standard name like yolov8m-pose.pt
        self.model = YOLO(model_path)
        # COCO pose keypoint indices
        self.KP_L_ANKLE = 15
        self.KP_R_ANKLE = 16
        self.KP_L_HIP = 11
        self.KP_R_HIP = 12
        self.KP_L_WRIST = 9
        self.KP_R_WRIST = 10

    def detect_players(self, frame: np.ndarray, projector: CourtProjector) -> Dict[str, Optional[Dict[str, float]]]:
        """
        Detect players, filter by court bounds, and assign to bottom/top.
        Returns:
            {"player_bottom": {"x": x, "z": z, "conf": conf}, "player_top": ...}
        """
        results = self.model(frame, classes=[0], verbose=False) # class 0 is person
        
        valid_detections = []
        
        if len(results) > 0 and results[0].keypoints is not None and len(results[0].keypoints.data) > 0:
            keypoints_data = results[0].keypoints.data.cpu().numpy() # [num_persons, 17, 3] (x, y, conf)
            
            for i in range(len(keypoints_data)):
                kps = keypoints_data[i]
                
                # Check overall confidence (mean of all keypoints)
                mean_conf = np.mean(kps[:, 2])
                if mean_conf < 0.3:
                    continue
                
                # Extract ankle midpoints for ground contact
                l_ankle = kps[self.KP_L_ANKLE]
                r_ankle = kps[self.KP_R_ANKLE]
                
                if l_ankle[2] > 0.1 and r_ankle[2] > 0.1:
                    u = (l_ankle[0] + r_ankle[0]) / 2
                    v = (l_ankle[1] + r_ankle[1]) / 2
                else:
                    # Fallback to hip midpoint
                    l_hip = kps[self.KP_L_HIP]
                    r_hip = kps[self.KP_R_HIP]
                    if l_hip[2] > 0.1 and r_hip[2] > 0.1:
                        u = (l_hip[0] + r_hip[0]) / 2
                        v = (l_hip[1] + r_hip[1]) / 2
                    else:
                        continue # Skip if no good bottom anchor
                
                # Project pixel to 3D court
                x, z = projector.pixel_to_court(u, v)
                
                # Court Bounds Filter (with a small margin to allow stepping just outside)
                if abs(x) > projector.HW + 2.0 or abs(z) > projector.HL + 4.0:
                    continue # Discard umpires/line judges far off court
                
                valid_detections.append({
                    "x": x,
                    "z": z,
                    "conf": mean_conf,
                    "u": u,
                    "v": v
                })
                
        # Sort valid detections by confidence descending
        valid_detections.sort(key=lambda d: d["conf"], reverse=True)
        
        # Take the top 2 highest confidence detections
        top_2 = valid_detections[:2]
        
        # Assign to player_bottom and player_top based on Z
        output = {"player_bottom": None, "player_top": None}
        
        for det in top_2:
            if det["z"] > 0:
                if output["player_bottom"] is None or det["conf"] > output["player_bottom"]["conf"]:
                    output["player_bottom"] = det
            else:
                if output["player_top"] is None or det["conf"] > output["player_top"]["conf"]:
                    output["player_top"] = det
                    
        return output
