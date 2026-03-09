"""
init_phase.py

Entry point script to test Task 1: Segmentation & Geometric Calibration.
- Generates/Load a sample frame
- Calculates Homography Matrix
- Runs SegFormer
- Outputs debugging visualizations
"""

import cv2
import numpy as np
import os
import sys

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from courtsense_ai.core.camera_calibration import get_homography_matrix, project_points
from courtsense_ai.core.segmentation import CourtSegmenter
from courtsense_ai.utils.visualizer import draw_court_mask, draw_topdown_view, draw_points


def create_mock_frame():
    """Create a mock tennis court frame since we don't have a video file yet."""
    h, w = 720, 1280
    frame = np.zeros((h, w, 3), dtype=np.uint8)
    # Give it a generic dark green "ground" color
    frame[:] = (50, 100, 50) 
    
    # Draw some "perspective" lines simulating a court
    src_points = np.array([
        [w*0.3, h*0.4], # Top Left
        [w*0.7, h*0.4], # Top Right
        [w*0.9, h*0.9], # Bot Right
        [w*0.1, h*0.9]  # Bot Left
    ], dtype=np.float32)

    # Draw a polygon representing the court
    pts = src_points.astype(np.int32).reshape((-1, 1, 2))
    cv2.fillPoly(frame, [pts], color=(80, 150, 80))
    cv2.polylines(frame, [pts], isClosed=True, color=(255, 255, 255), thickness=3)

    return frame, src_points


def main():
    print("CourtSense AI: Task 1 - Initialization Phase")
    
    # 1. Load data
    frame, mock_src_points = create_mock_frame()
    output_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'output')
    os.makedirs(output_dir, exist_ok=True)
    
    cv2.imwrite(os.path.join(output_dir, "0_input_frame.jpg"), frame)
    print("- Created mock frame.")

    # 2. Geometric Calibration
    # Define a standard metric top-down tennis court view (in arbitrary scale, e.g., 500x1000)
    top_down_w, top_down_h = 500, 1000
    dst_points = np.array([
        [0, 0],
        [top_down_w, 0],
        [top_down_w, top_down_h],
        [0, top_down_h]
    ], dtype=np.float32)

    try:
        H, _ = get_homography_matrix(mock_src_points, dst_points)
        print("\n[Linear Algebra] Calculated Homography Matrix (3x3):")
        print(H)
        
        # Visualize mapping
        frame_with_pts = draw_points(frame, mock_src_points)
        cv2.imwrite(os.path.join(output_dir, "1_corner_points.jpg"), frame_with_pts)
        
        warped = draw_topdown_view(frame, H, (top_down_w, top_down_h))
        cv2.imwrite(os.path.join(output_dir, "2_top_down_mapping.jpg"), warped)
        print("- Saved Top-Down perspective mapping visualization.")
        
    except Exception as e:
        print(f"Error computing homography: {e}")

    # 3. Segmentation Layer
    print("\n[AI Vision] Loading SegFormer (this may take a moment to download weights)...")
    try:
        segmenter = CourtSegmenter()
        masks = segmenter.segment_frame(frame)
        print(f"- Segmentation complete. Mask shape: {masks['Segmentation'].shape}")
        
        # Visualize approximated court mask (Note: Since it's a generic model on a mock image, 
        # it might not find a "person" or "road" properly, but we test the pipeline).
        masked_frame = draw_court_mask(frame, masks["CourtApprox"], color=(255, 0, 255))
        cv2.imwrite(os.path.join(output_dir, "3_court_mask.jpg"), masked_frame)
        print("- Saved Segmentation overlay visualization.")
        
    except Exception as e:
        print(f"Segmentation failed (could be HuggingFace download error or memory limit): {e}")

    print("\nInitialization Phase Script Complete! Check 'data/output' folder.")


if __name__ == "__main__":
    main()
