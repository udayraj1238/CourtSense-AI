"""
physics.py

Implements probabilistic modeling for the ball's trajectory, accounting for 
occlusion and topspin via a Kalman Filter and Magnus effect corrections.
"""

import numpy as np
import cv2

class TrajectoryPredictor:
    def __init__(self, dt: float = 1/30.0):
        """
        Initializes a Constant Acceleration Kalman Filter state estimator.
        State: [x, y, vx, vy, ax, ay]^T
        Measurement: [x, y]^T
        
        Args:
            dt (float): Time step between frames (e.g., 1/30s for 30fps).
        """
        self.kf = cv2.KalmanFilter(6, 2)
        
        # Measurement Matrix H (we only measure x and y)
        self.kf.measurementMatrix = np.array([
            [1, 0, 0, 0, 0, 0],
            [0, 1, 0, 0, 0, 0]
        ], np.float32)
        
        # State Transition Matrix F (Constant Acceleration Kinematics)
        # x_new = x + vx*dt + 0.5*ax*dt^2
        self.kf.transitionMatrix = np.array([
            [1, 0, dt,  0, 0.5*dt**2,         0],
            [0, 1,  0, dt,         0, 0.5*dt**2],
            [0, 0,  1,  0,        dt,         0],
            [0, 0,  0,  1,         0,        dt],
            [0, 0,  0,  0,         1,         0],
            [0, 0,  0,  0,         0,         1]
        ], np.float32)
        
        # Process Noise Covariance Q (trust the model less for acceleration)
        self.kf.processNoiseCov = np.eye(6, dtype=np.float32) * 1e-4
        
        # Measurement Noise Covariance R (trust the YOLO detector)
        self.kf.measurementNoiseCov = np.eye(2, dtype=np.float32) * 1e-2
        
        # Initial State Error Covariance P
        self.kf.errorCovPost = np.eye(6, dtype=np.float32)
        
        self.initialized = False

    def update(self, measurement: np.ndarray) -> np.ndarray:
        """
        Updates the Kalman filter with a new [x, y] observation.
        
        Args:
            measurement (np.ndarray): [x, y] coordinate detected by CNN.
            
        Returns:
            np.ndarray: Returns the corrected [x, y] state.
        """
        meas = np.array([[measurement[0]], [measurement[1]]], dtype=np.float32)
        
        if not self.initialized:
            # Initialize state with first measurement
            self.kf.statePost = np.array([
                [measurement[0]], [measurement[1]], 
                [0], [0], 
                [0], [0]
            ], dtype=np.float32)
            self.initialized = True
            
        # Predict followed by Update
        self.kf.predict()
        corrected_state = self.kf.correct(meas)
        
        return np.array([corrected_state[0, 0], corrected_state[1, 0]])

    def predict(self) -> np.ndarray:
        """
        Predicts the next state (useful during occlusion when CNN fails).
        
        Returns:
            np.ndarray: Predicted [x, y] coordinate.
        """
        if not self.initialized:
            return np.array([0.0, 0.0])
            
        pred = self.kf.predict()
        return np.array([pred[0, 0], pred[1, 0]])
        
    def apply_magnus_correction(self, state_y: float, spin_factor: float = 0.5) -> float:
        """
        Applies a domain-specific correction based on the Magnus effect (topspin/slice)
        to the predicted trajectory's Y-axis (gravity/drop).
        
        Topspin creates a downward force (ball drops faster).
        
        Args:
            state_y (float): The current Y pixel coordinate.
            spin_factor (float): Positive for topspin, negative for slice.
            
        Returns:
            float: Modified Y coordinate simulating a faster drop.
        """
        # In a real model, this would augment the Acceleration (ay) state dynamically.
        # Here we simulate the effect by increasing the dip directly if topspin > 0.
        return state_y + spin_factor
