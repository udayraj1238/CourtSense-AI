from typing import Literal

from pydantic import BaseModel, Field

from backend.models.tracking import ProcFrameData


class SequenceResponse(BaseModel):
    sequence: list[ProcFrameData]


class JobUploadResponse(BaseModel):
    job_id: str
    status: Literal["queued"] = "queued"
    message: str = "Video accepted for processing"


JobStatusLiteral = Literal[
    "queued",
    "processing",
    "completed",
    "failed",
    "calibration_required",
    "expired",
]


class JobStatusResponse(BaseModel):
    job_id: str
    status: JobStatusLiteral
    progress: int = Field(ge=0, le=100)
    stage: str | None = None
    stage_progress: int = Field(default=0, ge=0, le=100)
    frames_total: int = 0
    frames_processed: int = 0
    error: str | None = None
    calibration_failed: bool = False


class ManualCalibrateRequest(BaseModel):
    corners: list[list[float]] = Field(min_length=4, max_length=4)
