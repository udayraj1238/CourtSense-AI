"""
phase4_trajectory.py

Execution script for Phase 4.
Generates a sequence of mock frames of a ball moving in a parabolic arc,
introduces "missing" frames to simulate occlusion, and uses the Kalman Filter
to track and guess the ball's location during occlusion.
"""

import sys
import os
import cv2
import numpy as np

# Add the project root to the python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from courtsense_ai.core.ball_tracking import BallTracker
from courtsense_ai.core.physics import TrajectoryPredictor

def generate_mock_trajectory(width=1280, height=720, num_frames=60):
    """
    Generates a list of mock frames with a ball moving in a parabolic arc.
    """
    frames = []
    positions = []
    
    # Parabola parameters
    x_start = 100
    x_end = width - 100
    y_ground = height - 100
    y_peak = 200
    
    # a*(x - h)^2 + k = y
    h = (x_start + x_end) / 2
    k = y_peak
    a = (y_ground - k) / ((x_start - h)**2)
    
    xs = np.linspace(x_start, x_end, num_frames)
    
    for x in xs:
        y = a * (x - h)**2 + k
        positions.append((int(x), int(y)))
        
        # Create a blank image
        frame = np.ones((height, width, 3), dtype=np.uint8) * 200  # Gray background
        
        # Draw the "ball"
        cv2.circle(frame, (int(x), int(y)), 10, (0, 255, 255), -1)  # Yellow ball
        
        frames.append(frame)
        
    return frames, positions

def main():
    print("Initializing Phase 4: Trajectory Tracking with Kalman Filter")
    
    # Generate mock data
    width, height = 1280, 720
    frames, true_positions = generate_mock_trajectory(width, height, num_frames=60)
    
    # Simulate occlusion (missing detections) between frames 20 and 30
    occlusion_start = 20
    occlusion_end = 30
    
    # Initialize predictor
    predictor = TrajectoryPredictor(dt=1/30.0)
    
    tracker = BallTracker(model_size='yolov8n.pt')
    
    output_frames = []
    estimated_path = []
    
    print(f"Simulating sequence of {len(frames)} frames with occlusion from frame {occlusion_start} to {occlusion_end}")
    
    for i, frame in enumerate(frames):
        display_frame = frame.copy()
        
        # 1. Detection Phase
        measured_pos = None
        
        # Simulate occlusion
        is_occluded = occlusion_start <= i <= occlusion_end
        
        if not is_occluded:
            # For authenticity, let's call the tracker.
            detected_pos = tracker.detect_ball(frame)
            
            if detected_pos is not None:
                measured_pos = detected_pos
            else:
                # Fallback if YOLO fails on mock data
                true_x, true_y = true_positions[i]
                measured_pos = np.array([true_x + np.random.normal(0, 2), true_y + np.random.normal(0, 2)])
        
        # 2. Prediction / Update Phase
        if measured_pos is not None:
            # We have a measurement, UPDATE the Kalman Filter
            current_state = predictor.update(measured_pos)
            color = (0, 255, 0) # Green for measured
            
            # Draw measurement
            cv2.drawMarker(display_frame, (int(measured_pos[0]), int(measured_pos[1])), 
                           (255, 0, 0), cv2.MARKER_CROSS, 20, 2) # Blue CROSS for detection
        else:
            # Occluded! We PREDICT instead
            current_state = predictor.predict()
            color = (0, 0, 255) # Red for predicted (ghost phase)
            
        estimated_path.append((int(current_state[0]), int(current_state[1])))
        
        # 3. Visualization
        # Draw the "Ribbon" (the tracked path)
        for j in range(1, len(estimated_path)):
            # Change color to red if we were predicting at that step
            is_step_occluded = occlusion_start <= j <= occlusion_end
            step_color = (0, 0, 255) if is_step_occluded else (0, 255, 0)
            cv2.line(display_frame, estimated_path[j-1], estimated_path[j], step_color, 3)
            
        # Draw current state estimation
        cv2.circle(display_frame, estimated_path[-1], 8, color, -1)
        
        # Overlay text info
        status_text = "OCCLUDED (Predicting)" if is_occluded else "TRACKING"
        cv2.putText(display_frame, f"Frame {i}: {status_text}", (30, 50), 
                    cv2.FONT_HERSHEY_SIMPLEX, 1, color, 2)
        
        output_frames.append(display_frame)
        
    # Save the result as a video
    out_path = os.path.join(os.path.dirname(__file__), '..', 'trajectory_output.mp4')
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(out_path, fourcc, 30.0, (width, height))
    
    for f in output_frames:
        out.write(f)
    out.release()
    
    print(f"Tracking sequence saved to {os.path.abspath(out_path)}")

if __name__ == "__main__":
    main()
