"""
ball_tracking.py

Integrates a lightweight CNN backbone to detect the high-speed tennis ball.
"""

import numpy as np
import cv2
from typing import Optional, Tuple
from ultralytics import YOLO

class BallTracker:
    def __init__(self, model_size: str = 'yolov8n.pt'):
        """
        Initializes the YOLOv8 object detection model for generic tracking.
        In a production tennis system, this would be a custom-finetuned TrackNet or ResNet
        specifically trained on tennis balls (e.g., custom weights 'tennis_ball_tracker.pt').
        
        For this MVP, we use the base YOLO model and filter for class 'sports ball' (id: 32 in COCO).
        
        Args:
            model_size (str): e.g., 'yolov8n.pt'
        """
        print(f"Loading Ball Tracker CNN: {model_size}...")
        self.model = YOLO(model_size)
        self.sports_ball_class_id = 32

    def detect_ball(self, frame: np.ndarray) -> Optional[np.ndarray]:
        """
        Runs object detection to find the tennis ball in the frame.
        
        Args:
            frame: Input BGR image (H, W, 3).
            
        Returns:
            np.ndarray: The [x, y] center coordinate of the ball, or None if not found.
        """
        results = self.model(frame, verbose=False)[0]
        
        if results.boxes is not None:
            boxes = results.boxes.xyxy.cpu().numpy()
            classes = results.boxes.cls.cpu().numpy()
            confidences = results.boxes.conf.cpu().numpy()
            
            # Find all sports balls
            ball_indices = np.where(classes == self.sports_ball_class_id)[0]
            
            if len(ball_indices) > 0:
                # Find the one with the highest confidence
                best_idx = ball_indices[np.argmax(confidences[ball_indices])]
                box = boxes[best_idx]
                
                # We want the center of the bounding box
                x_center = (box[0] + box[2]) / 2.0
                y_center = (box[1] + box[3]) / 2.0
                
                return np.array([x_center, y_center])
                
        return None
