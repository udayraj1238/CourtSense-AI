import os
import numpy as np
from typing import List, Tuple, Dict, Any, Optional
from ultralytics import YOLO
from backend.cv.homography import CourtProjector

class PoseEstimator:
    def __init__(self, model_path: str = "yolov8n-pose.pt"):
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
            
            all_raw_dets = []
            for i in range(len(keypoints_data)):
                kps = keypoints_data[i]
                
                # Check overall confidence (mean of all keypoints)
                mean_conf = np.mean(kps[:, 2])
                if mean_conf < 0.2:
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
                
                all_raw_dets.append((x, z, mean_conf, u, v))
                
            # Update history to track static people
            if not hasattr(self, '_recent_detections'):
                self._recent_detections = []
            
            current_frame_coords = [(x, z) for x, z, c, u, v in all_raw_dets]
            self._recent_detections.append(current_frame_coords)
            if len(self._recent_detections) > 10:
                self._recent_detections.pop(0)
                
            for x, z, conf, u, v in all_raw_dets:
                static_count = 0
                for past_frame_dets in self._recent_detections[:-1]:
                    for px, pz in past_frame_dets:
                        if np.hypot(x - px, z - pz) < 0.3:
                            static_count += 1
                            break
                if static_count >= 8:
                    continue # Exclude static person
                
                valid_detections.append({
                    "x": x,
                    "z": z,
                    "conf": conf,
                    "u": u,
                    "v": v
                })
        
        # Sort valid detections by confidence descending
        valid_detections.sort(key=lambda d: d["conf"], reverse=True)
        
        # Take the top 2 highest confidence detections
        top_2 = valid_detections[:2]
        
        # Assign to player_bottom and player_top.
        # Primary method: use z-sign (positive z = bottom/near player, negative z = top/far player)
        # Fallback: if both on the same z-side (common in broadcast angles),
        #           use the pixel v-coordinate (higher v = lower in frame = closer = bottom)
        output = {"player_bottom": None, "player_top": None}
        
        if len(top_2) == 2:
            # Check if both players are on the same z-side
            same_side = (top_2[0]["z"] > 0) == (top_2[1]["z"] > 0)
            if same_side:
                # Use pixel v-coordinate: larger v = lower in image = closer to camera = bottom player
                sorted_by_v = sorted(top_2, key=lambda d: d["v"], reverse=True)
                output["player_bottom"] = sorted_by_v[0]
                output["player_top"] = sorted_by_v[1]
            else:
                for det in top_2:
                    if det["z"] > 0:
                        output["player_bottom"] = det
                    else:
                        output["player_top"] = det
        elif len(top_2) == 1:
            det = top_2[0]
            if det["z"] > 0:
                output["player_bottom"] = det
            else:
                output["player_top"] = det
                
        return output
