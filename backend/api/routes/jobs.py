import shutil
import tempfile
import uuid
from pathlib import Path

import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from backend.config import get_settings
from backend.cv.errors import CalibrationError
from backend.cv.homography import CourtProjector
from backend.models.api import JobStatusResponse, JobUploadResponse, ManualCalibrateRequest, SequenceResponse
from backend.pipeline.orchestrator import run_pipeline
from backend.pipeline.stages.calibration import calibrate_job
from backend.services import storage
from backend.services.job_manager import get_job_manager

router = APIRouter(prefix="/api/v2/jobs", tags=["jobs"])


@router.post("/upload", response_model=JobUploadResponse, status_code=202)
async def upload_video(file: UploadFile = File(...)):
    settings = get_settings()

    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="File provided is not a video.")

    suffix = Path(file.filename or "upload.mp4").suffix or ".mp4"

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = Path(tmp.name)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save upload: {exc}") from exc

    if tmp_path.stat().st_size > settings.max_upload_bytes:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="File exceeds maximum upload size (100 MB).")

    job_id = str(uuid.uuid4())
    dest = settings.uploads_dir / f"{job_id}{suffix}"
    shutil.move(str(tmp_path), dest)

    job_manager = get_job_manager()
    await job_manager.create_job(job_id, dest)
    await job_manager.enqueue_processing(job_id, run_pipeline)

    return JobUploadResponse(job_id=job_id)


@router.get("/{job_id}/status", response_model=JobStatusResponse)
async def job_status(job_id: str):
    job = await get_job_manager().get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    return JobStatusResponse(
        job_id=job_id,
        status=job["status"],
        progress=job["progress"],
        stage=job.get("stage"),
        stage_progress=job.get("stage_progress") or 0,
        frames_total=job.get("frames_total") or 0,
        frames_processed=job.get("frames_processed") or 0,
        error=job.get("error"),
        calibration_failed=bool(job.get("calibration_failed")),
    )


@router.get("/{job_id}/preview")
async def job_preview(job_id: str):
    job = await get_job_manager().get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    preview = job.get("preview_path")
    if not preview or not Path(preview).exists():
        raise HTTPException(
            status_code=404,
            detail="Preview frame not available yet. Wait for calibration stage.",
        )

    return FileResponse(preview, media_type="image/jpeg", filename=f"{job_id}_preview.jpg")


@router.post("/{job_id}/calibrate")
async def manual_calibrate(job_id: str, body: ManualCalibrateRequest):
    job = await get_job_manager().get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    if job["status"] not in ("calibration_required", "failed"):
        raise HTTPException(
            status_code=400,
            detail=f"Job cannot be calibrated in status '{job['status']}'.",
        )

    try:
        corners = np.array(body.corners, dtype=np.float32).reshape(4, 2)
        projector = CourtProjector.from_corners(corners)
        h_json = projector.to_json()
    except CalibrationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    await get_job_manager().update_job(
        job_id,
        homography_json=h_json,
        calibration_failed=0,
        error=None,
        status="queued",
        progress=15,
        stage="calibration",
    )
    await get_job_manager().enqueue_processing(job_id, run_pipeline)

    return {"job_id": job_id, "status": "processing", "message": "Manual calibration accepted."}


@router.get("/{job_id}/result")
async def job_result(job_id: str):
    job = await get_job_manager().get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    status = job["status"]
    if status in ("processing", "queued"):
        return JSONResponse(
            status_code=202,
            content={"status": status, "progress": job["progress"]},
        )

    if status == "calibration_required":
        raise HTTPException(
            status_code=409,
            detail={
                "calibration_failed": True,
                "message": job.get("error") or "Manual court calibration required.",
            },
        )

    if status == "failed":
        raise HTTPException(status_code=500, detail=job.get("error") or "Processing failed.")

    if status == "expired":
        raise HTTPException(status_code=410, detail="Job result expired.")

    payload = storage.read_result(get_settings(), job_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Result not found.")

    return SequenceResponse(**payload)
