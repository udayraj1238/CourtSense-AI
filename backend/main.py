import json
import os
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routes import health, jobs
from backend.config import get_settings
from backend.models.api import SequenceResponse
from backend.models.tracking import BallState, Coordinate, FrameData, PlayerState
from backend.services.job_manager import get_job_manager

# Legacy script path for /api/v1/tracking/real
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


@asynccontextmanager
async def lifespan(app: FastAPI):
    manager = get_job_manager()
    await manager.init_db()
    await manager.start_cleanup_loop()
    yield
    await manager.stop_cleanup_loop()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(jobs.router)

    # --- Legacy v1 endpoints (preserved for dev / HF backward compat) ---
    @app.get("/api/v1/tracking/sequence", response_model=SequenceResponse)
    def get_mock_tracking_sequence():
        frames = []
        num_frames = 60
        x_start, x_end = -10.0, 10.0
        y_ground, y_peak = 0.0, 5.0
        h = (x_start + x_end) / 2
        k = y_peak
        a = (y_ground - k) / ((x_start - h) ** 2)
        xs = np.linspace(x_start, x_end, num_frames)
        occlusion_start, occlusion_end = 20, 30

        for i, x in enumerate(xs):
            y = a * (x - h) ** 2 + k
            z = np.linspace(-5.0, 5.0, num_frames)[i]
            is_occluded = occlusion_start <= i <= occlusion_end
            ball = BallState(
                position=Coordinate(x=float(x), y=float(y), z=float(z)),
                is_occluded=is_occluded,
            )
            player_1 = PlayerState(
                id="player_bottom",
                position=Coordinate(x=-2.0 + np.sin(i * 0.1) * 0.5, y=0.0, z=8.0),
            )
            player_2 = PlayerState(
                id="player_top",
                position=Coordinate(x=2.0 + np.cos(i * 0.1) * 0.5, y=0.0, z=-8.0),
            )
            frames.append(
                FrameData(
                    frame_index=i,
                    ball=ball,
                    players=[player_1, player_2],
                    ball_speed_kmh=80.0,
                    spin_rate_rpm=0.0,
                    hitter=None,
                )
            )
        return SequenceResponse(sequence=frames)

    @app.get("/api/v1/tracking/real", response_model=SequenceResponse)
    def get_real_tracking_sequence():
        json_path = os.path.join(REPO_ROOT, "data", "real_match_data.json")
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return SequenceResponse(**data)
        except FileNotFoundError:
            raise HTTPException(
                status_code=404,
                detail="Real match data JSON not found. Please run the processing script first.",
            )
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="Error decoding the match data JSON.")

    return app


app = create_app()
