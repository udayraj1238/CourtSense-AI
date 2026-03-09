"""
biometrics.py

Integrates a lightweight 2D pose estimation model for tracking players.
We use YOLOv8-pose for high-speed, robust human biometrics.
"""

import numpy as np
import cv2
from typing import List, Dict, Any
from ultralytics import YOLO

class PoseEstimator:
    def __init__(self, model_size: str = 'yolov8n-pose.pt'):
        """
        Initializes the YOLOv8 Pose model.
        Args:
            model_size (str): e.g., 'yolov8n-pose.pt', 'yolov8s-pose.pt'
        """
        # Automatically downloads weights if they don't exist
        print(f"Loading Pose Estimator: {model_size}...")
        self.model = YOLO(model_size)

    def extract_keypoints(self, frame: np.ndarray) -> List[Dict[str, Any]]:
        """
        Runs pose estimation on an input frame.
        
        Args:
            frame: Input BGR image (H, W, 3).
            
        Returns:
            List of dictionaries, each containing 'bbox' and 'keypoints' for a detected person.
            keypoints shape is (17, 2) where each point is [x, y].
        """
        # ultralytics uses BGR by default, but double-check if image comes from PIL
        results = self.model(frame, verbose=False)[0]
        
        detections = []
        if results.keypoints is not None:
            # keypoints.xy contains (x, y) coordinates for the 17 joints
            kpts_all = results.keypoints.xy.cpu().numpy()
            boxes_all = results.boxes.xyxy.cpu().numpy()
            
            for kpts, box in zip(kpts_all, boxes_all):
                detections.append({
                    "bbox": box,
                    "keypoints": kpts
                })
                
        return detections


def calculate_joint_angle(p1: np.ndarray, p2: np.ndarray, p3: np.ndarray) -> float:
    """
    Calculates the 2D angle (in degrees) formed by three keypoints: p1-p2-p3 (p2 is the vertex).
    E.g., p1=Shoulder, p2=Elbow, p3=Wrist.

    Args:
        p1, p2, p3: (x, y) coordinates.

    Returns:
        float: Angle in degrees in the range [0, 180].
        Returns 0.0 if any point is missing (often indicated by (0,0) from the model).
    """
    # Check if any point was not detected (YOLO might output 0,0 for occluded points)
    if np.all(p1 == 0) or np.all(p2 == 0) or np.all(p3 == 0):
        return 0.0

    v1 = p1 - p2
    v2 = p3 - p2

    # Dot product method
    cosine_angle = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))
    # Clip to handle floating point inaccuracies
    cosine_angle = np.clip(cosine_angle, -1.0, 1.0)
    
    angle = np.arccos(cosine_angle)
    return np.degrees(angle)
