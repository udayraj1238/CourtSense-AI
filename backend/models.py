from pydantic import BaseModel
from typing import List, Optional

class Coordinate(BaseModel):
    x: float
    y: float
    z: float = 0.0  # Optional Z for 3D mapping (0 for ground plane)

class PlayerState(BaseModel):
    id: str
    position: Coordinate
    # Potential future biometric data
    # joint_angles: dict

class BallState(BaseModel):
    position: Coordinate
    is_occluded: bool

class FrameData(BaseModel):
    frame_index: int
    ball: Optional[BallState]
    players: List[PlayerState]
    ball_speed_kmh: Optional[float] = None
    spin_rate_rpm: Optional[float] = None

class SequenceResponse(BaseModel):
    sequence: List[FrameData]
