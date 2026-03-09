"""
visualizer.py

Helper functions for research-grade debugging and visualizations mapping
2D inputs to 3D and Top-Down view spaces.
"""

import cv2
import numpy as np
from typing import Tuple

def draw_court_mask(frame: np.ndarray, mask: np.ndarray, color: Tuple[int, int, int] = (0, 255, 0), alpha: float = 0.5) -> np.ndarray:
    """
    Overlays a segmentation mask on the original frame.
    
    Args:
        frame (np.ndarray): Original image (H, W, 3).
        mask (np.ndarray): Binary mask (H, W) or (H, W, 1).
        color (Tuple[int, int, int]): BGR color for the overlay.
        alpha (float): Transparency [0, 1].
        
    Returns:
        np.ndarray: Blended image.
    """
    overlay = frame.copy()
    
    # Ensure mask is boolean or 0/1 array
    bool_mask = mask.astype(bool) if mask.max() <= 1 else (mask > 0)
    
    overlay[bool_mask] = color
    return cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0)


def draw_topdown_view(frame: np.ndarray, homography: np.ndarray, size: Tuple[int, int] = (500, 1000)) -> np.ndarray:
    """
    Warp the original frame into a top-down metric view using the calculated Homography Matrix.
    
    Args:
        frame (np.ndarray): Original image.
        homography (np.ndarray): 3x3 homography matrix mapped to the specified top-down size.
        size (Tuple[int, int]): Size (width, height) of the output top-down image.
        
    Returns:
        np.ndarray: Warped image.
    """
    return cv2.warpPerspective(frame, homography, size)

def draw_points(frame: np.ndarray, points: np.ndarray, color: Tuple[int, int, int] = (0, 0, 255), radius: int = 5) -> np.ndarray:
    """
    Draw points on the frame (useful for debugging court corners).
    """
    img = frame.copy()
    for pt in points:
        x, y = int(pt[0]), int(pt[1])
        cv2.circle(img, (x, y), radius, color, -1)
    return img
