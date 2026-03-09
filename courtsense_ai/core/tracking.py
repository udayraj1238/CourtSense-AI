"""
tracking.py

Maps extracted player coordinates (from biometrics) to the real-world top-down view.
"""

import numpy as np
from courtsense_ai.core.camera_calibration import project_points

def get_player_base_coordinate(keypoints: np.ndarray) -> np.ndarray:
    """
    Estimates the point on the ground representing the player's base location.
    Typically, this is the midpoint between the left and right ankles.

    COCO/YOLO Keypoint Layout:
    15: Left Ankle
    16: Right Ankle
    
    Args:
        keypoints (np.ndarray): 17x2 array of keypoints for a single player.

    Returns:
        np.ndarray: The [x, y] midpoint coordinate.
    """
    left_ankle = keypoints[15]
    right_ankle = keypoints[16]
    
    # If both ankles are visible
    if np.any(left_ankle != 0) and np.any(right_ankle != 0):
        return (left_ankle + right_ankle) / 2.0
    
    # Fallback to whichever ankle is visible
    if np.any(left_ankle != 0):
        return left_ankle
    if np.any(right_ankle != 0):
        return right_ankle
        
    # Ultimate fallback: bottom center of an assumed bounding box 
    # (Since we just have keypoints, take the mean of all visible points and project down slightly, 
    # but practically we just return [0,0] to indicate failure)
    return np.array([0.0, 0.0])

def project_player_to_world(base_coord: np.ndarray, homography: np.ndarray) -> np.ndarray:
    """
    Projects the player's base coordinate onto the 2D top-down minimally.
    
    Args:
        base_coord (np.ndarray): [x, y] coordinate in the original video frame.
        homography (np.ndarray): The 3x3 camera projection matrix.
        
    Returns:
        np.ndarray: [X, Y] coordinate in the top-down space.
    """
    # project_points expects shape (N, 2), so we wrap and unwrap the single point
    pts = np.array([base_coord])
    projected = project_points(pts, homography)
    
    return projected[0]
