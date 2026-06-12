import cv2
import numpy as np
from typing import Dict, Any, Optional
from ultralytics import YOLO

from backend.cv.homography import CourtProjector

class BallTracker:
    def __init__(self, model_path: str = "yolov8_tennis_ball.pt"):
        # We use a custom fine-tuned YOLOv8 model for V5.0. 
        # In our custom dataset, class 0 is 'tennis_ball'.
        self.model = YOLO(model_path)
        
        if "tennis" in model_path:
            self.classes_to_detect = [0]
        else:
            # Fallback to standard COCO
            self.classes_to_detect = [32]
        
    def detect_ball(self, frame: np.ndarray, projector: CourtProjector) -> Optional[Dict[str, float]]:
        """
        Detects the tennis ball in the frame and projects it to the 2D court ground plane (x, z).
        Note: The true height (y) is estimated in the pipeline stage, not here.
        Returns: {"x": float, "z": float, "conf": float, "u": float, "v": float} or None
        """
        results = self.model(frame, classes=self.classes_to_detect, verbose=False)
        
        valid_detections = []
        
        if len(results) > 0 and len(results[0].boxes) > 0:
            boxes = results[0].boxes
            for box in boxes:
                conf = float(box.conf[0])
                # Tennis-Vision dual-threshold pipeline variables
                INITIAL_CONF = 0.15
                FINAL_CONF = 0.60
                
                if conf < INITIAL_CONF: 
                    continue
                    
                # Get center of bounding box
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                u = (x1 + x2) / 2.0
                v = (y1 + y2) / 2.0
                
                # Project pixel to court ground plane (x, z)
                x, z = projector.pixel_to_court(u, v)
                
                # Court Bounds Filter: A ball can be out of bounds, but usually within a reasonable distance
                if abs(x) > projector.HW + 4.0 or abs(z) > projector.HL + 6.0:
                    continue
                    
                valid_detections.append({
                    "x": x,
                    "z": z,
                    "conf": conf,
                    "u": u,
                    "v": v
                })
                
        if len(valid_detections) == 0:
            return None
            
        # Sort by confidence and return the best one
        valid_detections.sort(key=lambda d: d["conf"], reverse=True)
        return valid_detections[0]

