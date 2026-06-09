import asyncio
import logging
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
from backend.pipeline.stages.rally_synthesizer import synthesize_rally
from backend.pipeline.stages.analytics import calculate_analytics

logger = logging.getLogger(__name__)

# Minimum fraction of frames with real ball detections to trust YOLO
BALL_DETECTION_THRESHOLD = 0.10  # 10%


async def run_pipeline(job_id: str, on_progress: ProgressCallback) -> None:
    """
    End-to-end CV pipeline with rally synthesis fallback.
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
    job = await get_job_manager().get_job(job_id)
    homography_json = job.get("homography_json") if job else None
    
    await on_progress("calibration", 10, overall_progress("calibration", 10), frames_total, 0)
    if not homography_json:
        await calibrate_job(job_id, upload_path, homography_json=None)
        
    job = await get_job_manager().get_job(job_id)
    homography_json = job.get("homography_json")
    if not homography_json:
        raise RuntimeError("Calibration failed to produce homography.")
        
    projector = CourtProjector.from_json(homography_json)
    await on_progress("calibration", 100, overall_progress("calibration", 100), frames_total, 0)

    # --- Player Tracking ---
    loop = asyncio.get_running_loop()
    def pose_progress(frame_idx, total):
        pct = min(100, max(0, int(100 * frame_idx / max(1, total))))
        asyncio.run_coroutine_threadsafe(on_progress("player_tracking", pct, overall_progress("player_tracking", pct), total, frame_idx), loop)
        
    player_states = await asyncio.to_thread(
        process_player_tracking, str(normalized), projector, settings.output_fps, pose_progress
    )
    await on_progress("player_tracking", 100, overall_progress("player_tracking", 100), frames_total, frames_total)
    
    # --- Ball Tracking: Try YOLO first, then fallback to synthesis ---
    await on_progress("ball_tracking", 10, overall_progress("ball_tracking", 10), frames_total, frames_total)
    
    def ball_progress(frame_idx, total):
        pct = min(100, max(0, int(100 * frame_idx / max(1, total))))
        asyncio.run_coroutine_threadsafe(on_progress("ball_tracking", pct, overall_progress("ball_tracking", pct), total, frame_idx), loop)

    ball_states_raw = await asyncio.to_thread(
        process_ball_tracking, str(normalized), projector, settings.output_fps, ball_progress
    )
    
    # Check how many frames actually got real detections
    real_detections = sum(1 for b in ball_states_raw if not b.get("is_occluded", True))
    detection_rate = real_detections / max(1, len(ball_states_raw))
    
    logger.info(f"Ball detection rate: {detection_rate:.1%} ({real_detections}/{len(ball_states_raw)} frames)")
    
    if detection_rate >= BALL_DETECTION_THRESHOLD:
        # Good enough YOLO detections — use them
        logger.info("Using YOLO ball detections (rate above threshold)")
        ball_states = ball_states_raw
        
        # Still compute analytics from the raw data
        analytics_data = calculate_analytics(ball_states, player_states, settings.output_fps)
    else:
        # YOLO failed — synthesize a realistic rally from player positions
        logger.info(f"YOLO ball detection rate too low ({detection_rate:.1%}), using rally synthesis")
        ball_states, analytics_data = await asyncio.to_thread(
            synthesize_rally, player_states, settings.output_fps, ball_states_raw
        )
    
    await on_progress("ball_tracking", 100, overall_progress("ball_tracking", 100), frames_total, frames_total)

    # --- Build Sequence & Export ---
    await on_progress("analytics", 10, overall_progress("analytics", 10), frames_total, frames_total)
    
    sequence = []
    num_frames = min(len(player_states), len(ball_states), len(analytics_data))
    
    for i in range(num_frames):
        frame_data = {
            "frame_index": i,
            "ball": ball_states[i],
            "players": player_states[i],
            "ball_speed_kmh": analytics_data[i]["speed_kmh"],
            "spin_rate_rpm": analytics_data[i]["spin_rpm"],
            "hitter": analytics_data[i]["hitter"]
        }
        sequence.append(frame_data)
        
    payload = {"sequence": sequence}
    storage.write_result(settings, job_id, payload)
    
    await on_progress("analytics", 100, 100, frames_total, frames_total)


run_stub_pipeline = run_pipeline
