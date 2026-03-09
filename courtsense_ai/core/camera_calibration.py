"""
camera_calibration.py

This module provides the mathematical foundation for setting up a 2D mapping 
from the camera coordinate space (pixel plane) to a top-down metric world space.
"""

import cv2
import numpy as np
from typing import Tuple


def get_homography_matrix(src_points: np.ndarray, dst_points: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """
    Computes the Homography Matrix H that maps points from the source plane (image pixels)
    to the destination plane (real-world top-down metric view).

    Mathematical Derivation:
    A homography is a 3x3 projection matrix 'H' that maps a point in one plane to another.
    Let p1 = [u, v, 1]^T be a pixel coordinate in homogenous coordinates.
    Let p2 = [X, Y, W]^T be a world coordinate in homogenous coordinates.

    p2 = H * p1
    [X]   [h11  h12  h13]   [u]
    [Y] = [h21  h22  h23] * [v]
    [W]   [h31  h32  h33]   [1]

    Since homogenous coordinates are scale-invariant, we normalize by W:
    x' = X/W = (h11*u + h12*v + h13) / (h31*u + h32*v + h33)
    y' = Y/W = (h21*u + h22*v + h23) / (h31*u + h32*v + h33)

    Rearranging these gives a system of linear equations A*h = 0, where h is the 9-element 
    vector form of H. Since H has 8 degrees of freedom (scale is arbitrary, so h33 usually = 1),
    we need at least 4 point correspondences (each point gives 2 equations: x and y) to 
    solve for H using techniques like Direct Linear Transform (DLT) or SVD.

    Args:
        src_points (np.ndarray): The 4 points in the original image (e.g., [[u1, v1], ...]).
                                 Shape: (4, 2), dtype: float32.
        dst_points (np.ndarray): The corresponding 4 points in the top-down view metric space
                                 (e.g., [[X1, Y1], ...]). Shape: (4, 2), dtype: float32.

    Returns:
        Tuple[np.ndarray, np.ndarray]:
            - H (np.ndarray): The 3x3 homography matrix.
            - status (np.ndarray): Mask indicating inlier points used in calculation.
    """
    assert src_points.shape == (4, 2), "src_points must be a 4x2 array"
    assert dst_points.shape == (4, 2), "dst_points must be a 4x2 array"

    H, status = cv2.findHomography(src_points, dst_points)
    
    if H is None:
        raise ValueError("Homography computation failed for the given points.")
        
    return H, status


def project_points(points: np.ndarray, homography_matrix: np.ndarray) -> np.ndarray:
    """
    Projects an array of 2D points from pixel space to world space using Homography.
    
    Args:
        points (np.ndarray): Array of points to transform. Shape: (N, 1, 2) or (N, 2).
        homography_matrix (np.ndarray): 3x3 homography matrix.
        
    Returns:
        np.ndarray: Transformed points in world coordinates. Shape matches input.
    """
    # Ensure points shape is (N, 1, 2) for cv2.perspectiveTransform
    original_shape = points.shape
    if len(original_shape) == 2:
        # Reshape (N, 2) -> (N, 1, 2)
        p = points.reshape(-1, 1, 2).astype(np.float32)
    else:
        p = points.astype(np.float32)

    projected = cv2.perspectiveTransform(p, homography_matrix)

    if len(original_shape) == 2:
        return projected.reshape(-1, 2)
    return projected
