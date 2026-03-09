"""
phase3_ghost.py

Execution script for Phase 3.
- Combines Court segmentation with Player Pose tracking.
- Calculates joint angles (e.g. knee).
- Extracts player coordinates and maps them to the top-down minimap.
"""

import cv2
import numpy as np
import os
import sys

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from courtsense_ai.core.camera_calibration import get_homography_matrix
from courtsense_ai.core.segmentation import CourtSegmenter
from courtsense_ai.core.biometrics import PoseEstimator, calculate_joint_angle
from courtsense_ai.core.tracking import get_player_base_coordinate, project_player_to_world
from courtsense_ai.utils.visualizer import draw_court_mask, draw_topdown_view

def create_mock_frame_with_player():
    """Create a mock tennis court frame with a 'player'."""
    h, w = 720, 1280
    frame = np.zeros((h, w, 3), dtype=np.uint8)
    frame[:] = (50, 100, 50) 
    
    src_points = np.array([
        [w*0.3, h*0.4], [w*0.7, h*0.4], [w*0.9, h*0.9], [w*0.1, h*0.9]
    ], dtype=np.float32)

    pts = src_points.astype(np.int32).reshape((-1, 1, 2))
    cv2.fillPoly(frame, [pts], color=(80, 150, 80))
    cv2.polylines(frame, [pts], isClosed=True, color=(255, 255, 255), thickness=3)

    # We will use an actual photo of a person later, or let YOLO try to find something.
    # For now, if we don't have a real image, YOLO won't find a pose. 
    # To demonstrate the math, we will inject a dummy detection if YOLO finds nothing.
    return frame, src_points


def main():
    print("CourtSense AI: Phase 3 - The Ghost")
    output_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'output', 'phase3')
    os.makedirs(output_dir, exist_ok=True)
    
    # 1. Image & Calibration
    frame, mock_src_points = create_mock_frame_with_player()
    
    top_down_w, top_down_h = 500, 1000
    dst_points = np.array([
        [0, 0], [top_down_w, 0], [top_down_w, top_down_h], [0, top_down_h]
    ], dtype=np.float32)
    
    H, _ = get_homography_matrix(mock_src_points, dst_points)
    
    # Check if we should download a dummy image to properly test YOLO
    import urllib.request
    test_img_path = os.path.join(output_dir, "tennis_player_test.jpg")
    if not os.path.exists(test_img_path):
        print("Downloading a sample tennis player image to test Pose Estimation...")
        
        # Download a royalty-free tennis player photo from Wikimedia Commons
        url = "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Rafael_Nadal_at_the_2011_US_Open.jpg/1200px-Rafael_Nadal_at_the_2011_US_Open.jpg"
        
        # Adding user-agent as unsplash sometimes blocks python scripts
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response, open(test_img_path, 'wb') as out_file:
            data = response.read()
            out_file.write(data)
            
    # Use real image instead of mock green block for Phase 3 so YOLO works:
    frame = cv2.imread(test_img_path)
    
    # 2. SegFormer
    print("\n[AI Vision] Running SegFormer Masking...")
    # NOTE: SegFormer output won't look perfect on an arbitrary Unsplash photo because 
    # the court perspective doesn't match our homography trapazoid, but the code pipeline will execute.
    try:
        segmenter = CourtSegmenter()
        masks = segmenter.segment_frame(frame)
        frame_masked = draw_court_mask(frame, masks["CourtApprox"], color=(255, 0, 255))
    except Exception as e:
        print(f"SegFormer failed: {e}")
        frame_masked = frame.copy()


    # 3. Pose & Biometrics
    print("\n[AI Biometrics] Running YOLOv8 Pose...")
    pose_estimator = PoseEstimator()
    detections = pose_estimator.extract_keypoints(frame)
    
    vis_frame = frame_masked.copy()
    
    # Create the minimap image
    minimap = np.zeros((top_down_h, top_down_w, 3), dtype=np.uint8)
    minimap[:] = (0, 100, 0) # Green court
    cv2.rectangle(minimap, (0,0), (top_down_w, top_down_h), (255,255,255), 5)
    
    for i, det in enumerate(detections):
        kpts = det["keypoints"]
        box = det["bbox"]
        
        # Draw bounding box
        x1, y1, x2, y2 = map(int, box)
        cv2.rectangle(vis_frame, (x1, y1), (x2, y2), (255, 0, 0), 2)
        
        # Draw visible points
        for pt in kpts:
            if pt[0] > 0 and pt[1] > 0:
                cv2.circle(vis_frame, (int(pt[0]), int(pt[1])), 4, (0, 255, 255), -1)
                
        # Calculate Knee Flexion Angle (Right Leg)
        # COCO: 12=Right Hip, 14=Right Knee, 16=Right Ankle
        r_hip, r_knee, r_ankle = kpts[12], kpts[14], kpts[16]
        angle = calculate_joint_angle(r_hip, r_knee, r_ankle)
        print(f"Player {i} Right Knee Flexion: {angle:.1f} degrees")
        
        cv2.putText(vis_frame, f"Knee: {angle:.1f}", (x1, y1-10), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)
                    
        # Find base coordinate and project onto 2D minimap
        base_coord = get_player_base_coordinate(kpts)
        if base_coord[0] != 0:
            world_coord = project_player_to_world(base_coord, H)
            X, Y = int(world_coord[0]), int(world_coord[1])
            
            # Clamp projection within minimap for visual testing
            X = max(0, min(X, top_down_w))
            Y = max(0, min(Y, top_down_h))
            
            # Draw blue circle as player location on Minimap
            cv2.circle(minimap, (X, Y), 15, (255, 50, 50), -1)
            print(f"Player {i} projected to Minimap: ({X}, {Y})")

    # 4. Save Outputs
    cv2.imwrite(os.path.join(output_dir, "ghost_vision.jpg"), vis_frame)
    cv2.imwrite(os.path.join(output_dir, "ghost_minimap.jpg"), minimap)
    print("\nPhase 3 Complete! Saved 'ghost_vision.jpg' and 'ghost_minimap.jpg' to data/output/phase3/")

if __name__ == "__main__":
    main()
