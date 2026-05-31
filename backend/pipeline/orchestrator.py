import asyncio
from pathlib import Path

from backend.config import get_settings
from backend.pipeline.progress import STAGE_ORDER, overall_progress
from backend.pipeline.stages.calibration import calibrate_job
from backend.pipeline.stages.ingest import FFmpegNotFoundError, VideoTooLongError, ingest_video, probe_video
from backend.services import storage
from backend.services.job_manager import ProgressCallback, get_job_manager

from backend.cv.homography import CourtProjector
from backend.pipeline.stages.player_tracking import process_player_tracking
from backend.pipeline.stages.ball_tracking import process_ball_tracking


async def run_pipeline(job_id: str, on_progress: ProgressCallback) -> None:
    """
    Milestone 4 & 8 pipeline: End-to-end CV tracking.
    """
    settings = get_settings()
    job = await get_job_manager().get_job(job_id)
    if not job or not job.get("upload_path"):
        raise RuntimeError("Job upload path missing")

    upload_path = Path(job["upload_path"])
    normalized = settings.uploads_dir / f"{job_id}_normalized.mp4"

    # --- Ingest ---
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
    # Fetch job again as it might have been updated with homography
    job = await get_job_manager().get_job(job_id)
    homography_json = job.get("homography_json") if job else None
    
    await on_progress("calibration", 10, overall_progress("calibration", 10), frames_total, 0)
    if not homography_json:
        # This will raise CalibrationError if it fails, which the orchestrator caller must handle
        # and set job status to calibration_required
        await calibrate_job(job_id, upload_path, homography_json=None)
        
    # Reload job to get the computed homography
    job = await get_job_manager().get_job(job_id)
    homography_json = job.get("homography_json")
    if not homography_json:
        raise RuntimeError("Calibration failed to produce homography.")
        
    projector = CourtProjector.from_json(homography_json)
    await on_progress("calibration", 100, overall_progress("calibration", 100), frames_total, 0)

    # --- Player Tracking (Milestone 3) ---
    def pose_progress(frame_idx, total):
        pct = int(100 * frame_idx / total)
        # We need an async closure but progress_callback in process_player_tracking is sync
        # Since it's a tight loop, we might just not await or we run tracking in thread
        pass 
        
    # Run heavy CV in thread to not block asyncio loop
    player_states = await asyncio.to_thread(
        process_player_tracking, str(normalized), projector, settings.output_fps, None
    )
    await on_progress("player_tracking", 100, overall_progress("player_tracking", 100), frames_total, frames_total)
    
    # --- Ball Tracking (Milestone 4) ---
    ball_states = await asyncio.to_thread(
        process_ball_tracking, str(normalized), projector, settings.output_fps, None
    )
    await on_progress("ball_tracking", 100, overall_progress("ball_tracking", 100), frames_total, frames_total)

    # --- Analytics & Export (Milestone 8) ---
    await on_progress("analytics", 10, overall_progress("analytics", 10), frames_total, frames_total)
    
    # Merge Player and Ball states into ProcFrameData sequence
    sequence = []
    # frame_count = min length of the generated sequences (should be equal to frames_total)
    num_frames = min(len(player_states), len(ball_states))
    
    for i in range(num_frames):
        frame_data = {
            "frame_index": i,
            "ball": ball_states[i],
            "players": player_states[i],
            "ball_speed_kmh": 0.0, # Placeholder
            "spin_rate_rpm": 0.0, # Placeholder
            "hitter": None # Placeholder
        }
        sequence.append(frame_data)
        
    payload = {"sequence": sequence}
    storage.write_result(settings, job_id, payload)
    
    await on_progress("analytics", 100, 100, frames_total, frames_total)


run_stub_pipeline = run_pipeline
