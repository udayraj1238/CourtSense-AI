try:
    from .ball_tracking import process_ball_tracking
    from .player_tracking import process_player_tracking
    from .rally_synthesizer import synthesize_rally
    from .calibration import calibrate_job
    from .ingest import ingest_video
    from .analytics import calculate_analytics
except ImportError as e:
    import logging
    logging.getLogger(__name__).error(
        f"Failed to import pipeline stage: {e}. "
        "Check that all CV dependencies (ultralytics, mediapipe, scipy) are installed."
    )
    raise
