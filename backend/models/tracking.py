from typing import Literal

from pydantic import BaseModel, Field


class Coordinate(BaseModel):
    x: float
    y: float
    z: float


class BallState(BaseModel):
    position: Coordinate
    is_occluded: bool


class PlayerState(BaseModel):
    id: Literal["player_bottom", "player_top"]
    position: Coordinate


class ProcFrameData(BaseModel):
    frame_index: int
    ball: BallState
    players: list[PlayerState] = Field(min_length=2, max_length=2)
    ball_speed_kmh: float = Field(ge=0)
    spin_rate_rpm: float = Field(ge=0)
    hitter: Literal["p1", "p2"] | None = None


# Alias used by legacy code paths
FrameData = ProcFrameData
