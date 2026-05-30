import asyncio
from pathlib import Path

from backend.config import get_settings
from backend.pipeline.progress import STAGE_ORDER, overall_progress
from backend.pipeline.stages.calibration import calibrate_job
from backend.pipeline.stages.ingest import FFmpegNotFoundError, VideoTooLongError, ingest_video, probe_video
from backend.services import storage
from backend.services.job_manager import ProgressCallback, get_job_manager


async def run_pipeline(job_id: str, on_progress: ProgressCallback) -> None:
    """
    Milestone 2 pipeline: real ingest + real calibration, stub tracking export.
    """
    settings = get_settings()
    job = await get_job_manager().get_job(job_id)
    if not job or not job.get("upload_path"):
        raise RuntimeError("Job upload path missing")

    upload_path = Path(job["upload_path"])
    normalized = settings.uploads_dir / f"{job_id}_normalized.mp4"

    # --- Ingest (skip if already normalized, e.g. resume after manual calibrate) ---
    await on_progress("ingest", 10, overall_progress("ingest", 10), 0, 0)
    if normalized.exists():
        meta = probe_video(normalized)
        duration = float(meta.get("format", {}).get("duration", 0))
        frames_total = int(round(duration * settings.output_fps))
    else:
        try:
            ingest_result = await asyncio.to_thread(ingest_video, upload_path, job_id, settings)
        except VideoTooLongError as exc:
            raise RuntimeError(str(exc)) from exc
        except FFmpegNotFoundError as exc:
            raise RuntimeError(str(exc)) from exc
        frames_total = ingest_result.frame_count
    await on_progress("ingest", 100, overall_progress("ingest", 100), frames_total, 0)

    # --- Calibration ---
    job = await get_job_manager().get_job(job_id)
    homography_json = job.get("homography_json") if job else None
    await on_progress("calibration", 10, overall_progress("calibration", 10), frames_total, 0)
    if not homography_json:
        await calibrate_job(job_id, upload_path, homography_json=None)
    await on_progress("calibration", 100, overall_progress("calibration", 100), frames_total, 0)

    delay = settings.stub_processing_delay_sec
    steps_per_stage = 4

    for stage in STAGE_ORDER[2:]:
        for step in range(1, steps_per_stage + 1):
            stage_pct = int(100 * step / steps_per_stage)
            stage_idx = STAGE_ORDER.index(stage)
            frames_done = int(
                frames_total * (stage_idx + step / steps_per_stage) / (len(STAGE_ORDER) - 1)
            )
            await on_progress(
                stage,
                stage_pct,
                overall_progress(stage, stage_pct),
                frames_total,
                min(frames_done, frames_total),
            )
            if delay > 0:
                await asyncio.sleep(delay / steps_per_stage)

    payload = await get_job_manager().load_stub_sequence()
    storage.write_result(settings, job_id, payload)
    await on_progress("analytics", 100, 100, frames_total, frames_total)


run_stub_pipeline = run_pipeline
