import cv2
import numpy as np

class Kalman3D:
    def __init__(self, dt: float = 1/30.0):
        # State vector: [x, y, z, vx, vy, vz]
        # Measurement vector: [x, y, z]
        self.kf = cv2.KalmanFilter(6, 3)
        self.dt = dt
        
        # Transition matrix (A)
        # x_t = x_{t-1} + vx_{t-1} * dt
        self.kf.transitionMatrix = np.array([
            [1, 0, 0, dt, 0,  0],
            [0, 1, 0, 0,  dt, 0],
            [0, 0, 1, 0,  0,  dt],
            [0, 0, 0, 1,  0,  0],
            [0, 0, 0, 0,  1,  0],
            [0, 0, 0, 0,  0,  1]
        ], np.float32)
        
        # Measurement matrix (H)
        # We only measure x, y, z
        self.kf.measurementMatrix = np.array([
            [1, 0, 0, 0, 0, 0],
            [0, 1, 0, 0, 0, 0],
            [0, 0, 1, 0, 0, 0]
        ], np.float32)
        
        # Process noise covariance (Q)
        # Small noise for position, larger for velocity to allow for sudden changes (hits/bounces)
        q_pos = 1e-4
        q_vel = 1e-2
        self.kf.processNoiseCov = np.array([
            [q_pos, 0, 0, 0, 0, 0],
            [0, q_pos, 0, 0, 0, 0],
            [0, 0, q_pos, 0, 0, 0],
            [0, 0, 0, q_vel, 0, 0],
            [0, 0, 0, 0, q_vel, 0],
            [0, 0, 0, 0, 0, q_vel]
        ], np.float32)
        
        # Measurement noise covariance (R)
        # Assuming our detections have some noise (e.g. 0.1m variance)
        r_val = 1e-2
        self.kf.measurementNoiseCov = np.array([
            [r_val, 0, 0],
            [0, r_val, 0],
            [0, 0, r_val]
        ], np.float32)
        
        # Error covariance (P)
        self.kf.errorCovPost = np.eye(6, dtype=np.float32) * 1.0
        
        self.is_initialized = False

    def init_state(self, x: float, y: float, z: float):
        self.kf.statePost = np.array([[x], [y], [z], [0.0], [0.0], [0.0]], np.float32)
        self.is_initialized = True

    def predict(self) -> tuple[float, float, float]:
        """Predict next state and return predicted (x, y, z)."""
        if not self.is_initialized:
            return 0.0, 0.0, 0.0
            
        pred = self.kf.predict()
        return float(pred[0]), float(pred[1]), float(pred[2])

    def correct(self, x: float, y: float, z: float) -> tuple[float, float, float]:
        """Update with measurement and return corrected (x, y, z)."""
        if not self.is_initialized:
            self.init_state(x, y, z)
            return x, y, z
            
        meas = np.array([[x], [y], [z]], np.float32)
        corr = self.kf.correct(meas)
        return float(corr[0]), float(corr[1]), float(corr[2])

    def get_velocity(self) -> tuple[float, float, float]:
        if not self.is_initialized:
            return 0.0, 0.0, 0.0
        state = self.kf.statePost
        return float(state[3]), float(state[4]), float(state[5])
