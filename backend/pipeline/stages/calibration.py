"""Court calibration stage — auto-detect or use saved homography."""

from __future__ import annotations

import asyncio
from pathlib import Path

import cv2

from backend.config import Settings, get_settings
from backend.cv.court_lines import extract_preview_frame
from backend.cv.errors import CalibrationError
from backend.cv.homography import CourtProjector
from backend.services.job_manager import CalibrationRequiredError, get_job_manager


def normalized_video_path(settings: Settings, job_id: str, upload_path: Path) -> Path:
    normalized = settings.uploads_dir / f"{job_id}_normalized.mp4"
    return normalized if normalized.exists() else upload_path


MAX_CALIBRATION_ATTEMPTS = 2

async def calibrate_job(
    job_id: str,
    upload_path: Path,
    homography_json: str | None = None,
) -> CourtProjector:
    settings = get_settings()
    video = normalized_video_path(settings, job_id, upload_path)
    preview_path = str(settings.uploads_dir / f"{job_id}_preview.jpg")

    if homography_json:
        projector = CourtProjector.from_json(homography_json)
        await get_job_manager().update_job(
            job_id,
            homography_json=homography_json,
            calibration_failed=0,
        )
        return projector

    job = await get_job_manager().get_job(job_id)
    attempt = job.get("calibration_attempts", 0) + 1 if job else 1
    
    if attempt > MAX_CALIBRATION_ATTEMPTS:
        # Force manual calibration
        await get_job_manager().update_job(
            job_id, status="calibration_required",
            calibration_failed=1,
            error="Auto-calibration failed after multiple attempts. Please set corners manually."
        )
        raise CalibrationRequiredError("Auto-calibration failed after multiple attempts. Please set corners manually.")
    
    await get_job_manager().update_job(job_id, calibration_attempts=attempt)

    await asyncio.to_thread(extract_preview_frame, str(video), preview_path, 0.5)

    try:
        frame = cv2.imread(preview_path)
        if frame is None:
            raise CalibrationError("Preview frame unavailable.")
        projector = await asyncio.to_thread(CourtProjector.from_frame, frame)
        await get_job_manager().update_job(
            job_id,
            homography_json=projector.to_json(),
            preview_path=preview_path,
            calibration_failed=0,
        )
        return projector
    except CalibrationError as exc:
        await get_job_manager().update_job(
            job_id,
            preview_path=preview_path,
            calibration_failed=1,
        )
        raise CalibrationRequiredError(str(exc)) from exc
