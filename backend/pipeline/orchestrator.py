import asyncio
from pathlib import Path

from backend.config import get_settings
from backend.pipeline.progress import STAGE_ORDER, overall_progress
from backend.pipeline.stages.ingest import ingest_video
from backend.services import storage
from backend.services.job_manager import ProgressCallback, get_job_manager


async def run_stub_pipeline(job_id: str, on_progress: ProgressCallback) -> None:
    """
    Milestone 1 stub: real ingest (ffprobe + 30fps normalize), then simulated CV stages
    returning demo_data.json as the tracking result.
    """
    from backend.pipeline.stages.ingest import VideoTooLongError, FFmpegNotFoundError

    settings = get_settings()
    job = await get_job_manager().get_job(job_id)
    if not job or not job.get("upload_path"):
        raise RuntimeError("Job upload path missing")

    upload_path = Path(job["upload_path"])

    # --- Ingest (real) ---
    await on_progress("ingest", 10, overall_progress("ingest", 10), 0, 0)
    try:
        ingest_result = await asyncio.to_thread(ingest_video, upload_path, job_id, settings)
    except VideoTooLongError as exc:
        raise RuntimeError(str(exc)) from exc
    except FFmpegNotFoundError as exc:
        raise RuntimeError(str(exc)) from exc
    frames_total = ingest_result.frame_count
    await on_progress("ingest", 100, overall_progress("ingest", 100), frames_total, 0)

    delay = settings.stub_processing_delay_sec
    steps_per_stage = 4

    # --- Simulated CV stages (Milestone 2+ replaces these) ---
    for stage in STAGE_ORDER[1:]:  # skip ingest
        for step in range(1, steps_per_stage + 1):
            stage_pct = int(100 * step / steps_per_stage)
            frames_done = int(frames_total * (
                STAGE_ORDER.index(stage) + step / steps_per_stage
            ) / (len(STAGE_ORDER) - 1))
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
