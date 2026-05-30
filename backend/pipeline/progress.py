"""Pipeline stage progress weights (must sum to 100)."""

STAGE_WEIGHTS: dict[str, int] = {
    "ingest": 5,
    "calibration": 15,
    "player_tracking": 35,
    "ball_tracking": 30,
    "analytics": 15,
}

STAGE_ORDER = list(STAGE_WEIGHTS.keys())


def overall_progress(stage: str, stage_pct: int) -> int:
    """Map stage-local progress to overall 0–100."""
    completed = 0
    for name in STAGE_ORDER:
        if name == stage:
            weight = STAGE_WEIGHTS[name]
            return min(100, completed + int(weight * stage_pct / 100))
        completed += STAGE_WEIGHTS[name]
    return 100
